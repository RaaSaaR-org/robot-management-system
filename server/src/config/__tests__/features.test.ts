/**
 * @file features.test.ts
 * @description TASK-321: `CONTROL_LEASES_ENABLED` defaults on — unset and
 *              `true` enable control leases, `false` turns them off — and the
 *              `/api/config/features` snapshot carries the same value.
 * @feature config
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'CONTROL_LEASES_ENABLED';
let saved: string | undefined;

function setFlag(value: string | undefined): void {
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
}

async function load(value: string | undefined) {
  setFlag(value);
  vi.resetModules();
  return import('../features.js');
}

beforeEach(() => {
  saved = process.env[KEY];
});

afterEach(() => {
  setFlag(saved);
});

describe('CONTROL_LEASES_ENABLED', () => {
  it.each([
    [undefined, true],
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('%s → %s', async (value, expected) => {
    const features = await load(value);
    expect(features.controlLeasesEnabled()).toBe(expected);
    expect(features.getFeatureFlags().controlLeasesEnabled).toBe(expected);
  });

  it('is read per call, not frozen at import', async () => {
    const features = await load(undefined);
    expect(features.controlLeasesEnabled()).toBe(true);
    setFlag('false');
    expect(features.controlLeasesEnabled()).toBe(false);
  });

  it('the service re-exports the flag the routes and sweeper default to', async () => {
    setFlag('false');
    vi.resetModules();
    const service = await import('../../services/ControlLeaseService.js');
    expect(service.controlLeasesEnabled()).toBe(false);
    setFlag(undefined);
    expect(service.controlLeasesEnabled()).toBe(true);
  });
});
