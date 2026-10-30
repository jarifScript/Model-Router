import { describe, expect, it } from 'vitest'
import {
  decryptGatewaySecret,
  encryptGatewaySecret,
  generateGatewayRouterKey,
  hashGatewayRouterKey,
} from './gateway-crypto'

const masterKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))

describe('gateway key protection', () => {
  it('encrypts each shared provider key with an authenticated envelope', async () => {
    const encrypted = await encryptGatewaySecret(
      'provider-secret',
      masterKey,
      'user-id',
      'provider-key-id',
      'openrouter',
    )

    expect(encrypted.iv).not.toBe('')
    expect(encrypted.ciphertext).not.toContain('provider-secret')
    await expect(decryptGatewaySecret(
      encrypted,
      masterKey,
      'user-id',
      'provider-key-id',
      'openrouter',
    )).resolves.toBe('provider-secret')
    await expect(decryptGatewaySecret(
      encrypted,
      masterKey,
      'different-user',
      'provider-key-id',
      'openrouter',
    )).rejects.toThrow()
  })

  it('generates one-time router keys and stores only their SHA-256 hash', async () => {
    const key = generateGatewayRouterKey()
    const keyHash = await hashGatewayRouterKey(key)
    expect(key).toMatch(/^mrk_[A-Za-z0-9_-]{43}$/)
    expect(keyHash).toMatch(/^[a-f0-9]{64}$/)
    expect(keyHash).not.toContain(key)
    await expect(hashGatewayRouterKey(key)).resolves.toBe(keyHash)
  })
})
