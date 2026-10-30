import { ProviderRequestError, type AdapterRequest, type ProviderAdapter, type ProviderErrorClass, type ProviderStreamEvent } from './adapters/types.ts'
import { AllTargetsFailed, classifyHttpError, friendlyErrorMessage, RouterRequestError, StreamInterruptedError, getRetryAfterMs } from './errors.ts'
import { getCircuitKey, getTargetHealthKey, ProviderHealth, systemClock, type Clock } from './health.ts'
import { orderTargets } from './strategies.ts'
import type { RouteTarget, RouterRequest, RoutingRule } from './route-types.ts'
import type { ProviderId } from './providers.ts'

export type RouterEvent =
  | { type: 'attempt_start'; target: RouteTarget; attempt: number }
  | { type: 'fallback'; from: RouteTarget; to: RouteTarget; errorClass: ProviderErrorClass }
  | { type: 'chunk'; target: RouteTarget; text: string }
  | { type: 'usage'; target: RouteTarget; inputTokens: number; outputTokens: number }
  | { type: 'done'; target: RouteTarget }
  | { type: 'error'; target?: RouteTarget; errorClass: ProviderErrorClass; message: string; httpStatus?: number }

export type RouterDependencies = {
  adapters: Partial<Record<ProviderId, ProviderAdapter>>
  transport: (
    target: RouteTarget,
    request: AdapterRequest,
    apiKey: string,
    signal: AbortSignal,
  ) => Promise<Response>
  health: ProviderHealth
  getModelCost?: (provider: ProviderId, model: string) => number | undefined
  clock?: Clock
  random?: () => number
}

type FailureSummary = { errorClass: ProviderErrorClass; retryAfterMs?: number; httpStatus?: number }
const SAME_TARGET_RETRY = new Set<ProviderErrorClass>(['rate_limit', 'server', 'timeout', 'network'])
const FAILOVER_ERRORS = new Set<ProviderErrorClass>(['rate_limit', 'server', 'timeout'])
const MAX_SAME_TARGET_ATTEMPTS = 2

function canFailOver(errorClass: ProviderErrorClass, rule: RoutingRule): boolean {
  return FAILOVER_ERRORS.has(errorClass) || (rule.failoverOnQuota === true && errorClass === 'quota')
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function errorText(responseText: string): string {
  try {
    const parsed: unknown = JSON.parse(responseText)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      if (typeof record.message === 'string') return record.message
      if (typeof record.error === 'string') return record.error
      if (typeof record.error === 'object' && record.error !== null && 'message' in record.error) {
        const nested = record.error as { message?: unknown }
        if (typeof nested.message === 'string') return nested.message
      }
    }
  } catch {
    return ''
  }
  return ''
}

async function getResponseFailure(response: Response, nowMs: number): Promise<FailureSummary> {
  const raw = await response.text()
  return {
    errorClass: classifyHttpError(response.status, errorText(raw)),
    retryAfterMs: getRetryAfterMs(response.headers, nowMs),
    httpStatus: response.status,
  }
}

function createTimeoutController(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  firstTokenTimeoutMs?: number,
) {
  const controller = new AbortController()
  let timedOut = false
  let firstTokenTimer: ReturnType<typeof setTimeout> | undefined
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Route attempt timed out.', 'TimeoutError'))
  }, timeoutMs)
  if (firstTokenTimeoutMs !== undefined) {
    firstTokenTimer = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('First response timed out.', 'TimeoutError'))
    }, Math.min(timeoutMs, firstTokenTimeoutMs))
  }
  return {
    controller,
    timedOut: () => timedOut,
    markFirstToken: () => {
      if (firstTokenTimer !== undefined) {
        clearTimeout(firstTokenTimer)
        firstTokenTimer = undefined
      }
    },
    cleanup: () => {
      clearTimeout(timer)
      if (firstTokenTimer !== undefined) clearTimeout(firstTokenTimer)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
  }
}

