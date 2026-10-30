import { describe, expect, it } from 'vitest'
import {
  createVaultCanary,
  decryptSecret,
  encryptSecretForVault,
  VaultCryptoError,
} from './crypto'

describe('vault secret encryption', () => {
  it('encrypts a saved key only after confirming the vault password', async () => {
    const password = 'correct horse battery staple'
    const canary = await createVaultCanary(password)
    const encrypted = await encryptSecretForVault('provider-secret', password, canary)

    await expect(decryptSecret(encrypted, password)).resolves.toBe('provider-secret')
  })

  it('rejects a password that does not unlock the vault', async () => {
    const canary = await createVaultCanary('correct horse battery staple')

    await expect(
      encryptSecretForVault('provider-secret', 'a different password', canary),
    ).rejects.toMatchObject({
      code: 'passphrase_mismatch',
      name: VaultCryptoError.name,
    })
  })
})
