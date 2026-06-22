/**
 * @file tokens.test.ts
 * @description Unit tests for the API token utilities (generateToken, hashToken,
 *   timingSafeEqualHex). These are pure crypto functions backed by node:crypto's
 *   CSPRNG and SHA-256 — no boundaries are mocked. Tests assert real invariants:
 *   token shape, hash determinism, and constant-time hex comparison semantics.
 * @feature auth
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { generateToken, hashToken, timingSafeEqualHex } from '../tokens.js';

describe('generateToken', () => {
  it('produces a plaintext with the ndsa_ prefix', () => {
    const { plaintext } = generateToken();
    expect(plaintext.startsWith('ndsa_')).toBe(true);
  });

  it('encodes 32 random bytes as base64url (43 chars) after the prefix', () => {
    const { plaintext } = generateToken();
    // 'ndsa_' (5) + base64url of 32 bytes (43, no padding) = 48
    expect(plaintext).toHaveLength(48);
    const body = plaintext.slice('ndsa_'.length);
    expect(body).toHaveLength(43);
    // base64url alphabet only (no +, /, or =)
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a 12-char prefix that is the start of the plaintext', () => {
    const { plaintext, prefix } = generateToken();
    expect(prefix).toHaveLength(12);
    expect(prefix).toBe(plaintext.slice(0, 12));
    expect(prefix.startsWith('ndsa_')).toBe(true);
  });

  it('returns a hash equal to the SHA-256 hex of the plaintext', () => {
    const { plaintext, hash } = generateToken();
    const expected = createHash('sha256').update(plaintext).digest('hex');
    expect(hash).toBe(expected);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens across many invocations (CSPRNG)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateToken().plaintext);
    }
    expect(seen.size).toBe(1000);
  });
});

describe('hashToken', () => {
  it('is deterministic for the same input', () => {
    expect(hashToken('ndsa_abc')).toBe(hashToken('ndsa_abc'));
  });

  it('matches a known SHA-256 hex digest', () => {
    expect(hashToken('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('hashes an empty string to the known SHA-256 of empty input', () => {
    expect(hashToken('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('always returns a 64-char lowercase hex string', () => {
    const h = hashToken('some-long-token-value-1234567890');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('timingSafeEqualHex', () => {
  it('returns true for identical hex strings of equal length', () => {
    const a = hashToken('same');
    expect(timingSafeEqualHex(a, a)).toBe(true);
  });

  it('returns false for different hex strings of equal length', () => {
    const a = hashToken('one');
    const b = hashToken('two');
    expect(a).toHaveLength(b.length);
    expect(timingSafeEqualHex(a, b)).toBe(false);
  });

  it('returns false when decoded buffer lengths differ', () => {
    // 'ab' -> 1 byte, 'abcd' -> 2 bytes
    expect(timingSafeEqualHex('ab', 'abcd')).toBe(false);
  });

  it('treats odd/invalid hex by buffer-length comparison (ignores trailing nibble)', () => {
    // Buffer.from('abc', 'hex') parses only 'ab' (1 byte), same as 'ab'.
    expect(timingSafeEqualHex('abc', 'ab')).toBe(true);
  });

  it('returns true for two empty hex strings (both decode to empty buffers)', () => {
    expect(timingSafeEqualHex('', '')).toBe(true);
  });

  it('round-trips a generated token hash through compare', () => {
    const { plaintext, hash } = generateToken();
    expect(timingSafeEqualHex(hashToken(plaintext), hash)).toBe(true);
  });
});
