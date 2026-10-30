// Factory for OpenAI-compatible chat-completion providers.
import type { OpenAICompatibleProviderConfig } from '../providers.ts'
import { resolveProviderHeaders } from '../providers.ts'
import type {
  AdapterRequest,
  ChatMessage,
  ProviderAdapter,
  ProviderErrorClass,
  ProviderStreamEvent,
} from './types.ts'
import { ProviderRequestError } from './types.ts'
import { parseOpenAICompatibleModels, parseOpenRouterModels } from '../models.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  let content = ''
  for (const part of value) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      content += part.text
    }
  }
  return content
}

function classifyError(status: number): ProviderErrorClass {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 404) return 'model_not_found'
  if (status === 400 || status === 404 || status === 422) return 'bad_request'
  if (status === 429) return 'rate_limit'
  if (status === 408 || status === 504) return 'timeout'
  return 'server'
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

async function* parseStreamEvents(response: Response): AsyncIterable<ProviderStreamEvent> {
  if (!response.body) {
    throw new ProviderRequestError('The provider returned an empty stream.', 'server', response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventData: string[] = []
  let streamComplete = false

  function consumeLine(line: string): { events: ProviderStreamEvent[]; done: boolean } {
    if (line === '') {
      const data = eventData.join('\n')
      eventData = []
      if (!data) return { events: [], done: false }
      if (data === '[DONE]') return { events: [], done: true }

      let payload: unknown
      try {
        payload = JSON.parse(data)
      } catch {
        throw new ProviderRequestError('The provider returned an invalid stream event.', 'server')
      }
      if (!isRecord(payload)) return { events: [], done: false }
      if (isRecord(payload.error)) {
        throw new ProviderRequestError('The provider reported a stream error.', 'server')
      }
      const events: ProviderStreamEvent[] = []
      if (isRecord(payload.usage)) {
        const inputTokens = nonNegativeInteger(payload.usage.prompt_tokens ?? payload.usage.input_tokens)
        const outputTokens = nonNegativeInteger(payload.usage.completion_tokens ?? payload.usage.output_tokens)
        if (inputTokens !== undefined && outputTokens !== undefined) {
          events.push({ type: 'usage', inputTokens, outputTokens })
        }
      }
      const choices = payload.choices
      if (Array.isArray(choices) && isRecord(choices[0])) {
        const delta = choices[0].delta
        const text = isRecord(delta) ? readContent(delta.content) : ''
        if (text) events.push({ type: 'text', text })
      }
      return { events, done: false }
    }

    if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /, ''))
    return { events: [], done: false }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const event = consumeLine(line)
        for (const item of event.events) yield item
        if (event.done) {
          streamComplete = true
          return
        }
      }

      if (done) {
        if (buffer) {
          const event = consumeLine(buffer)
          for (const item of event.events) yield item
          if (event.done) streamComplete = true
        }
        const finalEvent = consumeLine('')
        for (const item of finalEvent.events) yield item
        if (finalEvent.done) streamComplete = true
        if (!streamComplete) throw new Error('The provider stream ended before its completion marker.')
        return
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function* parseStream(response: Response): AsyncIterable<string> {
  for await (const event of parseStreamEvents(response)) {
    if (event.type === 'text') yield event.text
  }
}

export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleProviderConfig,
  appOrigin: string,
): ProviderAdapter {
  return {
    buildRequest(model: string, messages: ChatMessage[]): AdapterRequest {
      return {
        url: `${config.baseUrl.replace(/\/$/, '')}/${config.chatPath.replace(/^\//, '')}`,
        headers: {
          ...resolveProviderHeaders(config, appOrigin),
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: {
          model,
          messages,
          stream: true,
          max_tokens: 1024,
          ...(config.id === 'openai' ? { stream_options: { include_usage: true } } : {}),
        },
      }
    },
    buildTestRequest(model: string): AdapterRequest {
      const request = this.buildRequest(model, [{ role: 'user', content: 'Hi' }])
      const body = request.body as Record<string, unknown>
      return {
        ...request,
        headers: { ...request.headers, accept: 'application/json' },
        body: { ...body, stream: false, max_tokens: 5 },
        isModelTest: true,
      }
    },
    parseStream,
    parseStreamEvents,
    classifyError,
    listModels: (value) => config.id === 'openrouter'
      ? parseOpenRouterModels(value)
      : parseOpenAICompatibleModels(config.id, value),
  }
}
