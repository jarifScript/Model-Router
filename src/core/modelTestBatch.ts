import type { ModelInfo } from './models'
import type { ModelTestRecord } from './modelTest'

export const MAX_BATCH_MODELS = 20

export type BatchModel = {
  model: ModelInfo
  keyId: string
}

export type BatchProgress = {
  completed: number
  total: number
  current: number
}

export type BatchOptions = {
  concurrency?: number
  now?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  onResult?: (model: BatchModel, result: ModelTestRecord) => void
  onProgress?: (progress: BatchProgress) => void
  onProviderPause?: (providerId: string, milliseconds: number) => void
  onProviderStopped?: (providerId: string) => void
}

export function requiresPaidTestConfirmation(models: readonly ModelInfo[]): boolean {
  return models.some((model) => model.isFree !== true)
}

export async function runModelTestBatch(
  models: readonly BatchModel[],
  test: (model: BatchModel, signal: AbortSignal) => Promise<ModelTestRecord>,
  signal: AbortSignal,
  options: BatchOptions = {},
): Promise<ModelTestRecord[]> {
  if (models.length > MAX_BATCH_MODELS) {
    throw new Error(`Select no more than ${MAX_BATCH_MODELS} models at a time.`)
  }
  const concurrency = Math.min(3, Math.max(1, options.concurrency ?? 3))
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((milliseconds: number, abortSignal: AbortSignal) => (
    new Promise<void>((resolve, reject) => {
      if (abortSignal.aborted) {
        reject(new DOMException('Batch cancelled.', 'AbortError'))
        return
      }
      const timeout = setTimeout(() => {
        abortSignal.removeEventListener('abort', onAbort)
        resolve()
      }, milliseconds)
      function onAbort() {
        clearTimeout(timeout)
        reject(new DOMException('Batch cancelled.', 'AbortError'))
      }
      abortSignal.addEventListener('abort', onAbort, { once: true })
    })
  ))
  const pending = models.map((model, index) => ({ model, index })).filter(({ model }) => Boolean(model.keyId))
  const results: ModelTestRecord[] = []
  const providerRateLimits = new Map<string, number>()
  const providerPausedUntil = new Map<string, number>()
  const stoppedProviders = new Set<string>()
  let completed = 0
  let current = 0

  async function worker() {
    while (true) {
      if (signal.aborted) return
      const pendingIndex = pending.findIndex(({ model }) => !stoppedProviders.has(model.model.providerId))
      if (pendingIndex < 0) return
      const [item] = pending.splice(pendingIndex, 1)
      const providerId = item.model.model.providerId
      const pausedUntil = providerPausedUntil.get(providerId) ?? 0
      const pauseDuration = pausedUntil - now()
      if (pauseDuration > 0) {
        pending.splice(pendingIndex, 0, item)
        options.onProviderPause?.(providerId, pauseDuration)
        await sleep(pauseDuration, signal)
        continue
      }

      current += 1
      options.onProgress?.({ completed, total: models.length, current })
      try {
        const result = await test(item.model, signal)
        results[item.index] = result
        options.onResult?.(item.model, result)
        if (result.status === 'rate_limited') {
          const count = (providerRateLimits.get(providerId) ?? 0) + 1
          providerRateLimits.set(providerId, count)
          if (count >= 2) {
            stoppedProviders.add(providerId)
            options.onProviderStopped?.(providerId)
          } else {
            providerPausedUntil.set(providerId, now() + 10_000)
            options.onProviderPause?.(providerId, 10_000)
          }
        }
      } catch (error) {
        if (!signal.aborted) throw error
      } finally {
        current -= 1
        completed += 1
        options.onProgress?.({ completed, total: models.length, current })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()))
  return results.filter((result): result is ModelTestRecord => result !== undefined)
}
