// Shared provider and encrypted credential types.
import {
  isProviderId as isKnownProviderId,
  PROVIDER_CONFIGS,
  type ProviderId,
} from '../core/providers'

export { PROVIDER_CONFIGS }
export type { ProviderId }
export const PROVIDERS: ProviderId[] = PROVIDER_CONFIGS.map(({ id }) => id)

export type StoredProviderId = ProviderId

export function isProviderId(value: string): value is StoredProviderId {
  return isKnownProviderId(value)
}

export type EncryptedProviderKey = {
  id: string
  provider: StoredProviderId
  label: string
  ciphertext: string
  iv: string
  salt: string
  created_at: string
}

export type DecryptedProviderKey = {
  id: string
  provider: StoredProviderId
  label: string
  apiKey: string
}
