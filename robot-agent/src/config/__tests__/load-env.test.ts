/**
 * @file load-env.test.ts
 * @description TASK-389: a profile whose env file is missing warns, naming the
 * file, and falls back to `.env` instead of silently loading nothing.
 * @feature config
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAgentEnv } from '../load-env.js';

let dir: string;
let warnings: string[];
const warn = (m: string) => warnings.push(m);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-env-'));
  warnings = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadAgentEnv', () => {
  it('loads .env when no profile is named', () => {
    writeFileSync(join(dir, '.env'), 'ROBOT_ID=from-dotenv\n');
    const env: NodeJS.ProcessEnv = {};
    const result = loadAgentEnv(env, dir, warn);
    expect(result).toEqual({ loaded: join(dir, '.env'), missing: null });
    expect(env.ROBOT_ID).toBe('from-dotenv');
    expect(warnings).toEqual([]);
  });

  it('loads the profile file named by DOTENV_CONFIG_PATH instead of .env', () => {
    writeFileSync(join(dir, '.env'), 'ROBOT_ID=from-dotenv\n');
    writeFileSync(join(dir, '.env.g1'), 'ROBOT_ID=from-profile\n');
    const env: NodeJS.ProcessEnv = { DOTENV_CONFIG_PATH: '.env.g1' };
    expect(loadAgentEnv(env, dir, warn).loaded).toBe(join(dir, '.env.g1'));
    expect(env.ROBOT_ID).toBe('from-profile');
    expect(warnings).toEqual([]);
  });

  it('warns and falls back to .env when the profile file is missing', () => {
    writeFileSync(join(dir, '.env'), 'GEMINI_API_KEY=k\n');
    const env: NodeJS.ProcessEnv = { DOTENV_CONFIG_PATH: '.env.g1' };
    const result = loadAgentEnv(env, dir, warn);
    expect(result).toEqual({ loaded: join(dir, '.env'), missing: join(dir, '.env.g1') });
    expect(env.GEMINI_API_KEY).toBe('k');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.env.g1 not found');
  });

  it('keeps a value the profile script set inline (ROBOT_TYPE)', () => {
    writeFileSync(join(dir, '.env'), 'ROBOT_TYPE=h1\n');
    const env: NodeJS.ProcessEnv = { DOTENV_CONFIG_PATH: '.env.g1', ROBOT_TYPE: 'g1' };
    loadAgentEnv(env, dir, warn);
    expect(env.ROBOT_TYPE).toBe('g1');
  });

  it('loads nothing, without failing, when no file exists at all', () => {
    const env: NodeJS.ProcessEnv = { DOTENV_CONFIG_PATH: '.env.g1' };
    expect(loadAgentEnv(env, dir, warn)).toEqual({ loaded: null, missing: join(dir, '.env.g1') });
    expect(warnings).toHaveLength(1);
  });
});
