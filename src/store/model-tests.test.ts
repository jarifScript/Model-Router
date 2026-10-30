import { beforeEach, describe, expect, it } from 'vitest'
import { useModelTestStore, type StoredModelTest } from './model-tests'

const newerResult: StoredModelTest = {
  providerId: 'openrouter',
  modelId: 'example/model',
  status: 'working',
  latencyMs: 120,
  testedAt: 200,
}

describe('model test result store', () => {
  beforeEach(() => useModelTestStore.getState().clearResults())

  it('merges loaded results without replacing newer in-memory checks', () => {
    const store = useModelTestStore.getState()
    store.setResult(newerResult)
    store.mergeResults([{
      ...newerResult,
      status: 'server_error',
      latencyMs: 300,
      testedAt: 100,
    }])

    expect(useModelTestStore.getState().results['openrouter:example/model']).toEqual(newerResult)
  })

  it('loads persisted results for multiple models', () => {
    const store = useModelTestStore.getState()
    store.mergeResults([
      newerResult,
      { ...newerResult, modelId: 'example/other', status: 'timeout' },
    ])

    expect(Object.keys(useModelTestStore.getState().results)).toEqual([
      'openrouter:example/model',
      'openrouter:example/other',
    ])
  })
})
