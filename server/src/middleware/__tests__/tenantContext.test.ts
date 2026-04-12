/**
 * @file tenantContext.test.ts
 * @description Unit tests for tenant ALS context, getTenantId, and runAsPlatform
 * @feature multi-tenancy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to control MULTI_TENANCY_ENABLED before importing the module.
// Mock the features module so we can toggle the flag per test.
let multiTenancyEnabled = true;
vi.mock('../../config/features.js', () => ({
  get MULTI_TENANCY_ENABLED() {
    return multiTenancyEnabled;
  },
  DEFAULT_TENANT_ID: 'default',
}));

import {
  tenantStore,
  getTenantId,
  runAsPlatform,
  withTenantContext,
  PLATFORM_TENANT,
} from '../tenantContext.js';

describe('tenantContext', () => {
  beforeEach(() => {
    multiTenancyEnabled = true;
  });

  // --------------------------------------------------------------------------
  // getTenantId
  // --------------------------------------------------------------------------

  describe('getTenantId', () => {
    it('returns undefined when outside any ALS scope', () => {
      expect(getTenantId()).toBeUndefined();
    });

    it('returns tenantId when inside a tenantStore.run scope', () => {
      tenantStore.run({ tenantId: 'tenant-a' }, () => {
        expect(getTenantId()).toBe('tenant-a');
      });
    });

    it('returns undefined when MULTI_TENANCY_ENABLED=false', () => {
      multiTenancyEnabled = false;
      tenantStore.run({ tenantId: 'tenant-a' }, () => {
        expect(getTenantId()).toBeUndefined();
      });
    });

    it('isolates tenantId across nested ALS scopes', () => {
      tenantStore.run({ tenantId: 'outer' }, () => {
        expect(getTenantId()).toBe('outer');
        tenantStore.run({ tenantId: 'inner' }, () => {
          expect(getTenantId()).toBe('inner');
        });
        expect(getTenantId()).toBe('outer');
      });
    });

    it('isolates tenantId across concurrent async tasks', async () => {
      const results: string[] = [];

      const task = (tid: string, delay: number) =>
        new Promise<void>((resolve) => {
          tenantStore.run({ tenantId: tid }, () => {
            setTimeout(() => {
              results.push(getTenantId()!);
              resolve();
            }, delay);
          });
        });

      await Promise.all([task('a', 10), task('b', 5)]);
      expect(results).toContain('a');
      expect(results).toContain('b');
    });
  });

  // --------------------------------------------------------------------------
  // PLATFORM_TENANT sentinel
  // --------------------------------------------------------------------------

  describe('PLATFORM_TENANT', () => {
    it('getTenantId returns undefined inside a PLATFORM_TENANT scope', () => {
      tenantStore.run({ tenantId: PLATFORM_TENANT }, () => {
        expect(getTenantId()).toBeUndefined();
      });
    });
  });

  // --------------------------------------------------------------------------
  // runAsPlatform
  // --------------------------------------------------------------------------

  describe('runAsPlatform', () => {
    it('sets tenantId to PLATFORM_TENANT so getTenantId returns undefined', async () => {
      tenantStore.run({ tenantId: 'tenant-a' }, () => {
        expect(getTenantId()).toBe('tenant-a');
        runAsPlatform(() => {
          expect(getTenantId()).toBeUndefined();
        });
        expect(getTenantId()).toBe('tenant-a');
      });
    });

    it('returns the result of the callback (sync)', () => {
      const result = runAsPlatform(() => 42);
      expect(result).toBe(42);
    });

    it('returns the result of the callback (async)', async () => {
      const result = await runAsPlatform(async () => 'hello');
      expect(result).toBe('hello');
    });
  });

  // --------------------------------------------------------------------------
  // withTenantContext middleware
  // --------------------------------------------------------------------------

  describe('withTenantContext', () => {
    it('wraps next() in an ALS scope with the user tenantId', async () => {
      const req = { user: { tenantId: 'tenant-x' } } as any;
      const res = {} as any;
      await new Promise<void>((resolve) => {
        withTenantContext(req, res, () => {
          expect(getTenantId()).toBe('tenant-x');
          resolve();
        });
      });
    });

    it('falls back to DEFAULT_TENANT_ID when user has no tenantId', async () => {
      const req = { user: {} } as any;
      const res = {} as any;
      await new Promise<void>((resolve) => {
        withTenantContext(req, res, () => {
          expect(getTenantId()).toBe('default');
          resolve();
        });
      });
    });

    it('is a passthrough when MULTI_TENANCY_ENABLED=false', async () => {
      multiTenancyEnabled = false;
      const req = { user: { tenantId: 'tenant-x' } } as any;
      const res = {} as any;
      await new Promise<void>((resolve) => {
        withTenantContext(req, res, () => {
          expect(getTenantId()).toBeUndefined();
          resolve();
        });
      });
    });
  });
});
