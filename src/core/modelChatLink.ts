import { isProviderId, type ProviderId } from './providers'

export type ModelChatSelection = {
  providerId: ProviderId
  modelId: string
}

const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}$/

export function buildModelChatSearch(providerId: ProviderId, modelId: string): string {
  const search = new URLSearchParams()
  search.set('provider', providerId)
  search.set('model', modelId)
  return `?${search.toString()}`
}

export function parseModelChatSearch(search: string): ModelChatSelection | null {
  const params = new URLSearchParams(search)
  const provider = params.get('provider')
  const modelId = params.get('model')
  if (!provider || !isProviderId(provider) || !modelId || !SAFE_MODEL_ID.test(modelId)) return null
  return { providerId: provider, modelId }
}
