// Browser transport factory; the router core receives only injected adapters and fetch behavior.
import { anthropicAdapter } from './adapters/anthropic'
import { createOpenAICompatibleAdapter } from './adapters/openai-compatible'
import { geminiAdapter } from './adapters/gemini'
import type { AdapterRequest, ProviderAdapter } from './adapters/types'
import { RouterRequestError } from './errors'
import { getProviderConfig, PROVIDER_CONFIGS, type ProviderId } from './providers'
import type { RouterDependencies } from './router'
import type { RouteTarget } from './route-types'
import type { ProviderHealth } from './health'

function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  const config = getProviderConfig(providerId)
  switch (config.apiStyle) {
    case 'openai-compatible':
      return createOpenAICompatibleAdapter(config, window.location.origin)
    case 'anthropic':
      return anthropicAdapter
    case 'gemini':
      return geminiAdapter
  }
}

function getSupabaseFunctionUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  if (!supabaseUrl) {
    throw new RouterRequestError('Supabase is not configured for proxy transport.', 'bad_request')
  }
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/route`
}

export function createBrowserRouterDependencies(
  accessToken: string,
  health: ProviderHealth,
  getModelCost?: RouterDependencies['getModelCost'],
): RouterDependencies {
  const adapters: Partial<Record<ProviderId, ProviderAdapter>> = Object.fromEntries(
    PROVIDER_CONFIGS.map(({ id }) => [id, getProviderAdapter(id)]),
  )
  return {
    adapters,
    health,
    ...(getModelCost ? { getModelCost } : {}),
    transport: async (
      target: RouteTarget,
      request: AdapterRequest,
      apiKey: string,
      signal: AbortSignal,
    ) => {
      const config = getProviderConfig(target.provider)
      const proxy = import.meta.env.VITE_OPENAI_TRANSPORT !== 'direct'
      let headers = new Headers(request.headers)
      let url = request.url
      let body = request.body
      if (proxy) {
        if (!accessToken) throw new RouterRequestError('Sign in before sending a chat request.', 'auth')
        url = getSupabaseFunctionUrl()
        headers = new Headers({
          accept: request.isModelTest ? 'application/json' : 'text/event-stream',
          'content-type': 'application/json',
        })
        headers.set('authorization', `Bearer ${accessToken}`)
        headers.set('x-provider-api-key', apiKey)
        body = {
          action: request.isModelTest ? 'test_model' : 'chat',
          providerId: target.provider,
          model: target.model,
          payload: request.body,
          stream: !request.isModelTest,
        }
      } else {
        const authHeader = config.authStyle === 'bearer' ? 'authorization' : config.authStyle
        headers.set(authHeader, config.authStyle === 'bearer' ? `Bearer ${apiKey}` : apiKey)
      }
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
    },
  }
}
