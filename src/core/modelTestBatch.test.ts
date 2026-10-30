import { describe, expect, it } from 'vitest'
import type { ModelInfo } from './models'
import type { ModelTestRecord } from './modelTest'
import type { ProviderId } from './providers'
import { requiresPaidTestConfirmation, runModelTestBatch } from './modelTestBatch'

function item(id: string, providerId: ProviderId = 'openrouter', isFree?: boolean) {
  const model: ModelInfo = {
    id,
    name: id,
    providerId,
    priceKnown: isFree !== undefined,
    ...(isFree === undefined ? {} : {
      inputPricePerM: isFree ? 0 : 1,
      outputPricePerM: isFree ? 0 : 1,
      isFree,
    }),
  }
  return { model, keyId: 'key-id' }
}

function result(model: ModelInfo, status: ModelTestRecord['status'] = 'working'): ModelTestRecord {
  return {
    providerId: model.providerId,
    modelId: model.id,
    status,
    latencyMs: 1,
    testedAt: 1,
  }
}

describe('model-test batches', () => {
  it('caps concurrency at three', async () => {
    const models = [item('a'), item('b'), item('c'), item('d'), item('e')]
    let active = 0
    let maxActive = 0
    const batch = runModelTestBatch(models, async ({ model }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return result(model)
    }, new AbortController().signal)
    await expect(batch).resolves.toHaveLength(5)
    expect(maxActive).toBe(3)
  })

  it('pauses a provider for ten seconds after a rate limit', async () => {
    const models = [item('a'), item('b'), item('c')]
    let now = 0
    const sleeps: number[] = []
    let calls = 0
    const results = await runModelTestBatch(models, async ({ model }) => {
      calls += 1
      return result(model, calls === 1 ? 'rate_limited' : 'working')
    }, new AbortController().signal, {
      concurrency: 1,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
    })
    expect(sleeps).toEqual([10_000])
    expect(results).toHaveLength(3)
  })

  it('stops queued provider tests after a second rate limit', async () => {
    const models = [item('a'), item('b'), item('c')]
    let calls = 0
    let now = 0
    const results = await runModelTestBatch(models, async ({ model }) => {
      calls += 1
      return result(model, 'rate_limited')
    }, new AbortController().signal, {
      concurrency: 1,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
    })
    expect(calls).toBe(2)
    expect(results).toHaveLength(2)
  })

  it('supports cancellation and confirmation is needed unless every model is free', async () => {
    const controller = new AbortController()
    const pending = runModelTestBatch([item('a')], async () => await new Promise<ModelTestRecord>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    }), controller.signal)
    controller.abort()
    await expect(pending).resolves.toEqual([])
    expect(requiresPaidTestConfirmation([item('free', 'openrouter', true).model])).toBe(false)
    expect(requiresPaidTestConfirmation([item('unknown').model])).toBe(true)
    expect(requiresPaidTestConfirmation([item('free', 'openrouter', true).model, item('paid', 'openrouter', false).model])).toBe(true)
  })

  it('allows a batch of twenty models', async () => {
    const models = Array.from({ length: 20 }, (_, index) => item(String(index)))
    await expect(runModelTestBatch(
      models,
      async ({ model }) => result(model),
      new AbortController().signal,
    )).resolves.toHaveLength(20)
  })

  it('rejects batches over twenty models', async () => {
    await expect(runModelTestBatch(
      Array.from({ length: 21 }, (_, index) => item(String(index))),
      async ({ model }) => result(model),
      new AbortController().signal,
    )).rejects.toThrow('Select no more than 20')
  })
})
