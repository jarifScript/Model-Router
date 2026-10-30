import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderAdapter } from './adapters/types'
import { testModel } from './modelTest'
import { useModelTestStore } from '../store/model-tests'

const adapter: ProviderAdapter = {
  buildRequest: () => ({ url: 'https://fixture.invalid', headers: {}, body: {} }),
  buildTestRequest: (model) => ({
    url: 'https://fixture.invalid',
    headers: {},
    body: { model, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }], stream: false },
    isModelTest: true,
  }),
  parseStream: async function* () {},
  classifyError: (status) => status === 429 ? 'rate_limit' : status === 401 ? 'auth' : 'server',
  listModels: () => [],
}

function dependencies(response: Response | Error) {
  return {
    adapter,
    transport: async () => {
      if (response instanceof Error) throw response
      return response
    },
    now: () => 1234,
  }
}

describe('testModel', () => {
  afterEach(() => vi.useRealTimers())

  it.each([
    [200, 'working'],
    [429, 'rate_limited'],
    [401, 'auth_failed'],
    [402, 'no_credits'],
    [404, 'model_not_found'],
    [500, 'server_error'],
  ] as const)('maps HTTP %i to %s without retaining response text', async (status, expected) => {
    const result = await testModel('openrouter', 'sample/model', 'key-id', 'secret-key', dependencies(
      new Response('private provider body', { status }),
    ))
    expect(result.status).toBe(expected)
    expect(JSON.stringify(result)).not.toContain('secret-key')
    expect(JSON.stringify(result)).not.toContain('private provider body')
    expect(result).not.toHaveProperty('prompt')
  })

  it('maps a rejected transport to a network error', async () => {
    const result = await testModel('openrouter', 'sample/model', 'key-id', 'secret-key', dependencies(new Error('offline')))
    expect(result.status).toBe('network_error')
  })

  it('times out after 15 seconds even if the transport ignores abort', async () => {
    vi.useFakeTimers()
    const result = testModel('openrouter', 'sample/model', 'key-id', 'secret-key', {
      adapter,
      transport: async () => await new Promise<Response>(() => {}),
      now: () => 0,
    })
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(result).resolves.toMatchObject({ status: 'timeout', testedAt: 0 })
  })

  it('propagates user cancellation without turning it into a failure', async () => {
    const controller = new AbortController()
    const result = testModel('openrouter', 'sample/model', 'key-id', 'secret-key', {
      adapter,
      transport: async () => await new Promise<Response>(() => {}),
    }, controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stores only model-test metadata in memory', () => {
    const result = {
      providerId: 'openrouter' as const,
      modelId: 'sample/model',
      status: 'working' as const,
      latencyMs: 3,
      testedAt: 123,
      httpStatus: 200,
    }
    useModelTestStore.getState().setResult(result)
    const stored = useModelTestStore.getState().results['openrouter:sample/model']
    expect(stored).toEqual({
      providerId: 'openrouter',
      modelId: 'sample/model',
      status: 'working',
      latencyMs: 3,
      testedAt: 123,
    })
    expect(Object.keys(stored).sort()).toEqual(['latencyMs', 'modelId', 'providerId', 'status', 'testedAt'])
    expect(JSON.stringify(stored)).not.toMatch(/key|prompt|message|secret/i)
  })
})
