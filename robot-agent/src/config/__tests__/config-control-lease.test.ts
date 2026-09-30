/**
 * @file config-control-lease.test.ts
 * @description TASK-321: control-lease enforcement stays opt-in on the agent —
 * `controlLease.required` is `false` unless `CONTROL_LEASE_REQUIRED=true`,
 * even though the server now grants leases by default.
 * @feature control-lease
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KEY = 'CONTROL_LEASE_REQUIRED';

/** `config` reads the environment once at import, so re-import per case. */
async function loadRequired(value: string | undefined): Promise<boolean> {
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  vi.resetModules();
  const mod = await import('../config.js');
  return mod.config.controlLease.required;
}

describe('config.controlLease.required', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('defaults to false when unset', async () => {
    expect(await loadRequired(undefined)).toBe(false);
  });

  it('is true only for "true"', async () => {
    expect(await loadRequired('true')).toBe(true);
  });

  it.each(['false', '', '0', 'yes'])('stays false for %j', async (value) => {
    expect(await loadRequired(value)).toBe(false);
  });
});
