/**
 * @file sidecarClient.static.test.ts
 * @description Reads the supervisor's source and fails if it gains a way to move
 * the robot: the sidecar client may call GET /health, POST /disarm and POST
 * /estop — no /arm, /action, /loco/* or /estop/reset, anywhere in src/. Also
 * pins the never-kill rules to the one place that sends signals.
 * @feature supervisor
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarClient } from '../src/sidecarClient.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Source without comments, so the doc text that names the forbidden routes does not count. */
function code(file: string): string {
  return readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const FORBIDDEN = [/['"`]\/arm['"`/?]/, /['"`]\/action\b/, /\/loco\//, /['"`]\/loco['"`]/, /\/estop\/reset/, /\/record\/start/];

describe('the supervisor cannot move the robot', () => {
  it('the sidecar client calls only /health, /disarm and /estop', () => {
    const src = code('sidecarClient.ts');
    for (const re of FORBIDDEN) expect(src).not.toMatch(re);
    const paths = [...src.matchAll(/['"`](\/[a-z][a-z/_-]*)['"`]/g)].map((m) => m[1]);
    expect(new Set(paths)).toEqual(new Set(['/health', '/disarm', '/estop']));
  });

  it('the client object exposes exactly health, disarm and estop', () => {
    const methods = Object.getOwnPropertyNames(SidecarClient.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['disarm', 'estop', 'health', 'request'].sort());
  });

  it('no file in src/ names a motion or mode route of the sidecar', () => {
    for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
      const src = code(file);
      for (const re of FORBIDDEN) expect(src, `${file} matches ${re}`).not.toMatch(re);
    }
  });

  it('never sets G1_READ_ONLY or G1_ARM_ALLOW_UNKNOWN_FSM for a child', () => {
    for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
      const src = code(file);
      for (const key of ['G1_READ_ONLY', 'G1_ARM_ALLOW_UNKNOWN_FSM']) {
        // as an object key with a value, or assigned through env.X / env['X']
        expect(src, file).not.toMatch(new RegExp(`(^|[{,\\s])['"]?${key}['"]?\\s*:\\s*['"\`\\w]`, 'm'));
        expect(src, file).not.toMatch(new RegExp(`\\.${key}\\s*=[^=]|\\[['"]${key}['"]\\]\\s*=[^=]`));
      }
    }
  });

  it('every signal goes through Supervisor.signal(), which refuses SIGKILL for a sidecar and foreign processes', () => {
    const steps = code('steps.ts');
    // killFn is called in exactly one place
    expect(steps.match(/this\.killFn\(/g)?.length).toBe(1);
    expect(steps).toMatch(/if \(!rec\.owned\)[\s\S]{0,200}return false/);
    expect(steps).toMatch(/rec\.proc === 'sidecar' && sig === 'SIGKILL'[\s\S]{0,200}return false/);
    for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts') && f !== 'steps.ts')) {
      expect(code(file), file).not.toMatch(/process\.kill\(/);
    }
  });
});
