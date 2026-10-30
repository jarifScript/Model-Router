import type { ProviderAdapter, ChatMessage, AdapterRequest, ProviderErrorClass } from './types.ts'
import { isRecord, parseJsonEvent, readSseData } from './sse.ts'
import { ProviderRequestError } from './types.ts'
import { getProviderConfig } from '../providers.ts'
import { parseGeminiModels } from '../models.ts'

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
    if (isRecord(event.promptFeedback) && typeof event.promptFeedback.blockReason === 'string') {
      throw new ProviderRequestError('Gemini blocked this request.', 'content_filter')
    }
    const candidates = event.candidates
    if (!Array.isArray(candidates) || !isRecord(candidates[0])) continue
    if (typeof candidates[0].finishReason === 'string') {
      streamComplete = true
      if (candidates[0].finishReason === 'SAFETY') {
        throw new ProviderRequestError('Gemini blocked this request.', 'content_filter')
      }
    }
    const content = candidates[0].content
    if (!isRecord(content) || !Array.isArray(content.parts)) continue
    for (const part of content.parts) {
      if (isRecord(part) && typeof part.text === 'string') yield part.text
    }
  }
  if (!streamComplete) throw new Error('Gemini stream ended before its finish reason.')
}

export const geminiAdapter: ProviderAdapter = {
  buildRequest(model: string, messages: ChatMessage[]): AdapterRequest {
    const config = getProviderConfig('gemini')
    const system = messages.filter((message) => message.role === 'system')
    const contents = messages
      .filter((message) => message.role !== 'system')
      .map(({ role, content }) => ({
        role: role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }],
      }))
    return {
      url: `${config.baseUrl.replace(/\/$/, '')}/${config.chatPath
        .replace(/^\//, '')
        .replace('{model}', encodeURIComponent(model))}`,
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: {
        ...(system.length
          ? { systemInstruction: { parts: system.map(({ content }) => ({ text: content })) } }
          : {}),
        contents,
        generationConfig: { maxOutputTokens: 1024 },
      },
    }
  },
  buildTestRequest(model: string): AdapterRequest {
    const request = geminiAdapter.buildRequest(model, [{ role: 'user', content: 'Hi' }])
    return {
      ...request,
      url: request.url.replace(':streamGenerateContent?alt=sse', ':generateContent'),
      headers: { ...request.headers, accept: 'application/json' },
      body: { ...request.body as Record<string, unknown>, generationConfig: { maxOutputTokens: 5 } },
      isModelTest: true,
    }
  },
  parseStream,
  classifyError,
  listModels: parseGeminiModels,
}

export default geminiAdapter
