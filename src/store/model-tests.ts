import { create } from 'zustand'
import { isProviderId, type ProviderId } from '../core/providers'
import type { ModelTestStatus } from '../core/modelTest'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export type StoredModelTest = {
  providerId: ProviderId
  modelId: string
  status: ModelTestStatus
  latencyMs: number
  testedAt: number
}

export type ModelTestStore = {
  results: Record<string, StoredModelTest>
  isLoading: boolean
  setResult: (result: StoredModelTest) => void
  mergeResults: (results: StoredModelTest[]) => void
  clearResults: () => void
  loadFromSupabase: (userId: string) => Promise<StoredModelTest[]>
  saveToSupabase: (userId: string, result: StoredModelTest) => Promise<void>
}

function isModelTestStatus(status: string): status is ModelTestStatus {
  return [
    'working',
    'rate_limited',
    'auth_failed',
    'no_credits',
    'model_not_found',
    'timeout',
    'server_error',
    'network_error',
  ].includes(status)
}

function parseModelTestRow(row: {
  provider_id: string
  model_id: string
  status: string
  latency_ms: number
  tested_at: string
}): StoredModelTest {
  const testedAt = Date.parse(row.tested_at)
  if (
    !isProviderId(row.provider_id)
    || !row.model_id
    || !isModelTestStatus(row.status)
    || !Number.isInteger(row.latency_ms)
    || row.latency_ms < 0
    || !Number.isFinite(testedAt)
  ) {
    throw new Error('Invalid model test result data.')
  }
  return {
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    latencyMs: row.latency_ms,
    testedAt,
  }
}

export function getModelTestKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

export const useModelTestStore = create<ModelTestStore>((set) => ({
  results: {},
  isLoading: false,
  setResult: ({ providerId, modelId, status, latencyMs, testedAt }) => set((state) => ({
    results: {
      ...state.results,
      [getModelTestKey(providerId, modelId)]: { providerId, modelId, status, latencyMs, testedAt },
    },
  })),
  mergeResults: (results) => set((state) => {
    const merged = { ...state.results }
    for (const result of results) {
      const key = getModelTestKey(result.providerId, result.modelId)
      if (!merged[key] || result.testedAt >= merged[key].testedAt) {
        merged[key] = result
      }
    }
    return { results: merged }
  }),
  clearResults: () => set({ results: {} }),
  loadFromSupabase: async (userId: string) => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase is not configured.')
    }
    set({ isLoading: true })
    try {
      const { data, error } = await supabase
        .from('model_test_results')
        .select('provider_id, model_id, status, latency_ms, tested_at')
        .eq('user_id', userId)
      if (error) throw error
      return (data ?? []).map((row) => parseModelTestRow(row))
    } finally {
      set({ isLoading: false })
    }
  },
  saveToSupabase: async (userId: string, result: StoredModelTest) => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase is not configured.')
    }
    if (!userId) throw new Error('A signed-in user is required.')
    const { error } = await supabase
      .from('model_test_results')
      .upsert({
        user_id: userId,
        provider_id: result.providerId,
        model_id: result.modelId,
        status: result.status,
        latency_ms: result.latencyMs,
        tested_at: new Date(result.testedAt).toISOString(),
      }, { onConflict: 'user_id,provider_id,model_id' })
    if (error) throw error
  },
}))
