import type { ProviderErrorClass } from './adapters/types.ts'
import type { ProviderId } from './providers.ts'

export type RouterFailureClass = Exclude<ProviderErrorClass, 'stream_interrupted'>

export class RouterRequestError extends Error {
  constructor(
    message: string,
    public readonly errorClass: ProviderErrorClass,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'RouterRequestError'
  }
}

export type TargetFailure = {
  provider: ProviderId
  model: string
  keyId: string
  errorClass: ProviderErrorClass
  attempts: number
  httpStatus?: number
}

export class AllTargetsFailed extends Error {
  constructor(public readonly failures: TargetFailure[]) {
    super('All route targets failed.')
    this.name = 'AllTargetsFailed'
  }
}

export class StreamInterruptedError extends RouterRequestError {
  constructor() {
    super('The response stream was interrupted after it started.', 'stream_interrupted')
    this.name = 'StreamInterruptedError'
  }
}

export function classifyHttpError(status: number, providerMessage = ''): ProviderErrorClass {
  const normalizedMessage = providerMessage.toLowerCase()
  if (normalizedMessage.includes('content_filter') || normalizedMessage.includes('content filter')
    || normalizedMessage.includes('moderation')) return 'content_filter'
  if (
    status === 404
    || normalizedMessage.includes('model_not_found')
    || normalizedMessage.includes('model not found')
    || normalizedMessage.includes('model was not found')
    || normalizedMessage.includes('no such model')
    || normalizedMessage.includes('no endpoints found for model')
    || normalizedMessage.includes('model does not exist')
  ) return 'model_not_found'
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 429) return 'rate_limit'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 400 || status === 422) return 'bad_request'
  return 'server'
}

export function friendlyErrorMessage(errorClass: ProviderErrorClass): string {
  switch (errorClass) {
    case 'auth': return 'Your key was rejected. Check the saved key.'
    case 'quota': return 'Not enough credits or quota for this provider.'
    case 'model_not_found': return 'The model was not found or is not available to this key.'
    case 'rate_limit': return 'Rate limited, try again soon.'
    case 'timeout': return 'The provider request timed out.'
    case 'bad_request': return 'The request is invalid. Check the model and message format.'
    case 'content_filter': return 'The request was blocked by the provider content filter.'
    case 'network': return 'Could not reach the provider. Check your connection.'
    case 'stream_interrupted': return 'The response stream was interrupted. No fallback was attempted.'
    case 'server': return 'The provider returned an error. Please try again.'
  }
}

export function getRetryAfterMs(headers: Headers, nowMs: number): number | undefined {
  const value = headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.min(Math.max(date - nowMs, 0), 5000)
}
