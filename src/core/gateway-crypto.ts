export type GatewayEncryptedSecret = {
  ciphertext: string
  iv: string
}

export class GatewayCryptoError extends Error {
  constructor(readonly code: 'invalid_input' | 'invalid_key' | 'crypto_failure') {
    super('Gateway key protection failed.')
    this.name = 'GatewayCryptoError'
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  } catch {
    throw new GatewayCryptoError('invalid_key')
  }
}

function importMasterKey(encodedKey: string): Promise<CryptoKey> {
  const rawKey = base64ToBytes(encodedKey)
  if (rawKey.length !== 32) throw new GatewayCryptoError('invalid_key')
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function additionalData(
  userId: string,
  providerKeyId: string,
  provider: string,
): Uint8Array<ArrayBuffer> {
  if (!userId || !providerKeyId || !provider) throw new GatewayCryptoError('invalid_input')
  return new TextEncoder().encode(`${userId}:${providerKeyId}:${provider}`)
}

export async function encryptGatewaySecret(
  apiKey: string,
  encodedMasterKey: string,
  userId: string,
  providerKeyId: string,
  provider: string,
): Promise<GatewayEncryptedSecret> {
  if (!apiKey.trim() || apiKey.length > 4096) throw new GatewayCryptoError('invalid_input')
  const key = await importMasterKey(encodedMasterKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(userId, providerKeyId, provider) },
      key,
      new TextEncoder().encode(apiKey),
    )
    return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) }
  } catch {
    throw new GatewayCryptoError('crypto_failure')
  }
}

export async function decryptGatewaySecret(
  encrypted: GatewayEncryptedSecret,
  encodedMasterKey: string,
  userId: string,
  providerKeyId: string,
  provider: string,
): Promise<string> {
  const key = await importMasterKey(encodedMasterKey)
  const iv = base64ToBytes(encrypted.iv)
  if (iv.length !== 12) throw new GatewayCryptoError('invalid_key')
  const ciphertext = base64ToBytes(encrypted.ciphertext)
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: additionalData(userId, providerKeyId, provider) },
      key,
      ciphertext,
    )
    const result = new TextDecoder().decode(plaintext)
    if (!result || result.length > 4096) throw new GatewayCryptoError('invalid_key')
    return result
  } catch (error) {
    if (error instanceof GatewayCryptoError) throw error
    throw new GatewayCryptoError('invalid_key')
  }
}

export function generateGatewayRouterKey(): string {
  return `mrk_${bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')}`
}

export async function hashGatewayRouterKey(routerKey: string): Promise<string> {
  if (!/^mrk_[A-Za-z0-9_-]{43}$/.test(routerKey)) {
    throw new GatewayCryptoError('invalid_input')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(routerKey))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
