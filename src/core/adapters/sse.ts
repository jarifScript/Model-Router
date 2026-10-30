export async function* readSseData(response: Response): AsyncIterable<string> {
  if (!response.body) throw new Error('The provider returned an empty stream.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []

  function consume(line: string): string | null {
    if (line === '') {
      const event = data.join('\n')
      data = []
      return event || null
    }
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    return null
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const event = consume(line)
        if (event !== null) yield event
      }
      if (done) {
        if (buffer) {
          const event = consume(buffer)
          if (event !== null) yield event
        }
        const finalEvent = consume('')
        if (finalEvent !== null) yield finalEvent
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function parseJsonEvent(data: string): unknown {
  try {
    return JSON.parse(data) as unknown
  } catch {
    throw new Error('The provider returned an invalid stream event.')
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
