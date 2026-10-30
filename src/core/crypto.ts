// Browser-only PBKDF2 and AES-GCM helpers for vault metadata and provider keys.
const PBKDF2_ITERATIONS = 310_000
const CANARY_PLAINTEXT = 'ai-router-vault-canary:v1'

export type EncryptedSecret = {
  ciphertext: string
  iv: string
  salt: string
}

export type VaultCanary = {
  kdf_salt: string
  canary_ciphertext: string
  canary_iv: string
}

export type CryptoErrorCode =
  | 'invalid_input'
  | 'invalid_data'
  | 'authentication_failed'
  | 'crypto_failure'

export class VaultCryptoError extends Error {
  constructor(
    message: string,
    public readonly code: CryptoErrorCode,
  ) {
    super(message)
    this.name = 'VaultCryptoError'
  }
}

function toBase64(bytes: Uint8Array<ArrayBufferLike>): string {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  } catch {
    throw new VaultCryptoError('Encrypted vault data is invalid.', 'invalid_data')
  }
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  try {
    return crypto.getRandomValues(new Uint8Array(length))
  } catch {
    throw new VaultCryptoError('Secure browser cryptography is unavailable.', 'crypto_failure')
  }
}

async function deriveEncryptionKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (!passphrase) {
    throw new VaultCryptoError('A vault passphrase is required.', 'invalid_input')
  }

  try {
    const passphraseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      passphraseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  } catch (error) {
    if (error instanceof VaultCryptoError) throw error
    throw new VaultCryptoError('Unable to derive the vault encryption key.', 'crypto_failure')
  }
}

async function encryptWithSalt(
  plaintext: string,
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveEncryptionKey(passphrase, salt)

  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext),
    )
    return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) }
  } catch {
    throw new VaultCryptoError('Unable to encrypt vault data.', 'crypto_failure')
  }
}

async function decryptWithSalt(
  ciphertext: string,
  iv: string,
  salt: Uint8Array<ArrayBuffer>,
  passphrase: string,
): Promise<string> {
  if (salt.length !== 16) {
    throw new VaultCryptoError('Encrypted vault data is invalid.', 'invalid_data')
  }
  const key = await deriveEncryptionKey(passphrase, salt)
  const ciphertextBytes = fromBase64(ciphertext)
  const ivBytes = fromBase64(iv)
  if (ivBytes.length !== 12) {
    throw new VaultCryptoError('Encrypted vault data is invalid.', 'invalid_data')
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      key,
      ciphertextBytes,
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new VaultCryptoError('Vault data could not be authenticated.', 'authentication_failed')
  }
}

export async function encryptSecret(
  plaintext: string,
  passphrase: string,
): Promise<EncryptedSecret> {
  if (!plaintext) {
    throw new VaultCryptoError('Cannot encrypt an empty secret.', 'invalid_input')
  }

  const salt = randomBytes(16)
  const encrypted = await encryptWithSalt(plaintext, passphrase, salt)
  return { ...encrypted, salt: toBase64(salt) }
}

export async function decryptSecret(
  encrypted: EncryptedSecret,
  passphrase: string,
): Promise<string> {
  return decryptWithSalt(
    encrypted.ciphertext,
    encrypted.iv,
    fromBase64(encrypted.salt),
    passphrase,
  )
}

export async function createVaultCanary(passphrase: string): Promise<VaultCanary> {
  const salt = randomBytes(16)
  const encrypted = await encryptWithSalt(CANARY_PLAINTEXT, passphrase, salt)
  return {
    kdf_salt: toBase64(salt),
    canary_ciphertext: encrypted.ciphertext,
    canary_iv: encrypted.iv,
  }
}

export async function verifyVaultCanary(
  passphrase: string,
  canary: VaultCanary,
): Promise<boolean> {
  try {
    const plaintext = await decryptWithSalt(
      canary.canary_ciphertext,
      canary.canary_iv,
      fromBase64(canary.kdf_salt),
      passphrase,
    )
    return plaintext === CANARY_PLAINTEXT
  } catch (error) {
    if (error instanceof VaultCryptoError && error.code === 'authentication_failed') return false
    throw error
  }
}
