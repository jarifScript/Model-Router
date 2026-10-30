import { useQueries, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import useAuth from '../hooks/useAuth'
import { getProviderConfig, resolveProviderHeaders, type ProviderId } from '../core/providers'
import type { ModelInfo } from '../core/models'
import anthropicAdapter from '../core/adapters/anthropic'
import geminiAdapter from '../core/adapters/gemini'
import { createOpenAICompatibleAdapter } from '../core/adapters/openai-compatible'
import { useVaultStore } from '../store/vault'
import type { DecryptedProviderKey } from '../types'

const MODEL_CATALOG_STALE_TIME = 60 * 60 * 1000
const catalogsByScope = new Map<string, ModelInfo[]>()

function scopeKey(providerId: ProviderId, keyId: string | undefined): string {
  return `${providerId}:${keyId ?? 'public'}`
}

function getModelsUrl(providerId: ProviderId): string {
  const config = getProviderConfig(providerId)
  return `${config.baseUrl.replace(/\/$/, '')}/${config.modelsPath.replace(/^\//, '')}`
}

function getFunctionUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  if (!supabaseUrl) throw new Error('Model discovery is unavailable because Supabase is not configured.')
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/route`
}

function getAuthHeaderName(providerId: ProviderId): string {
  const authStyle = getProviderConfig(providerId).authStyle
  return authStyle === 'bearer' ? 'authorization' : authStyle
}

function modelListError(status: number): Error {
  if (status === 401 || status === 403) return new Error('Your provider key was rejected.')
  if (status === 429) return new Error('The provider is rate limited. Try refreshing shortly.')
  return new Error('Unable to load this provider’s models. You can enter a model ID manually.')
}

function parseModels(providerId: ProviderId, response: unknown): ModelInfo[] {
  const config = getProviderConfig(providerId)
  if (config.apiStyle === 'openai-compatible') {
    return createOpenAICompatibleAdapter(config, '').listModels(response)
  }
  if (providerId === 'anthropic') return anthropicAdapter.listModels(response)
  return geminiAdapter.listModels(response)
}

async function fetchModelCatalog(
  providerId: ProviderId,
  keyId: string | undefined,
  apiKey: string | undefined,
  accessToken: string | undefined,
  signal: AbortSignal,
): Promise<ModelInfo[]> {
  const config = getProviderConfig(providerId)
  const isPublicOpenRouter = providerId === 'openrouter'
  const useDirectTransport = import.meta.env.VITE_OPENAI_TRANSPORT === 'direct'
  let response: Response

  if (useDirectTransport) {
    const headers = new Headers({ accept: 'application/json' })
    if (!isPublicOpenRouter) {
      if (!apiKey) throw new Error('Select a saved provider key, or enter a model ID manually.')
      headers.set(
        getAuthHeaderName(providerId),
        config.authStyle === 'bearer' ? 'Bearer ' + apiKey : apiKey,
      )
      for (const [name, value] of Object.entries(resolveProviderHeaders(config, window.location.origin))) {
        headers.set(name, value)
      }
    }
    try {
      response = await fetch(getModelsUrl(providerId), { method: 'GET', headers, signal })
    } catch (caughtError) {
      if (signal.aborted) throw caughtError
      throw new Error('Could not load the model list. Check your connection or CORS settings; you can enter a model ID manually.')
    }
  } else {
    if (!isPublicOpenRouter && (!apiKey || !keyId)) {
      throw new Error('Select a saved provider key, or enter a model ID manually.')
    }
    if (!accessToken) throw new Error('Sign in again to load this provider’s models.')
    try {
      const headers = new Headers({
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      })
      if (apiKey) headers.set('x-provider-api-key', apiKey)
      response = await fetch(getFunctionUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'models', providerId }),
        signal,
      })
    } catch (caughtError) {
      if (signal.aborted) throw caughtError
      throw new Error('Could not load the model list. Check your connection or proxy deployment; you can enter a model ID manually.')
    }
  }

  if (!response.ok) throw modelListError(response.status)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('The provider returned an invalid model list. You can enter a model ID manually.')
  }
  const models = parseModels(providerId, payload)
  catalogsByScope.set(scopeKey(providerId, isPublicOpenRouter ? undefined : keyId), models)
  return models
}

export function useModels(providerId: ProviderId, keyId?: string) {
  const { session } = useAuth()
  const selectedKeyId = useVaultStore((state) => (
    state.providerKeys.find((key) => key.id === keyId)?.id
    ?? state.providerKeys.find((key) => key.provider === providerId)?.id
  ))
  const providerKey = useVaultStore((state) => state.providerKeys.find((key) => key.id === selectedKeyId))
  return useQuery(modelQueryOptions(
    providerId,
    providerKey?.id,
    providerKey?.apiKey,
    session?.access_token,
  ))
}

type ModelCatalogQuery = {
  providerId: ProviderId
  keyId?: string
  apiKey?: string
}

function modelQueryOptions(
  providerId: ProviderId,
  keyId: string | undefined,
  apiKey: string | undefined,
  accessToken: string | undefined,
): UseQueryOptions<ModelInfo[]> {
  const publicOpenRouter = providerId === 'openrouter'
  return {
    queryKey: ['model-catalog', providerId, publicOpenRouter ? 'public' : keyId ?? 'no-key'],
    queryFn: ({ signal }) => fetchModelCatalog(providerId, keyId, apiKey, accessToken, signal),
    enabled: publicOpenRouter || Boolean(keyId),
    staleTime: MODEL_CATALOG_STALE_TIME,
    gcTime: MODEL_CATALOG_STALE_TIME,
  }
}

export function useModelCatalogs(providerKeys: DecryptedProviderKey[]) {
  const { session } = useAuth()
  const scopes: ModelCatalogQuery[] = []
  const seen = new Set<string>()
  for (const key of providerKeys) {
    const publicOpenRouter = key.provider === 'openrouter'
    const identity = `${key.provider}:${publicOpenRouter ? 'public' : key.id}`
    if (seen.has(identity)) continue
    seen.add(identity)
    scopes.push({
      providerId: key.provider,
      ...(publicOpenRouter ? {} : { keyId: key.id, apiKey: key.apiKey }),
    })
  }
  const queries = useQueries({
    queries: scopes.map((scope) => modelQueryOptions(
      scope.providerId,
      scope.keyId,
      scope.apiKey,
      session?.access_token,
    )),
  })
  const queryByScope = new Map(scopes.map((scope, index) => [
    `${scope.providerId}:${scope.providerId === 'openrouter' ? 'public' : scope.keyId}`,
    queries[index],
  ]))
  return providerKeys.map((key) => {
    const scopeKey = `${key.provider}:${key.provider === 'openrouter' ? 'public' : key.id}`
    const query = queryByScope.get(scopeKey)
    return {
      providerId: key.provider,
      keyId: key.id,
      models: query?.data ?? [],
      isLoading: query?.isLoading ?? false,
      error: query?.error ?? null,
    }
  })
}

export function getKnownPrice(
  providerId: ProviderId,
  modelId: string,
): { inputPricePerM: number; outputPricePerM: number } | null {
  for (const [key, models] of catalogsByScope.entries()) {
    if (!key.startsWith(`${providerId}:`)) continue
    const model = models.find((entry) => entry.id === modelId && entry.priceKnown)
    if (model?.inputPricePerM !== undefined && model.outputPricePerM !== undefined) {
      return { inputPricePerM: model.inputPricePerM, outputPricePerM: model.outputPricePerM }
    }
  }
  return null
}

export function getCheapestKnownModel(providerId: ProviderId, keyId?: string): ModelInfo | null {
  const models = catalogsByScope.get(scopeKey(providerId, keyId))
    ?? catalogsByScope.get(scopeKey(providerId, undefined))
  if (!models) return null
  return models
    .filter((model) => model.priceKnown
      && model.inputPricePerM !== undefined
      && model.outputPricePerM !== undefined)
    .sort((left, right) => {
      const leftPrice = (left.inputPricePerM ?? 0) + (left.outputPricePerM ?? 0)
      const rightPrice = (right.inputPricePerM ?? 0) + (right.outputPricePerM ?? 0)
      return leftPrice - rightPrice || left.name.localeCompare(right.name)
    })[0] ?? null
}
