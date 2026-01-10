/**
 * @file encryption.ts
 * @description AES-256-GCM encryption utilities for compliance logging
 * @feature compliance
 *
 * Provides encryption at rest for compliance log payloads.
 * Uses AES-256-GCM for authenticated encryption with:
 * - 256-bit key from environment variable
 * - Random 96-bit IV per encryption
 * - 128-bit authentication tag
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export interface EncryptedData {
  ciphertext: string; // Base64-encoded encrypted data
  iv: string; // Base64-encoded initialization vector
  tag: string; // Base64-encoded authentication tag (appended to ciphertext)
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16; // 128 bits

/**
 * Get encryption key from environment variable.
 * Key must be 64 hex characters (256 bits).
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.COMPLIANCE_LOG_ENCRYPTION_KEY;

  if (!keyHex) {
    // In development, use a deterministic key derived from a known value
    // WARNING: This is NOT secure for production!
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      console.warn(
        '[Encryption] COMPLIANCE_LOG_ENCRYPTION_KEY not set, using development key. DO NOT use in production!',
      );
      return createHash('sha256').update('development-compliance-key-do-not-use-in-production').digest();
    }
    throw new Error('COMPLIANCE_LOG_ENCRYPTION_KEY environment variable is required in production');
  }

  if (keyHex.length !== 64) {
    throw new Error('COMPLIANCE_LOG_ENCRYPTION_KEY must be exactly 64 hex characters (256 bits)');
  }

  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error('COMPLIANCE_LOG_ENCRYPTION_KEY must contain only hexadecimal characters');
  }

  return Buffer.from(keyHex, 'hex');
}

// ============================================================================
// ENCRYPTION FUNCTIONS
// ============================================================================

/**
 * Encrypt plaintext using AES-256-GCM
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted data with IV and ciphertext (tag appended)
 */
export function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const tag = cipher.getAuthTag();

  // Append auth tag to ciphertext for storage
  const ciphertextWithTag = Buffer.concat([encrypted, tag]);

  return {
    ciphertext: ciphertextWithTag.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'), // Also return separately for verification
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM
 *
 * @param encrypted - The encrypted data (ciphertext with appended tag, and IV)
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decrypt(encrypted: Pick<EncryptedData, 'ciphertext' | 'iv'>): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, 'base64');
  const ciphertextWithTag = Buffer.from(encrypted.ciphertext, 'base64');

  // Extract auth tag from end of ciphertext
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - TAG_LENGTH);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Decryption failed: data may be corrupted or tampered with');
  }
}

// ============================================================================
// HASHING FUNCTIONS
// ============================================================================

/**
 * Generate SHA-256 hash of data
 *
 * @param data - String to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Generate hash for compliance log chain
 *
 * Creates a hash combining:
 * - Previous log's hash (empty string for first entry)
 * - Timestamp (ISO 8601 string)
 * - Payload hash
 * - Event type
 *
 * @param previousHash - Hash of the previous log entry
 * @param timestamp - ISO 8601 timestamp of current entry
 * @param payloadHash - SHA-256 hash of the payload
 * @param eventType - Type of the event
 * @returns SHA-256 hash for the current log entry
 */
export function generateLogHash(
  previousHash: string,
  timestamp: string,
  payloadHash: string,
  eventType: string,
): string {
  const data = `${previousHash}|${timestamp}|${payloadHash}|${eventType}`;
  return sha256(data);
}

/**
 * Verify if a hash was generated correctly
 *
 * @param expectedHash - The hash to verify
 * @param previousHash - Previous log's hash
 * @param timestamp - Timestamp of the entry
 * @param payloadHash - Hash of the payload
 * @param eventType - Type of the event
 * @returns True if hash matches, false otherwise
 */
export function verifyLogHash(
  expectedHash: string,
  previousHash: string,
  timestamp: string,
  payloadHash: string,
  eventType: string,
): boolean {
  const computedHash = generateLogHash(previousHash, timestamp, payloadHash, eventType);
  return computedHash === expectedHash;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a secure random session ID
 *
 * @returns Random UUID-like session identifier
 */
export function generateSessionId(): string {
  const bytes = randomBytes(16);
  // Format as UUID-like string
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Hash sensitive input data for storage without revealing content
 *
 * @param input - Input data (will be JSON stringified if object)
 * @returns SHA-256 hash of the input
 */
export function hashInput(input: unknown): string {
  const data = typeof input === 'string' ? input : JSON.stringify(input);
  return sha256(data);
}

/**
 * Hash output data for storage without revealing content
 *
 * @param output - Output data (will be JSON stringified if object)
 * @returns SHA-256 hash of the output
 */
export function hashOutput(output: unknown): string {
  const data = typeof output === 'string' ? output : JSON.stringify(output);
  return sha256(data);
}
