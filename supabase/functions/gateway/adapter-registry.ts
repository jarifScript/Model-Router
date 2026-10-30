import { PROVIDER_CONFIGS, getProviderConfig, type ProviderId } from '../../../src/core/providers.ts'
import { anthropicAdapter } from '../../../src/core/adapters/anthropic.ts'
import { createOpenAICompatibleAdapter } from '../../../src/core/adapters/openai-compatible.ts'
import { geminiAdapter } from '../../../src/core/adapters/gemini.ts'
import type { ProviderAdapter } from '../../../src/core/adapters/types.ts'

export const GATEWAY_PROVIDER_IDS: readonly ProviderId[] =
  PROVIDER_CONFIGS.map(({ id }) => id)

export function getGatewayProviderConfig(providerId: ProviderId) {
  return getProviderConfig(providerId)
}

export function getGatewayAdapter(providerId: ProviderId, appOrigin: string): ProviderAdapter {
  const config = getProviderConfig(providerId)
  switch (config.apiStyle) {
    case 'openai-compatible':
      return createOpenAICompatibleAdapter(config, appOrigin)
    case 'anthropic':
      return anthropicAdapter
    case 'gemini':
      return geminiAdapter
  }
}
