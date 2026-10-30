import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createVaultCanary,
  decryptSecret,
  encryptSecret,
  verifyVaultCanary,
  type VaultCanary,
} from '../core/crypto'
import type { EncryptedProviderKey } from '../types'
import { changeSecretPassword } from './vaultManagement'

const OLD_PASSWORD = 'correct old secret password'
const NEW_PASSWORD = 'correct new secret password'

describe('changeSecretPassword', () => {
  let canary: VaultCanary
  let key: EncryptedProviderKey

  beforeEach(async () => {
    canary = await createVaultCanary(OLD_PASSWORD)
    key = {
      id: 'key-1',
      provider: 'openrouter',
      label: 'Test key',
      created_at: '2026-01-01T00:00:00.000Z',
      ...await encryptSecret('provider-secret', OLD_PASSWORD),
    }
  })

  it('re-encrypts all key data and commits it with one atomic replacement', async () => {
    let savedCanary = canary
    let savedKeys = [key]
    const replaceAtomically = vi.fn(async (nextCanary: VaultCanary, nextKeys: Array<{
      id: string
      ciphertext: string
      iv: string
      salt: string
    }>) => {
      savedCanary = nextCanary
      savedKeys = savedKeys.map((saved, index) => ({ ...saved, ...nextKeys[index] }))
    })

    await changeSecretPassword(OLD_PASSWORD, NEW_PASSWORD, canary, [key], replaceAtomically)

    expect(replaceAtomically).toHaveBeenCalledTimes(1)
    expect(await verifyVaultCanary(NEW_PASSWORD, savedCanary)).toBe(true)
    expect(await decryptSecret(savedKeys[0], NEW_PASSWORD)).toBe('provider-secret')
    expect(await verifyVaultCanary(OLD_PASSWORD, savedCanary)).toBe(false)
  })

  it('leaves the old vault valid if the atomic replacement fails', async () => {
    const oldCanary = canary
    const oldKey = key
    const replaceAtomically = vi.fn(async () => {
      throw new Error('RPC failed')
    })

    await expect(
      changeSecretPassword(OLD_PASSWORD, NEW_PASSWORD, canary, [key], replaceAtomically),
    ).rejects.toThrow('RPC failed')

    expect(await verifyVaultCanary(OLD_PASSWORD, oldCanary)).toBe(true)
    expect(await decryptSecret(oldKey, OLD_PASSWORD)).toBe('provider-secret')
    expect(replaceAtomically).toHaveBeenCalledTimes(1)
  })
})
