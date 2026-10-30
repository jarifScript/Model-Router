import { describe, expect, it } from 'vitest'
import { ProviderHealth, type Clock } from './health'
import { orderTargets } from './strategies'
import type { RouteTarget } from './route-types'

const targetA: RouteTarget = { provider: 'openai', model: 'gpt-4.1-nano', keyId: 'a', weight: 1 }
const targetB: RouteTarget = { provider: 'openai', model: 'gpt-4o-mini', keyId: 'b', weight: 3 }

function fakeClock() {
  let now = 0
  const clock: Clock = {
    now: () => now,
    sleep: async (ms) => { now += ms },
  }
  return { clock, advance: (ms: number) => { now += ms } }
}

describe('circuit breaker', () => {
  it('opens after three transient failures, permits a probe after cooldown, and closes on success', () => {
    const timer = fakeClock()
    const health = new ProviderHealth(timer.clock)
    health.recordFailure(targetA, 'server')
    health.recordFailure(targetA, 'network')
    expect(health.snapshot().byCircuit['openai:a'].open).toBe(false)
    health.recordFailure(targetA, 'timeout')
    expect(health.snapshot().byCircuit['openai:a'].open).toBe(true)
    expect(health.shouldAllow(targetA)).toBe(false)
    timer.advance(30_000)
    expect(health.shouldAllow(targetA)).toBe(true)
    expect(health.shouldAllow(targetA)).toBe(false)
    health.recordSuccess(targetA, 80)
    expect(health.snapshot().byCircuit['openai:a']).toMatchObject({
      open: false,
      consecutiveFailures: 0,
    })
    expect(health.snapshot().byTarget['openai:a:gpt-4.1-nano']).toMatchObject({
      averageLatencyMs: 80,
    })
  })

  it('doubles cooldown after a failed half-open probe and caps it at 120 seconds', () => {
    const timer = fakeClock()
    const health = new ProviderHealth(timer.clock)
    for (let failure = 0; failure < 3; failure += 1) health.recordFailure(targetA, 'server')
    timer.advance(30_000)
    expect(health.shouldAllow(targetA)).toBe(true)
    health.recordFailure(targetA, 'server')
    expect(health.snapshot().byCircuit['openai:a'].openUntil).toBe(90_000)
    timer.advance(60_000)
    expect(health.shouldAllow(targetA)).toBe(true)
    health.recordFailure(targetA, 'server')
    expect(health.snapshot().byCircuit['openai:a'].openUntil).toBe(210_000)
    timer.advance(120_000)
    expect(health.shouldAllow(targetA)).toBe(true)
    health.recordFailure(targetA, 'server')
    expect(health.snapshot().byCircuit['openai:a'].openUntil).toBe(330_000)
  })
})

describe('target strategies', () => {
  it('returns priority, round-robin, weighted, lowest-latency, and lowest-cost orders', () => {
    const health = new ProviderHealth()
    health.advanceStrategy('round_robin')
    health.recordSuccess(targetA, 200)
    health.recordSuccess(targetB, 30)
    const snapshot = health.snapshot()
    const targets = [targetA, targetB]
    expect(orderTargets(targets, snapshot, 'priority')).toEqual(targets)
    expect(orderTargets(targets, snapshot, 'round_robin')).toEqual([targetB, targetA])
    expect(orderTargets(targets, snapshot, 'weighted')).toEqual([targetA, targetB])
    expect(orderTargets(targets, snapshot, 'lowest_latency')).toEqual([targetB, targetA])
    expect(orderTargets(targets, snapshot, 'lowest_cost')).toEqual([targetA, targetB])
    health.advanceStrategy('weighted')
    expect(orderTargets(targets, health.snapshot(), 'weighted')).toEqual([targetB, targetA])
    expect(orderTargets([
      targetB,
      { provider: 'openrouter', model: 'an-unpriced-model', keyId: 'unknown' },
    ], health.snapshot(), 'lowest_cost')).toEqual([
      targetB,
      { provider: 'openrouter', model: 'an-unpriced-model', keyId: 'unknown' },
    ])
  })

  it('skips open targets and uses the oldest-opened target if every target is open', () => {
    const timer = fakeClock()
    const health = new ProviderHealth(timer.clock)
    health.recordFailure(targetA, 'server')
    health.recordFailure(targetA, 'server')
    health.recordFailure(targetA, 'server')
    expect(orderTargets([targetA, targetB], health.snapshot(), 'priority')).toEqual([targetB])
    timer.advance(10)
    health.recordFailure(targetB, 'server')
    health.recordFailure(targetB, 'server')
    health.recordFailure(targetB, 'server')
    expect(orderTargets([targetA, targetB], health.snapshot(), 'priority')).toEqual([targetA])
    health.recordFailure(targetB, 'server')
    health.recordFailure(targetB, 'server')
    health.recordFailure(targetB, 'server')
    expect(orderTargets([targetA, targetB], health.snapshot(), 'priority')).toEqual([targetA])
  })
})
