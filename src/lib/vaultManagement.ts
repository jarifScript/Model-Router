import {
  createVaultCanary,
  decryptSecret,
  encryptSecret,
  verifyVaultCanary,
  type VaultCanary,
} from '../core/crypto'
import type { EncryptedProviderKey } from '../types'

export type ReplacementKeyCiphertext = {
  id: string
  ciphertext: string
  iv: string
  salt: string
}

export type AtomicVaultReplacement = (
  canary: VaultCanary,
  keys: ReplacementKeyCiphertext[],
) => Promise<void>

export class VaultPasswordChangeError extends Error {
  constructor(readonly code: 'incorrect_current_password') {
    super('The current secret password is incorrect.')
    this.name = 'VaultPasswordChangeError'
  }
}

export async function changeSecretPassword(
  currentPassword: string,
  newPassword: string,
  canary: VaultCanary,
  encryptedKeys: EncryptedProviderKey[],
  replaceAtomically: AtomicVaultReplacement,
): Promise<void> {
  if (!await verifyVaultCanary(currentPassword, canary)) {
    throw new VaultPasswordChangeError('incorrect_current_password')
  }

  const plaintextKeys = await Promise.all(
    encryptedKeys.map(async (record) => ({
      id: record.id,
      plaintext: await decryptSecret(record, currentPassword),
    })),
  )
  const nextCanary = await createVaultCanary(newPassword)
  const replacements = await Promise.all(
    plaintextKeys.map(async ({ id, plaintext }) => ({
      id,
      ...await encryptSecret(plaintext, newPassword),
    })),
  )

  await replaceAtomically(nextCanary, replacements)
}
