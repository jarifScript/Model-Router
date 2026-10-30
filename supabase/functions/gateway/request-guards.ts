import type { ChatMessage } from '../../../src/core/adapters/types.ts'

export const MAX_GATEWAY_BODY_BYTES = 256_000
export const MAX_GATEWAY_MESSAGES = 24
export const MAX_GATEWAY_MESSAGE_LENGTH = 12_000
export const MAX_GATEWAY_TOTAL_MESSAGE_LENGTH = 48_000
export const MAX_GATEWAY_OUTPUT_TOKENS = 4_096

export type GatewayChatRequest = {
  model: string
  messages: ChatMessage[]
  stream: boolean
  maxTokens: number
  temperature?: number
  topP?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stop?: string | string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= minimum && value <= maximum
}

function isStopValue(value: unknown): value is string | string[] {
  if (typeof value === 'string') return value.length <= 256
  return Array.isArray(value)
    && value.length <= 4
    && value.every((part) => typeof part === 'string' && part.length <= 256)
}

export function parseGatewayChatRequest(value: unknown): GatewayChatRequest | null {
  if (!isRecord(value)) return null
  const allowedFields = new Set([
    'model',
    'messages',
    'stream',
    'max_tokens',
    'max_completion_tokens',
    'temperature',
    'top_p',
    'presence_penalty',
    'frequency_penalty',
    'stop',
  ])
  if (Object.keys(value).some((key) => !allowedFields.has(key))) return null
  if (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 180) return null
  if (value.stream !== undefined && typeof value.stream !== 'boolean') return null
  if (value.max_tokens !== undefined && value.max_completion_tokens !== undefined) return null

  const maxTokens = value.max_tokens ?? value.max_completion_tokens ?? 1024
  if (!Number.isSafeInteger(maxTokens) || Number(maxTokens) < 1
    || Number(maxTokens) > MAX_GATEWAY_OUTPUT_TOKENS) return null
  if (value.temperature !== undefined && !isBoundedNumber(value.temperature, 0, 2)) return null
  if (value.top_p !== undefined && !isBoundedNumber(value.top_p, 0, 1)) return null
  if (value.presence_penalty !== undefined && !isBoundedNumber(value.presence_penalty, -2, 2)) return null
  if (value.frequency_penalty !== undefined && !isBoundedNumber(value.frequency_penalty, -2, 2)) return null
  if (value.stop !== undefined && !isStopValue(value.stop)) return null
  if (!Array.isArray(value.messages) || value.messages.length === 0
    || value.messages.length > MAX_GATEWAY_MESSAGES) return null

  const messages: ChatMessage[] = []
  for (const item of value.messages) {
    if (!isRecord(item)
      || (item.role !== 'system' && item.role !== 'user' && item.role !== 'assistant')
      || typeof item.content !== 'string'
      || item.content.length > MAX_GATEWAY_MESSAGE_LENGTH) return null
    messages.push({ role: item.role, content: item.content })
  }
  const totalLength = messages.reduce((total, message) => total + message.content.length, 0)
  if (totalLength > MAX_GATEWAY_TOTAL_MESSAGE_LENGTH) return null

  return {
    model: value.model.trim(),
    messages,
    stream: value.stream === true,
    maxTokens: Number(maxTokens),
    ...(typeof value.temperature === 'number' ? { temperature: value.temperature } : {}),
    ...(typeof value.top_p === 'number' ? { topP: value.top_p } : {}),
    ...(typeof value.presence_penalty === 'number' ? { presencePenalty: value.presence_penalty } : {}),
    ...(typeof value.frequency_penalty === 'number' ? { frequencyPenalty: value.frequency_penalty } : {}),
    ...(typeof value.stop === 'string' || Array.isArray(value.stop) ? { stop: value.stop } : {}),
  }
}

export async function readGatewayBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes = MAX_GATEWAY_BODY_BYTES,
): Promise<unknown | null> {
  if (!body) return null
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
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

export function applyGatewayGenerationOptions(
  providerStyle: 'openai-compatible' | 'anthropic' | 'gemini',
  adapterBody: unknown,
  request: GatewayChatRequest,
): unknown {
  if (!isRecord(adapterBody)) return adapterBody
  if (providerStyle === 'openai-compatible') {
    return {
      ...adapterBody,
      max_tokens: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.topP === undefined ? {} : { top_p: request.topP }),
      ...(request.presencePenalty === undefined ? {} : { presence_penalty: request.presencePenalty }),
      ...(request.frequencyPenalty === undefined ? {} : { frequency_penalty: request.frequencyPenalty }),
      ...(request.stop === undefined ? {} : { stop: request.stop }),
    }
  }
  if (providerStyle === 'anthropic') {
    return {
      ...adapterBody,
      max_tokens: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.topP === undefined ? {} : { top_p: request.topP }),
      ...(request.stop === undefined ? {} : {
        stop_sequences: typeof request.stop === 'string' ? [request.stop] : request.stop,
      }),
    }
  }

  const generationConfig = isRecord(adapterBody.generationConfig)
    ? adapterBody.generationConfig
    : {}
  return {
    ...adapterBody,
    generationConfig: {
      ...generationConfig,
      maxOutputTokens: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.topP === undefined ? {} : { topP: request.topP }),
      ...(request.stop === undefined ? {} : {
        stopSequences: typeof request.stop === 'string' ? [request.stop] : request.stop,
      }),
    },
  }
}
