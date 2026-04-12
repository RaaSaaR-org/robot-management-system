/**
 * @file tokens.ts
 * @description API token generation, hashing, and constant-time comparison.
 * Uses crypto.randomBytes (CSPRNG) — never Math.random.
 * @feature auth
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/** Token prefix — recognizable in pastes/grep, registerable with GitHub secret scanning. */
const TOKEN_PREFIX = 'ndsa_';

/** Number of random bytes — base64url-encoded to 43 chars. */
const TOKEN_BYTES = 32;

/** Characters in the prefix portion stored for index lookup (including `ndsa_`). */
const PREFIX_LENGTH = 12;

export interface GeneratedToken {
  /** Full plaintext token (e.g. `ndsa_aBcD...`). Shown once, never persisted. */
  plaintext: string;
  /** First 12 chars for DB index lookup and truncated display. */
  prefix: string;
  /** SHA-256 hex hash of the full plaintext. Stored in DB. */
  hash: string;
}

/**
 * Generate a new API token with its prefix and hash.
 */
export function generateToken(): GeneratedToken {
  const raw = randomBytes(TOKEN_BYTES);
  const plaintext = TOKEN_PREFIX + raw.toString('base64url');
  const prefix = plaintext.slice(0, PREFIX_LENGTH);
  const hash = hashToken(plaintext);
  return { plaintext, prefix, hash };
}

/**
 * SHA-256 hex digest of a plaintext token.
 */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/**
 * Constant-time comparison of two hex strings.
 * Returns false (rather than throwing) when lengths differ,
 * so a length mismatch doesn't leak timing information.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