function simulatedFailure(
  request: RouterRequest,
  target: RouteTarget,
): ProviderErrorClass | undefined {
  return request.simulateFailures?.[`${target.provider}:${target.keyId}:${target.model}`]
}

function createFailure(errorClass: ProviderErrorClass, httpStatus?: number): RouterRequestError {
  return new RouterRequestError(friendlyErrorMessage(errorClass), errorClass, httpStatus)
}

export async function* route(
  request: RouterRequest & { keysById: Record<string, string> },
  rule: RoutingRule,
  deps: RouterDependencies,
): AsyncGenerator<RouterEvent> {
  const clock = deps.clock ?? systemClock
  const random = deps.random ?? Math.random
  if (!rule.targets.length) throw new RouterRequestError('Add at least one target to this route.', 'bad_request')
  if (rule.targets.some((target) =>
    !target.model.trim()
    || target.model.length > 180
    || !target.keyId.trim()
    || (target.weight !== undefined && (!Number.isFinite(target.weight) || target.weight < 1 || target.weight > 100)),
  )) throw new RouterRequestError('Each route target must have a valid model and saved key.', 'bad_request')
  if (!Number.isInteger(rule.maxAttempts) || rule.maxAttempts < 1 || rule.maxAttempts > 20) {
    throw new RouterRequestError('Route max attempts must be between 1 and 20.', 'bad_request')
  }
  if (rule.timeoutMs < 1000 || rule.timeoutMs > 120_000) {
    throw new RouterRequestError('Route timeout must be between 1 and 120 seconds.', 'bad_request')
  }
  if (rule.firstTokenTimeoutMs !== undefined
    && (!Number.isInteger(rule.firstTokenTimeoutMs)
      || rule.firstTokenTimeoutMs < 1000
      || rule.firstTokenTimeoutMs > 120_000)) {
    throw new RouterRequestError('First response timeout must be between 1 and 120 seconds.', 'bad_request')
  }
  const maxCycles = rule.maxCycles ?? 1
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 2) {
    throw new RouterRequestError('Route cycles must be between 1 and 2.', 'bad_request')
  }
  if (rule.targets.some((target) =>
    (target.timeoutMs !== undefined
      && (!Number.isInteger(target.timeoutMs) || target.timeoutMs < 1000 || target.timeoutMs > 120_000))
    || (target.maxAttempts !== undefined
      && (!Number.isInteger(target.maxAttempts) || target.maxAttempts < 1 || target.maxAttempts > 20)),
  )) throw new RouterRequestError('Each target must have valid timeout and attempt settings.', 'bad_request')

  const healthAtStart = deps.health.snapshot()
  const allTargetsOpen = rule.targets.every((target) => healthAtStart.byCircuit[getCircuitKey(target)]?.open)
  const orderedTargets = orderTargets(rule.targets, healthAtStart, rule.strategy, deps.getModelCost)
  const failures: AllTargetsFailed['failures'] = []
  const retryAfterByTarget = new Map<string, number>()
  let totalAttempts = 0

  for (let cycle = 0; cycle < maxCycles && totalAttempts < rule.maxAttempts; cycle += 1) {
    for (let targetIndex = 0; targetIndex < orderedTargets.length; targetIndex += 1) {
      const target = orderedTargets[targetIndex]
      if (totalAttempts >= rule.maxAttempts) break
      const targetRetryKey = getTargetHealthKey(target)
      const retryDelay = retryAfterByTarget.get(targetRetryKey)
      if (retryDelay !== undefined) {
        retryAfterByTarget.delete(targetRetryKey)
        await clock.sleep(retryDelay, request.signal)
      }
      const adapter = deps.adapters[target.provider]
      const apiKey = request.keysById[target.keyId]
      let targetAttempts = 0
      let lastFailure: FailureSummary | undefined
      const targetTimeoutMs = target.timeoutMs ?? rule.timeoutMs
      const maxTargetAttempts = target.maxAttempts ?? MAX_SAME_TARGET_ATTEMPTS

      if (!adapter) {
        const error = createFailure('bad_request')
        yield { type: 'error', target, errorClass: error.errorClass, message: error.message }
        throw error
      } else if (!apiKey) {
        lastFailure = { errorClass: 'auth' }
      } else if (!deps.health.shouldAllow(target, allTargetsOpen)) {
        lastFailure = { errorClass: 'server' }
      } else {
        for (let attempt = 1; attempt <= maxTargetAttempts && totalAttempts < rule.maxAttempts; attempt += 1) {
        if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const simulated = simulatedFailure(request, target)
        const timed = createTimeoutController(
          request.signal,
          targetTimeoutMs,
          rule.firstTokenTimeoutMs,
        )
        totalAttempts += 1
        targetAttempts += 1
        const startedAt = clock.now()
        let response: Response | undefined
        let emittedChunk = false

        try {
          yield { type: 'attempt_start', target, attempt }
          if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
          if (simulated) {
            if (simulated === 'timeout') {
              await clock.sleep(targetTimeoutMs, timed.controller.signal)
              throw new DOMException('Route attempt timed out.', 'TimeoutError')
            }
            lastFailure = { errorClass: simulated }
          } else {
            const adapterRequest = adapter.buildRequest(target.model, request.messages)
            response = await deps.transport(target, adapterRequest, apiKey, timed.controller.signal)
            if (response.ok) {
              try {
                const streamEvents: AsyncIterable<ProviderStreamEvent> = adapter.parseStreamEvents
                  ? adapter.parseStreamEvents(response)
                  : (async function* () {
                    for await (const text of adapter.parseStream(response)) {
                      yield { type: 'text', text } as const
                    }
                  })()
                for await (const streamEvent of streamEvents) {
                  if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
                  if (streamEvent.type === 'usage') {
                    yield {
                      type: 'usage',
                      target,
                      inputTokens: streamEvent.inputTokens,
                      outputTokens: streamEvent.outputTokens,
                    }
                  } else if (streamEvent.text) {
                    timed.markFirstToken()
                    emittedChunk = true
                    yield { type: 'chunk', target, text: streamEvent.text }
                  }
                }
              } catch (error) {
                if (request.signal?.aborted) throw error
                if (emittedChunk) {
                  if (error instanceof ProviderRequestError || error instanceof RouterRequestError) throw error
                  throw new StreamInterruptedError()
                }
                lastFailure = {
                  errorClass: timed.timedOut()
                    ? 'timeout'
                    : error instanceof ProviderRequestError || error instanceof RouterRequestError
                      ? error.errorClass
                      : 'network',
                }
              }
              if (!lastFailure) {
                deps.health.recordSuccess(target, Math.max(0, clock.now() - startedAt))
                if (rule.strategy === 'weighted' || rule.strategy === 'round_robin') {
                  deps.health.advanceStrategy(rule.strategy)
                }
                yield { type: 'done', target }
                return
              }
            } else {
              lastFailure = await getResponseFailure(response, clock.now())
            }
          }
        } catch (error) {
          if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
          if (emittedChunk) {
            const streamError = error instanceof ProviderRequestError || error instanceof RouterRequestError
              ? error
              : new StreamInterruptedError()
            if (streamError instanceof StreamInterruptedError) deps.health.recordFailure(target, 'network')
            yield {
              type: 'error',
              target,
              errorClass: streamError.errorClass,
              message: streamError.message,
              ...(streamError.status === undefined ? {} : { httpStatus: streamError.status }),
            }
            throw streamError
          }
          if (!lastFailure) {
            lastFailure = {
              errorClass: timed.timedOut()
                ? 'timeout'
                : isAbort(error)
                  ? 'timeout'
                  : error instanceof ProviderRequestError || error instanceof RouterRequestError
                    ? error.errorClass
                    : 'network',
            }
          }
        } finally {
          timed.cleanup()
          if (request.signal?.aborted) deps.health.cancelProbe(target)
        }

        if (!lastFailure) break
        deps.health.recordFailure(target, lastFailure.errorClass)
        if (lastFailure.errorClass === 'auth'
          || lastFailure.errorClass === 'quota'
          || lastFailure.errorClass === 'model_not_found') {
          deps.health.markNeedsAttention(target)
        }

        if (lastFailure.errorClass === 'bad_request' || lastFailure.errorClass === 'content_filter') {
          const error = createFailure(lastFailure.errorClass, lastFailure.httpStatus)
          yield {
            type: 'error',
            target,
            errorClass: error.errorClass,
            message: error.message,
            ...(error.status === undefined ? {} : { httpStatus: error.status }),
          }
          throw error
        }

        if (!canFailOver(lastFailure.errorClass, rule)) {
          const error = createFailure(lastFailure.errorClass, lastFailure.httpStatus)
          yield {
            type: 'error',
            target,
            errorClass: error.errorClass,
            message: error.message,
            ...(error.status === undefined ? {} : { httpStatus: error.status }),
          }
          throw error
        }

        if (lastFailure.errorClass === 'rate_limit' && lastFailure.retryAfterMs !== undefined) {
          retryAfterByTarget.set(targetRetryKey, lastFailure.retryAfterMs)
        }

        if (SAME_TARGET_RETRY.has(lastFailure.errorClass) && attempt < maxTargetAttempts
          && totalAttempts < rule.maxAttempts) {
          const backoff = Math.min(
            lastFailure.retryAfterMs ?? (500 * (2 ** (attempt - 1)) + Math.floor(random() * 500)),
            5000,
          )
          retryAfterByTarget.delete(targetRetryKey)
          await clock.sleep(backoff, request.signal)
          lastFailure = undefined
          continue
        }
        break
      }
      }

      if (lastFailure && !canFailOver(lastFailure.errorClass, rule)) {
        const error = createFailure(lastFailure.errorClass, lastFailure.httpStatus)
        yield {
          type: 'error',
          target,
          errorClass: error.errorClass,
          message: error.message,
          ...(error.status === undefined ? {} : { httpStatus: error.status }),
        }
        throw error
      }

      if (lastFailure) {
        if (lastFailure.errorClass === 'auth'
          || lastFailure.errorClass === 'quota'
          || lastFailure.errorClass === 'model_not_found') {
          deps.health.markNeedsAttention(target)
        }
        failures.push({
          provider: target.provider,
          model: target.model,
          keyId: target.keyId,
          errorClass: lastFailure.errorClass,
          attempts: targetAttempts,
          ...(lastFailure.httpStatus === undefined ? {} : { httpStatus: lastFailure.httpStatus }),
        })
      }

      const nextTarget = orderedTargets[targetIndex + 1]
        ?? (cycle + 1 < maxCycles ? orderedTargets[0] : undefined)
      if (nextTarget && totalAttempts < rule.maxAttempts && lastFailure) {
        yield { type: 'fallback', from: target, to: nextTarget, errorClass: lastFailure.errorClass }
      }
    }
  }

  const failed = new AllTargetsFailed(failures)
  yield {
    type: 'error',
    ...(failures.length ? {
      target: {
        provider: failures.at(-1)!.provider,
        model: failures.at(-1)!.model,
        keyId: failures.at(-1)!.keyId,
      },
    } : {}),
    errorClass: failures.at(-1)?.errorClass ?? 'server',
    message: failures.length ? friendlyErrorMessage(failures.at(-1)!.errorClass) : 'No route targets were available.',
    ...(failures.at(-1)?.httpStatus === undefined ? {} : { httpStatus: failures.at(-1)!.httpStatus }),
  }
  throw failed
}
