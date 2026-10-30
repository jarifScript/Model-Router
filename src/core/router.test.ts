import { describe, expect, it } from 'vitest'
import type { ProviderAdapter } from './adapters/types'
import { ProviderHealth, type Clock } from './health'
import { AllTargetsFailed, RouterRequestError, StreamInterruptedError } from './errors'
import { route, type RouterDependencies } from './router'
import type { RouteTarget, RoutingRule } from './route-types'

const first: RouteTarget = { provider: 'openrouter', model: 'openrouter/free', keyId: 'key-1' }
const second: RouteTarget = { provider: 'openai', model: 'gpt-4o-mini', keyId: 'key-2' }
const messages = [{ role: 'user' as const, content: 'Fixture message' }]
const keysById = { 'key-1': 'fixture-key-1', 'key-2': 'fixture-key-2' }
const rule: RoutingRule = {
  alias: 'test',
  strategy: 'priority',
  timeoutMs: 10_000,
  maxAttempts: 4,
  targets: [first, second],
}

function fakeClock() {
  let now = 0
  const sleeps: number[] = []
  const clock: Clock = {
    now: () => now,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      sleeps.push(ms)
      now += ms
    },
  }
  return { clock, sleeps, advance: (ms: number) => { now += ms } }
}

function adapter(parseStream?: ProviderAdapter['parseStream']): ProviderAdapter {
  return {
    buildRequest: (model) => ({
      url: 'https://fixture.invalid',
      headers: { 'content-type': 'application/json' },
      body: { model },
    }),
    buildTestRequest: (model) => ({
      url: 'https://fixture.invalid',
      headers: { 'content-type': 'application/json' },
      body: { model },
      isModelTest: true,
    }),
    parseStream: parseStream ?? (async function* (response) {
      const text = await response.text()
      if (text) yield text
    }),
    classifyError: (status) => status === 429 ? 'rate_limit' : status >= 500 ? 'server' : 'bad_request',
    listModels: () => [],
  }
}

function deps(
  respond: (target: RouteTarget, signal: AbortSignal) => Promise<Response>,
  health = new ProviderHealth(),
  clock = fakeClock().clock,
  parser?: ProviderAdapter['parseStream'],
): RouterDependencies {
  const mockAdapter = adapter(parser)
  return {
    adapters: { openrouter: mockAdapter, openai: mockAdapter },
    health,
    clock,
    random: () => 0,
    transport: async (target, _request, _apiKey, signal) => await respond(target, signal),
  }
}

async function collect(generator: AsyncGenerator<unknown>) {
  const events: unknown[] = []
  try {
    for await (const event of generator) events.push(event)
    return { events, error: null as unknown }
  } catch (error) {
    return { events, error }
  }
}

