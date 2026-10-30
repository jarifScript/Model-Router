import type { ProviderAdapter, ChatMessage, AdapterRequest, ProviderErrorClass } from './types.ts'
import { isRecord, parseJsonEvent, readSseData } from './sse.ts'
import { getProviderConfig, resolveProviderHeaders } from '../providers.ts'
import { parseAnthropicModels } from '../models.ts'

function classifyError(status: number): ProviderErrorClass {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 402) return 'quota'
  if (status === 404) return 'model_not_found'
  if (status === 400 || status === 422) return 'bad_request'
  if (status === 429) return 'rate_limit'
  if (status === 408 || status === 504) return 'timeout'
  return 'server'
}

async function* parseStream(response: Response): AsyncIterable<string> {
  let streamComplete = false
  for await (const data of readSseData(response)) {
    const event = parseJsonEvent(data)
    if (!isRecord(event)) continue
    if (event.type === 'error') throw new Error('Anthropic reported a stream error.')
    if (event.type === 'message_stop') {
      streamComplete = true
      break
    }
    if (event.type !== 'content_block_delta' || !isRecord(event.delta)) continue
    if (event.delta.type === 'text_delta' && typeof event.delta.text === 'string') {
      yield event.delta.text
    }
  }
  if (!streamComplete) throw new Error('Anthropic stream ended before message_stop.')
}

export const anthropicAdapter: ProviderAdapter = {
  buildRequest(model: string, messages: ChatMessage[]): AdapterRequest {
    const config = getProviderConfig('anthropic')
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n')
    return {
      url: `${config.baseUrl.replace(/\/$/, '')}/${config.chatPath.replace(/^\//, '')}`,
      headers: {
        ...resolveProviderHeaders(config, ''),
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: {
        model,
        max_tokens: 1024,
        stream: true,
        ...(system ? { system } : {}),
        messages: messages
          .filter((message) => message.role !== 'system')
          .map(({ role, content }) => ({ role, content })),
      },
    }
  },
  buildTestRequest(model: string): AdapterRequest {
    const request = anthropicAdapter.buildRequest(model, [{ role: 'user', content: 'Hi' }])
    const body = request.body as Record<string, unknown>
    return {
      ...request,
      headers: { ...request.headers, accept: 'application/json' },
      body: { ...body, max_tokens: 5, stream: false },
      isModelTest: true,
    }
  },
  parseStream,
  classifyError,
  listModels: parseAnthropicModels,
}

export default anthropicAdapter
