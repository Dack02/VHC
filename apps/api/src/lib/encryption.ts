/**
 * Encryption Utility
 * Uses AES-256-GCM for encrypting sensitive data (API keys, credentials)
 *
 * ENCRYPTION_KEY environment variable must be 32 bytes (64 hex characters)
 * Generate with: openssl rand -hex 32
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // 16 bytes for GCM
const AUTH_TAG_LENGTH = 16 // 16 bytes authentication tag

/**
 * Get encryption key from environment
 * @throws Error if key is not set or invalid
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY

  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set')
  }

  // Key should be 64 hex characters (32 bytes)
  if (!/^[a-f0-9]{64}$/i.test(key)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
  }

  return Buffer.from(key, 'hex')
}

/**
 * Encrypt a plaintext string
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in format: iv:authTag:ciphertext (all base64)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return ''
  }

  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let ciphertext = cipher.update(plaintext, 'utf8', 'base64')
  ciphertext += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  // Return format: iv:authTag:ciphertext (all base64 encoded)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext}`
}

/**
 * Decrypt an encrypted string
 * @param encryptedText - The encrypted string in format: iv:authTag:ciphertext
 * @returns Decrypted plaintext string
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) {
    return ''
  }

  const key = getEncryptionKey()

  const parts = encryptedText.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format')
  }

  const [ivBase64, authTagBase64, ciphertext] = parts
  const iv = Buffer.from(ivBase64, 'base64')
  const authTag = Buffer.from(authTagBase64, 'base64')

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length')
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length')
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let plaintext = decipher.update(ciphertext, 'base64', 'utf8')
  plaintext += decipher.final('utf8')

  return plaintext
}

/**
 * Check if encryption is properly configured
 * @returns true if encryption is ready to use
 */
export function isEncryptionConfigured(): boolean {
  try {
    getEncryptionKey()
    return true
  } catch {
    return false
  }
}

/**
 * Mask a string for display (show only last N characters)
 * @param value - The string to mask
 * @param visibleChars - Number of characters to show at the end (default: 4)
 * @returns Masked string like "••••••••••abcd"
 */
export function maskString(value: string | null | undefined, visibleChars = 4): string {
  if (!value) {
    return ''
  }

  if (value.length <= visibleChars) {
    return '•'.repeat(value.length)
  }

  const masked = '•'.repeat(Math.min(value.length - visibleChars, 20))
  const visible = value.slice(-visibleChars)

  return `${masked}${visible}`
}

/**
 * Generate a new encryption key (for setup)
 * @returns A new 64-character hex string suitable for ENCRYPTION_KEY
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex')
}
