import type { ProviderAdapter, ProviderErrorClass } from './adapters/types'
import { classifyHttpError, RouterRequestError } from './errors'
import type { ProviderId } from './providers'
import type { RouteTarget } from './route-types'

export type ModelTestStatus =
  | 'working'
  | 'rate_limited'
  | 'auth_failed'
  | 'no_credits'
  | 'model_not_found'
  | 'timeout'
  | 'server_error'
  | 'network_error'

export type ModelTestResult = {
  status: ModelTestStatus
  latencyMs: number
  testedAt: number
  httpStatus?: number
}

export type ModelTestRecord = ModelTestResult & {
  providerId: ProviderId
  modelId: string
}

export type ModelTestTransport = (
  target: RouteTarget,
  request: ReturnType<ProviderAdapter['buildTestRequest']>,
  apiKey: string,
  signal: AbortSignal,
) => Promise<Response>

export type ModelTestDependencies = {
  adapter: ProviderAdapter
  transport: ModelTestTransport
  now?: () => number
}

function statusForError(errorClass: ProviderErrorClass): ModelTestStatus {
  switch (errorClass) {
    case 'rate_limit': return 'rate_limited'
    case 'auth': return 'auth_failed'
    case 'quota': return 'no_credits'
    case 'model_not_found': return 'model_not_found'
    case 'timeout': return 'timeout'
    case 'network': return 'network_error'
    default: return 'server_error'
  }
}

function statusForHttp(status: number): ModelTestStatus {
  return statusForError(classifyHttpError(status))
}

export async function testModel(
  providerId: ProviderId,
  modelId: string,
  keyId: string,
  apiKey: string,
  dependencies: ModelTestDependencies,
  signal?: AbortSignal,
): Promise<ModelTestRecord> {
  const now = dependencies.now ?? Date.now
  const startedAt = now()
  const target: RouteTarget = { provider: providerId, model: modelId, keyId }
  const request = dependencies.adapter.buildTestRequest(modelId)
  const timeoutController = new AbortController()
  let didTimeout = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let onExternalAbort: (() => void) | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true
      timeoutController.abort()
      reject(new RouterRequestError('Model test timed out.', 'timeout'))
    }, 15_000)
  })
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal
  const externalAbort = signal
    ? new Promise<never>((_, reject) => {
      onExternalAbort = () => reject(new DOMException('Model test cancelled.', 'AbortError'))
      if (signal.aborted) onExternalAbort()
      else signal.addEventListener('abort', onExternalAbort, { once: true })
    })
    : null

  try {
    const response = await Promise.race([
      dependencies.transport(target, request, apiKey, combinedSignal),
      timeout,
      ...(externalAbort ? [externalAbort] : []),
    ])
    const finishedAt = now()
    return {
      providerId,
      modelId,
      status: response.ok ? 'working' : statusForHttp(response.status),
      latencyMs: Math.max(0, finishedAt - startedAt),
      testedAt: finishedAt,
      ...(!response.ok ? { httpStatus: response.status } : {}),
    }
  } catch (error) {
    if (signal?.aborted && !didTimeout) throw error
    const finishedAt = now()
    let status: ModelTestStatus = didTimeout ? 'timeout' : 'network_error'
    if (error instanceof RouterRequestError) status = statusForError(error.errorClass)
    return {
      providerId,
      modelId,
      status,
      latencyMs: Math.max(0, finishedAt - startedAt),
      testedAt: finishedAt,
      ...(error instanceof RouterRequestError && error.status ? { httpStatus: error.status } : {}),
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (signal && onExternalAbort) signal.removeEventListener('abort', onExternalAbort)
  }
}
