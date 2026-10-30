import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isProviderId, type ProviderId } from '../core/providers'
import useAuth from './useAuth'
import { parsePriceOverrides, type PriceOverrides } from '../lib/pricing'
import { supabase } from '../lib/supabase'

type StoredSettings = {
  baselineProvider: ProviderId | null
  baselineModel: string | null
  priceOverrides: PriceOverrides
}

const EMPTY_SETTINGS: StoredSettings = {
  baselineProvider: null,
  baselineModel: null,
  priceOverrides: {},
}

function settingsQueryKey(userId: string | undefined) {
  return ['user-settings', userId]
}

function parseSettings(value: unknown): StoredSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return EMPTY_SETTINGS
  const row = value as Record<string, unknown>
  const baselineProvider = typeof row.baseline_provider === 'string' && isProviderId(row.baseline_provider)
    ? row.baseline_provider
    : null
  const baselineModel = typeof row.baseline_model === 'string' && row.baseline_model.trim()
    ? row.baseline_model.trim()
    : null
  return {
    baselineProvider: baselineProvider && baselineModel ? baselineProvider : null,
    baselineModel: baselineProvider && baselineModel ? baselineModel : null,
    priceOverrides: parsePriceOverrides(row.price_overrides),
  }
}

function legacyBaseline(value: unknown): Pick<StoredSettings, 'baselineProvider' | 'baselineModel'> {
  if (typeof value !== 'string') return { baselineProvider: null, baselineModel: null }
  const separator = value.indexOf(':')
  if (separator < 1) return { baselineProvider: null, baselineModel: null }
  const provider = value.slice(0, separator)
  const model = value.slice(separator + 1).trim()
  if (!isProviderId(provider) || !model) return { baselineProvider: null, baselineModel: null }
  return { baselineProvider: provider, baselineModel: model }
}

export function useUserSettings() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id
  const settingsQuery = useQuery({
    queryKey: settingsQueryKey(userId),
    enabled: Boolean(userId && supabase),
    staleTime: 60_000,
    queryFn: async (): Promise<StoredSettings | null> => {
      if (!supabase || !userId) throw new Error('Sign in to load your settings.')
      const { data, error } = await supabase
        .from('user_settings')
        .select('baseline_provider, baseline_model, price_overrides')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data === null ? null : parseSettings(data)
    },
  })

  const showAdvancedFeatures = user?.user_metadata.show_advanced_features === true
  const oldBaseline = settingsQuery.isSuccess && settingsQuery.data === null
    ? legacyBaseline(user?.user_metadata.compare_with_model)
    : { baselineProvider: null, baselineModel: null }
  const settings: StoredSettings = settingsQuery.data ?? {
    ...EMPTY_SETTINGS,
    ...oldBaseline,
  }
  const compareWithModel = settings.baselineProvider && settings.baselineModel
    ? `${settings.baselineProvider}:${settings.baselineModel}`
    : ''

  const updateSettings = useCallback(async (updates: {
    showAdvancedFeatures?: boolean
    baselineProvider?: ProviderId | null
    baselineModel?: string | null
    priceOverrides?: PriceOverrides
  }) => {
    if (!supabase || !userId) throw new Error('Sign in to save this setting.')
    const current = queryClient.getQueryData<StoredSettings>(settingsQueryKey(userId)) ?? EMPTY_SETTINGS
    const baselineProvider = updates.baselineProvider === undefined
      ? current.baselineProvider
      : updates.baselineProvider
    const baselineModel = updates.baselineModel === undefined
      ? current.baselineModel
      : updates.baselineModel?.trim() || null
    if ((baselineProvider === null) !== (baselineModel === null)) {
      throw new Error('Choose both an AI service and model, or clear both.')
    }

    if (updates.showAdvancedFeatures !== undefined) {
      const { error } = await supabase.auth.updateUser({
        data: { show_advanced_features: updates.showAdvancedFeatures },
      })
      if (error) throw error
    }

    const nextSettings: StoredSettings = {
      baselineProvider,
      baselineModel,
      priceOverrides: updates.priceOverrides ?? current.priceOverrides,
    }
    const { error } = await supabase.from('user_settings').upsert({
      user_id: userId,
      baseline_provider: nextSettings.baselineProvider,
      baseline_model: nextSettings.baselineModel,
      price_overrides: nextSettings.priceOverrides,
    }, { onConflict: 'user_id' })
    if (error) throw error
    queryClient.setQueryData(settingsQueryKey(userId), nextSettings)
  }, [queryClient, userId])

  return {
    showAdvancedFeatures,
    compareWithModel,
    baselineProvider: settings.baselineProvider,
    baselineModel: settings.baselineModel ?? '',
    priceOverrides: settings.priceOverrides,
    isSettingsLoading: settingsQuery.isLoading,
    settingsError: settingsQuery.error,
    updateSettings,
  }
}
