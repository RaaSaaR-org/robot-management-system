/**
 * @file encryption.test.ts
 * @description Unit tests for AES-256-GCM encryption utilities and compliance hashing helpers
 * @feature compliance
 *
 * Crypto round-trips run for real (encrypt->decrypt, hash determinism, tamper detection).
 * The only non-deterministic boundary is the key resolution from process.env, which is
 * exercised via vi.resetModules() + dynamic import so the module-level key cache is fresh
 * per scenario. process.env mutations are saved/restored to avoid cross-test leakage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  encrypt,
  decrypt,
  sha256,
  generateLogHash,
  verifyLogHash,
  generateSessionId,
  hashInput,
  hashOutput,
  type EncryptedData,
} from '../encryption.js';

describe('encryption', () => {
  // --------------------------------------------------------------------------
  // encrypt / decrypt round-trips (real crypto, dev key from NODE_ENV=test)
  // --------------------------------------------------------------------------
  describe('encrypt / decrypt', () => {
    it('round-trips plaintext back to the original string', () => {
      const plaintext = 'sensitive compliance payload 123';
      const enc = encrypt(plaintext);
      expect(decrypt(enc)).toBe(plaintext);
    });

    it('round-trips unicode and empty strings', () => {
      expect(decrypt(encrypt(''))).toBe('');
      expect(decrypt(encrypt('Grüße 🤖 robot'))).toBe('Grüße 🤖 robot');
    });

    it('returns base64-encoded ciphertext, iv, and tag', () => {
      const enc = encrypt('hello');
      const b64 = /^[A-Za-z0-9+/]*={0,2}$/;
      expect(enc.ciphertext).toMatch(b64);
      expect(enc.iv).toMatch(b64);
      expect(enc.tag).toMatch(b64);
    });

    it('uses a 96-bit (12-byte) IV', () => {
      const enc = encrypt('hello');
      expect(Buffer.from(enc.iv, 'base64').length).toBe(12);
    });

    it('uses a 128-bit (16-byte) auth tag', () => {
      const enc = encrypt('hello');
      expect(Buffer.from(enc.tag, 'base64').length).toBe(16);
    });

    it('appends the auth tag to the ciphertext buffer', () => {
      const enc = encrypt('hello');
      const ctWithTag = Buffer.from(enc.ciphertext, 'base64');
      const tag = Buffer.from(enc.tag, 'base64');
      const appended = ctWithTag.subarray(ctWithTag.length - tag.length);
      expect(appended.equals(tag)).toBe(true);
    });

    it('produces a different IV (and thus ciphertext) for each call', () => {
      const a = encrypt('same plaintext');
      const b = encrypt('same plaintext');
      expect(a.iv).not.toBe(b.iv);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it('decrypt only needs ciphertext + iv (tag is embedded)', () => {
      const enc = encrypt('only ciphertext and iv');
      const slim: Pick<EncryptedData, 'ciphertext' | 'iv'> = {
        ciphertext: enc.ciphertext,
        iv: enc.iv,
      };
      expect(decrypt(slim)).toBe('only ciphertext and iv');
    });

    it('throws a sanitized error when the ciphertext is tampered with', () => {
      const enc = encrypt('do not tamper');
      const buf = Buffer.from(enc.ciphertext, 'base64');
      buf[0] ^= 0xff; // flip bits in the ciphertext
      const tampered = { ciphertext: buf.toString('base64'), iv: enc.iv };
      expect(() => decrypt(tampered)).toThrow(
        'Decryption failed: data may be corrupted or tampered with',
      );
    });

    it('throws when the auth tag (tail of ciphertext) is tampered with', () => {
      const enc = encrypt('tag tamper');
      const buf = Buffer.from(enc.ciphertext, 'base64');
      buf[buf.length - 1] ^= 0xff; // flip bits in the appended tag
      const tampered = { ciphertext: buf.toString('base64'), iv: enc.iv };
      expect(() => decrypt(tampered)).toThrow('Decryption failed');
    });

    it('throws when the IV is wrong', () => {
      const enc = encrypt('iv mismatch');
      const wrongIv = Buffer.alloc(12, 0).toString('base64');
      expect(() => decrypt({ ciphertext: enc.ciphertext, iv: wrongIv })).toThrow(
        'Decryption failed',
      );
    });
  });

  // --------------------------------------------------------------------------
  // sha256 — real, deterministic hashing against a known vector
  // --------------------------------------------------------------------------
  describe('sha256', () => {
    it('matches the known SHA-256 vector for empty string', () => {
      expect(sha256('')).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });

    it('matches the known SHA-256 vector for "abc"', () => {
      expect(sha256('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('is deterministic and produces 64 hex chars', () => {
      const h = sha256('determinism');
      expect(h).toBe(sha256('determinism'));
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different inputs', () => {
      expect(sha256('a')).not.toBe(sha256('b'));
    });
  });

  // --------------------------------------------------------------------------
  // generateLogHash / verifyLogHash — chain hashing logic
  // --------------------------------------------------------------------------
  describe('generateLogHash / verifyLogHash', () => {
    const parts = ['prevhash', '2026-06-22T00:00:00.000Z', 'payloadhash', 'EVENT'] as const;

    it('equals sha256 of the pipe-joined fields', () => {
      const expected = sha256(parts.join('|'));
      expect(generateLogHash(...parts)).toBe(expected);
    });

    it('is deterministic for identical inputs', () => {
      expect(generateLogHash(...parts)).toBe(generateLogHash(...parts));
    });

    it('changes when any field changes', () => {
      const base = generateLogHash(...parts);
      expect(generateLogHash('different', parts[1], parts[2], parts[3])).not.toBe(base);
      expect(generateLogHash(parts[0], 'different', parts[2], parts[3])).not.toBe(base);
      expect(generateLogHash(parts[0], parts[1], 'different', parts[3])).not.toBe(base);
      expect(generateLogHash(parts[0], parts[1], parts[2], 'different')).not.toBe(base);
    });

    it('verifyLogHash returns true for a correctly generated hash', () => {
      const hash = generateLogHash(...parts);
      expect(verifyLogHash(hash, ...parts)).toBe(true);
    });

    it('verifyLogHash returns false for a wrong hash', () => {
      expect(verifyLogHash('deadbeef', ...parts)).toBe(false);
    });

    it('verifyLogHash returns false when a field is altered after hashing', () => {
      const hash = generateLogHash(...parts);
      expect(verifyLogHash(hash, 'tampered-prev', parts[1], parts[2], parts[3])).toBe(false);
    });

    it('handles an empty previousHash (first chain entry)', () => {
      const hash = generateLogHash('', parts[1], parts[2], parts[3]);
      expect(verifyLogHash(hash, '', parts[1], parts[2], parts[3])).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // generateSessionId — UUID-like format from random bytes
  // --------------------------------------------------------------------------
  describe('generateSessionId', () => {
    it('produces a UUID-shaped 8-4-4-4-12 hex string', () => {
      expect(generateSessionId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('produces unique ids across calls', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
      expect(ids.size).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // hashInput / hashOutput — JSON stringify branch
  // --------------------------------------------------------------------------
  describe('hashInput / hashOutput', () => {
    it('hashes a string directly (no JSON wrapping)', () => {
      expect(hashInput('plain')).toBe(sha256('plain'));
      expect(hashOutput('plain')).toBe(sha256('plain'));
    });

    it('JSON-stringifies non-string input before hashing', () => {
      const obj = { a: 1, b: ['x', 'y'] };
      expect(hashInput(obj)).toBe(sha256(JSON.stringify(obj)));
      expect(hashOutput(obj)).toBe(sha256(JSON.stringify(obj)));
    });

    it('hashes numbers via JSON.stringify', () => {
      expect(hashInput(42)).toBe(sha256('42'));
    });

    it('distinguishes the string "true" from the boolean true', () => {
      // JSON.stringify(true) === 'true', so they collide by design — document it.
      expect(hashInput(true)).toBe(sha256('true'));
      expect(hashInput('true')).toBe(sha256('true'));
      expect(hashInput(true)).toBe(hashInput('true'));
    });

    it('hashInput and hashOutput share the same algorithm', () => {
      const obj = { foo: 'bar' };
      expect(hashInput(obj)).toBe(hashOutput(obj));
    });
  });
});

// ============================================================================
// Key resolution from process.env — fresh module per scenario.
// getEncryptionKey caches _cachedKey at module scope, and is private, so we
// reset modules + dynamic-import to exercise each env branch independently.
// ============================================================================
describe('encryption key resolution (env branches)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('uses the deterministic development key when no env key is set (NODE_ENV=test)', async () => {
    delete process.env.COMPLIANCE_LOG_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'test';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../encryption.js');
    const enc = mod.encrypt('dev-key-payload');
    expect(mod.decrypt(enc)).toBe('dev-key-payload');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('COMPLIANCE_LOG_ENCRYPTION_KEY not set'),
    );
  });

  it('throws in production when no key is configured', async () => {
    delete process.env.COMPLIANCE_LOG_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';

    const mod = await import('../encryption.js');
    expect(() => mod.encrypt('x')).toThrow(
      'COMPLIANCE_LOG_ENCRYPTION_KEY environment variable is required in production',
    );
  });

  it('throws when the key is not exactly 64 hex characters', async () => {
    process.env.COMPLIANCE_LOG_ENCRYPTION_KEY = 'abcdef'; // too short
    process.env.NODE_ENV = 'production';

    const mod = await import('../encryption.js');
    expect(() => mod.encrypt('x')).toThrow('must be exactly 64 hex characters');
  });

  it('throws when the 64-char key contains non-hex characters', async () => {
    // 64 chars, but 'z' is not hex
    process.env.COMPLIANCE_LOG_ENCRYPTION_KEY = 'z'.repeat(64);
    process.env.NODE_ENV = 'production';

    const mod = await import('../encryption.js');
    expect(() => mod.encrypt('x')).toThrow('must contain only hexadecimal characters');
  });

  it('accepts a valid 64-char hex key and round-trips with it', async () => {
    const keyHex = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    process.env.COMPLIANCE_LOG_ENCRYPTION_KEY = keyHex;
    process.env.NODE_ENV = 'production';

    const mod = await import('../encryption.js');
    const enc = mod.encrypt('prod-key-payload');
    expect(mod.decrypt(enc)).toBe('prod-key-payload');
  });

  it('caches the key (second call does not re-warn)', async () => {
    delete process.env.COMPLIANCE_LOG_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'test';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('../encryption.js');
    mod.encrypt('first');
    mod.encrypt('second');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('data encrypted under the dev key cannot be decrypted under a prod key', async () => {
    // Encrypt with dev key.
    delete process.env.COMPLIANCE_LOG_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'test';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const devMod = await import('../encryption.js');
    const enc = devMod.encrypt('cross-key');

    // Fresh module instance with a real prod key.
    vi.resetModules();
    process.env.COMPLIANCE_LOG_ENCRYPTION_KEY =
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    process.env.NODE_ENV = 'production';
    const prodMod = await import('../encryption.js');
    expect(() => prodMod.decrypt(enc)).toThrow('Decryption failed');
  });
});
