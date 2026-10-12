/**
 * @file load-env.test.ts
 * @description TASK-389: the server loads its own `.env` — it no longer depends
 *              on Prisma's implicit loading — without overriding values already
 *              in the environment, and a missing file is not an error.
 * @feature config
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_ROOT, loadServerEnv } from '../load-env.js';

const KEYS = ['TASK389_FROM_FILE', 'TASK389_PRESET'] as const;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'server-env-'));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of KEYS) delete process.env[k];
});

describe('loadServerEnv', () => {
  it('loads variables from <dir>/.env', () => {
    writeFileSync(join(dir, '.env'), 'TASK389_FROM_FILE=hello\n');
    expect(loadServerEnv(dir)).toBe(join(dir, '.env'));
    expect(process.env.TASK389_FROM_FILE).toBe('hello');
  });

  it('does not override a value already in the environment', () => {
    process.env.TASK389_PRESET = 'from-shell';
    writeFileSync(join(dir, '.env'), 'TASK389_PRESET=from-file\n');
    loadServerEnv(dir);
    expect(process.env.TASK389_PRESET).toBe('from-shell');
  });

  it('returns null and changes nothing when there is no .env', () => {
    expect(loadServerEnv(dir)).toBeNull();
    expect(process.env.TASK389_FROM_FILE).toBeUndefined();
  });

  it('defaults to the server directory, not the cwd', () => {
    const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    expect(SERVER_ROOT).toBe(serverRoot);
    expect(existsSync(join(SERVER_ROOT, '.env.example'))).toBe(true);
  });
});
