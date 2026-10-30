import { describe, expect, it } from 'vitest'
import { encryptSecret } from '../core/crypto'
import { decryptProviderKeys } from './decryptProviderKeys'

describe('decrypt saved provider keys', () => {
  it('keeps readable keys and identifies unreadable records without changing them', async () => {
    const passphrase = 'correct horse battery staple'
    const readableCiphertext = await encryptSecret('provider-secret', passphrase)
    const unreadableCiphertext = await encryptSecret('another-secret', 'different password')
    const records = [
      {
        id: 'readable',
        provider: 'openrouter',
        label: 'My key',
        ...readableCiphertext,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'unreadable',
        provider: 'openai',
        label: 'Other key',
        ...unreadableCiphertext,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ] as const

    const result = await decryptProviderKeys([...records], passphrase)

    expect(result.providerKeys).toEqual([
      { id: 'readable', provider: 'openrouter', label: 'My key', apiKey: 'provider-secret' },
    ])
    expect(result.unavailableProviderKeys).toEqual([
      { id: 'unreadable', provider: 'openai', label: 'Other key' },
    ])
    expect(records[1].ciphertext).toBe(unreadableCiphertext.ciphertext)
  })
})
