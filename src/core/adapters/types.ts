// Shared request, message, and adapter types for provider transports.
import type { ModelInfo } from '../models.ts'

export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  content: string
}

export type ProviderErrorClass =
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'auth'
  | 'quota'
  | 'model_not_found'
  | 'bad_request'
  | 'content_filter'
  | 'network'
  | 'stream_interrupted'

export type AdapterRequest = {
  url: string
  headers: HeadersInit
  body: unknown
  isModelTest?: boolean
}

export type ProviderStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }

export interface ProviderAdapter {
  buildRequest(model: string, messages: ChatMessage[]): AdapterRequest
  buildTestRequest(model: string): AdapterRequest
  parseStream(response: Response): AsyncIterable<string>
  parseStreamEvents?(response: Response): AsyncIterable<ProviderStreamEvent>
  classifyError(status: number): ProviderErrorClass
  listModels(value: unknown): ModelInfo[]
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly errorClass: ProviderErrorClass,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}
