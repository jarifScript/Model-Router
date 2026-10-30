import type { ProviderId } from './providers'

export type ModelCatalogKey = {
  id: string
  provider: ProviderId
}

export type ModelCatalogRequest = {
  providerId: ProviderId
  keyId?: string
}

export function getModelCatalogRequests(
  providerKeys: readonly ModelCatalogKey[],
): ModelCatalogRequest[] {
  const requests: ModelCatalogRequest[] = []
  const seenProviders = new Set<ProviderId>()

  for (const key of providerKeys) {
    if (key.provider === 'openrouter') {
      if (!seenProviders.has(key.provider)) requests.push({ providerId: key.provider })
      seenProviders.add(key.provider)
      continue
    }

    requests.push({ providerId: key.provider, keyId: key.id })
  }

  return requests
}
