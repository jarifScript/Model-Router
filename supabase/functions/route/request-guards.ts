const ALLOWED_CLIENT_HEADERS = [
  'accept',
  'authorization',
  'apikey',
  'content-type',
  'x-client-info',
  'x-provider-api-key',
] as const

export function filterAllowedClientHeaders(source: Headers): Headers {
  const allowed = new Headers()
  for (const name of ALLOWED_CLIENT_HEADERS) {
    const value = source.get(name)
    if (value !== null) allowed.set(name, value)
  }
  return allowed
}

export function isAllowedJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json'
}

export function requestBodyIsWithinLimit(body: string, maximumBytes: number): boolean {
  return new TextEncoder().encode(body).byteLength <= maximumBytes
}

export async function readBodyWithinLimit(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<string | null> {
  if (!body) return ''

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > maximumBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }

    const bytes = new Uint8Array(bytesRead)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    reader.releaseLock()
  }
}

export function limitStreamBytes(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let bytesRead = 0

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          reader.releaseLock()
          return
        }

        const remainingBytes = maximumBytes - bytesRead
        if (value.byteLength <= remainingBytes) {
          bytesRead += value.byteLength
          controller.enqueue(value)
          return
        }

        if (remainingBytes > 0) {
          controller.enqueue(value.subarray(0, remainingBytes))
        }
        await reader.cancel()
        controller.error(new Error('The response exceeded its output limit.'))
      } catch {
        controller.error(new Error('The provider response could not be read.'))
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
}
