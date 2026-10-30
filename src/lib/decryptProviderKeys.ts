import { decryptSecret } from '../core/crypto'
import {
  isProviderId,
  type DecryptedProviderKey,
  type EncryptedProviderKey,
  type UnavailableProviderKey,
} from '../types'

export async function decryptProviderKeys(
  records: EncryptedProviderKey[],
  passphrase: string,
): Promise<{
  providerKeys: DecryptedProviderKey[]
  unavailableProviderKeys: UnavailableProviderKey[]
}> {
  const providerKeys: DecryptedProviderKey[] = []
  const unavailableProviderKeys: UnavailableProviderKey[] = []

  for (const record of records) {
    if (!isProviderId(record.provider)) {
      unavailableProviderKeys.push({
        id: record.id,
        provider: 'unknown',
        label: record.label,
      })
      continue
    }

    try {
      providerKeys.push({
        id: record.id,
        provider: record.provider,
        label: record.label,
        apiKey: await decryptSecret(record, passphrase),
      })
    } catch {
      unavailableProviderKeys.push({
        id: record.id,
        provider: record.provider,
        label: record.label,
      })
    }
  }

  return { providerKeys, unavailableProviderKeys }
}