describe('route', () => {
  it('succeeds on the first target', async () => {
    const { events, error } = await collect(route(
      { messages, keysById }, rule,
      deps(async () => new Response('hello')),
    ))
    expect(error).toBeNull()
    expect(events).toContainEqual({ type: 'chunk', target: first, text: 'hello' })
    expect(events.at(-1)).toEqual({ type: 'done', target: first })
  })

  it('retries a rate limit once and succeeds on the same target', async () => {
    const timer = fakeClock()
    let calls = 0
    const { events, error } = await collect(route(
      { messages, keysById }, { ...rule, maxAttempts: 2 },
      deps(async () => ++calls === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
        : new Response('recovered'), new ProviderHealth(timer.clock), timer.clock),
    ))
    expect(error).toBeNull()
    expect(calls).toBe(2)
    expect(timer.sleeps).toEqual([2000])
    expect(events.at(-1)).toEqual({ type: 'done', target: first })
  })

  it('does not retry a network error or switch targets', async () => {
    let calls = 0
    const { error } = await collect(route(
      { messages, keysById }, { ...rule, maxAttempts: 2 },
      deps(async () => {
        calls += 1
        if (calls === 1) throw new Error('offline')
        return new Response('reconnected')
      }),
    ))
    expect(error).toBeInstanceOf(RouterRequestError)
    expect((error as RouterRequestError).errorClass).toBe('network')
    expect(calls).toBe(1)
  })

  it('caps a Retry-After delay at five seconds', async () => {
    const timer = fakeClock()
    let calls = 0
    await collect(route(
      { messages, keysById }, { ...rule, maxAttempts: 2 },
      deps(async () => ++calls === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '120' } })
        : new Response('recovered'), new ProviderHealth(timer.clock), timer.clock),
    ))
    expect(timer.sleeps).toEqual([5000])
  })

  it('respects Retry-After before retrying a model on the next cycle', async () => {
    const timer = fakeClock()
    let calls = 0
    const cycleRule: RoutingRule = {
      ...rule,
      maxAttempts: 2,
      maxCycles: 2,
      targets: [{ ...first, maxAttempts: 1 }],
    }
    const { error } = await collect(route(
      { messages, keysById },
      cycleRule,
      deps(async () => ++calls === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '3' } })
        : new Response('recovered'), new ProviderHealth(timer.clock), timer.clock),
    ))
    expect(error).toBeNull()
    expect(calls).toBe(2)
    expect(timer.sleeps).toEqual([3000])
  })

  it('retries a rate limit twice, then moves to the next target', async () => {
    const timer = fakeClock()
    const calls = new Map<string, number>()
    const { events, error } = await collect(route(
      { messages, keysById }, rule,
      deps(async (target) => {
        const count = (calls.get(target.keyId) ?? 0) + 1
        calls.set(target.keyId, count)
        return (target === first && count <= 2)
          ? new Response('{}', { status: 429 })
          : new Response('next target')
      }, new ProviderHealth(timer.clock), timer.clock),
    ))
    expect(error).toBeNull()
    expect(calls.get(first.keyId)).toBe(2)
    expect(calls.get(second.keyId)).toBe(1)
    expect(events).toContainEqual({ type: 'fallback', from: first, to: second, errorClass: 'rate_limit' })
    expect(events.at(-1)).toEqual({ type: 'done', target: second })
  })

  it('stops on an auth failure and marks the target as needing attention', async () => {
    const health = new ProviderHealth()
    let calls = 0
    const { error } = await collect(route(
      { messages, keysById }, rule,
      deps(async () => {
        calls += 1
        return new Response('{}', { status: 401 })
      }, health),
    ))
    expect(error).toBeInstanceOf(RouterRequestError)
    expect((error as RouterRequestError).errorClass).toBe('auth')
    expect(calls).toBe(1)
    expect(health.snapshot().byTarget['openrouter:key-1:openrouter/free'].needsAttention).toBe(true)
    expect(health.snapshot().byTarget['openrouter:key-1:openrouter/free'].attentionReason).toBe('auth')
  })

  it('fails over on an out-of-credits response only when enabled for Auto', async () => {
    const { events, error } = await collect(route(
      { messages, keysById },
      { ...rule, failoverOnQuota: true },
      deps(async (target) => target === first
        ? new Response('{}', { status: 402 })
        : new Response('answered by next model')),
    ))
    expect(error).toBeNull()
    expect(events).toContainEqual({ type: 'fallback', from: first, to: second, errorClass: 'quota' })
    expect(events.at(-1)).toEqual({ type: 'done', target: second })
  })

  it('stops on out-of-credits for routes without the Auto quota setting', async () => {
    let calls = 0
    const { error } = await collect(route(
      { messages, keysById }, rule,
      deps(async () => {
        calls += 1
        return new Response('{}', { status: 402 })
      }),
    ))
    expect(error).toBeInstanceOf(RouterRequestError)
    expect((error as RouterRequestError).errorClass).toBe('quota')
    expect(calls).toBe(1)
  })

  it('still stops on an auth failure when Auto quota failover is enabled', async () => {
    let calls = 0
    const { error } = await collect(route(
      { messages, keysById }, { ...rule, failoverOnQuota: true },
      deps(async () => {
        calls += 1
        return new Response('{}', { status: 401 })
      }),
    ))
    expect(error).toBeInstanceOf(RouterRequestError)
    expect((error as RouterRequestError).errorClass).toBe('auth')
    expect(calls).toBe(1)
  })

  it('loops through the ordered targets for at most two cycles', async () => {
    const calls: string[] = []
    const cycleFirst = { ...first, maxAttempts: 1 }
    const cycleSecond = { ...second, maxAttempts: 1 }
    const cycleRule: RoutingRule = {
      ...rule,
      maxAttempts: 6,
      maxCycles: 2,
      targets: [cycleFirst, cycleSecond],
    }
    const { events, error } = await collect(route(
      { messages, keysById },
      cycleRule,
      deps(async (target) => {
        calls.push(target.model)
        return new Response('{}', { status: 503 })
      }),
    ))
    expect(error).toBeInstanceOf(AllTargetsFailed)
    expect(calls).toEqual([first.model, second.model, first.model, second.model])
    expect(events).toContainEqual({ type: 'fallback', from: cycleSecond, to: cycleFirst, errorClass: 'server' })
  })

  it('stops on bad_request without trying another target', async () => {
    let calls = 0
    const { error } = await collect(route(
      { messages, keysById }, rule,
      deps(async () => {
        calls += 1
        return new Response('{}', { status: 400 })
      }),
    ))
    expect(error).toBeInstanceOf(RouterRequestError)
    expect((error as RouterRequestError).errorClass).toBe('bad_request')
    expect(calls).toBe(1)
  })

  it('throws per-target details when all targets fail', async () => {
    const { error } = await collect(route(
      { messages, keysById }, rule,
      deps(async () => new Response('{}', { status: 503 })),
    ))
    expect(error).toBeInstanceOf(AllTargetsFailed)
    expect((error as AllTargetsFailed).failures).toEqual([
      { provider: 'openrouter', model: 'openrouter/free', keyId: 'key-1', errorClass: 'server', attempts: 2, httpStatus: 503 },
      { provider: 'openai', model: 'gpt-4o-mini', keyId: 'key-2', errorClass: 'server', attempts: 2, httpStatus: 503 },
    ])
    expect(JSON.stringify((error as AllTargetsFailed).failures)).not.toContain('fixture-key')
  })

  it('interrupts a stream after the first chunk without failing over', async () => {
    let calls = 0
    const parser: ProviderAdapter['parseStream'] = async function* () {
      yield 'first chunk'
      throw new Error('socket disconnected')
    }
    const { events, error } = await collect(route(
      { messages, keysById }, rule,
      deps(async () => {
        calls += 1
        return new Response('ignored')
      }, new ProviderHealth(), fakeClock().clock, parser),
    ))
    expect(error).toBeInstanceOf(StreamInterruptedError)
    expect(events).toContainEqual({ type: 'chunk', target: first, text: 'first chunk' })
    expect(calls).toBe(1)
  })

  it('fails over when the first content does not arrive before the configured deadline', async () => {
    let calls = 0
    const targets = [{ ...first, maxAttempts: 1 }, { ...second, maxAttempts: 1 }]
    const { events, error } = await collect(route(
      { messages, keysById },
      { ...rule, targets, maxAttempts: 2, firstTokenTimeoutMs: 1000 },
      deps(async (target, signal) => {
        calls += 1
        if (target.keyId === second.keyId) return new Response('fallback answer')
        return new Response(new ReadableStream({
          start(controller) {
            signal.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'))
            }, { once: true })
          },
        }))
      }),
    ))
    expect(error).toBeNull()
    expect(calls).toBe(2)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'fallback',
        from: expect.objectContaining(first),
        to: expect.objectContaining(second),
        errorClass: 'timeout',
      }),
      expect.objectContaining({
        type: 'chunk',
        target: expect.objectContaining(second),
        text: 'fallback answer',
      }),
    ]))
  })

  it('does not count user abort as a provider failure', async () => {
    const health = new ProviderHealth()
    const controller = new AbortController()
    const { error } = await collect(route(
      { messages, keysById, signal: controller.signal },
      { ...rule, maxAttempts: 1 },
      {
        ...deps(async () => {
          controller.abort()
          throw new DOMException('Aborted', 'AbortError')
        }, health),
      },
    ))
    expect(error).toMatchObject({ name: 'AbortError' })
    expect(health.snapshot().byCircuit['openrouter:key-1'].consecutiveFailures).toBe(0)
  })
})
