/**
 * @file handlers.test.ts
 * @description The demo mock layer's own contract test (TASK-300): the real api
 *   modules, over the real axios client, against the real handlers — no
 *   `vi.mock` anywhere. Every store that assigns `response.<field>` straight
 *   into state depends on the field being there and being the right kind of
 *   thing, and until this file nothing checked that.
 * @feature mocks
 */

import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { handlers } from '../handlers';
import { safetyApi } from '@/features/safety/api/safetyApi';
import { commandApi } from '@/features/command/api/commandApi';
import { teamApi } from '@/features/team/api/teamApi';
import { serviceAccountsApi } from '@/features/team/api/serviceAccountsApi';
import { organizationsApi } from '@/features/organizations/api/organizationsApi';
import { patrolApi } from '@/features/patrol/api/patrolApi';
import { tourApi } from '@/features/tour/api/tourApi';
import { settingsApi } from '@/features/settings/api/settingsApi';
import { authApi } from '@/features/auth/api/authApi';
import { apiClient, ApiRequestError } from '@/api/client';

// File-local on purpose: the global server in `src/test/setup.ts` is shared
// with every other suite, and `onUnhandledRequest: 'error'` there would fail
// the many suites that replace the api module and never reach the network.
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('demo handlers answer the shape each store reads', () => {
  it('GET /api/safety/fleet carries an iterable robots list', async () => {
    const status = await safetyApi.getFleetSafetyStatus();

    // safetyStore.fetchFleetStatus() does `for (const robot of status.robots)`.
    expect(Array.isArray(status.robots)).toBe(true);
    expect(typeof status.anyTriggered).toBe('boolean');
    expect(typeof status.triggeredCount).toBe('number');
    expect(typeof status.timestamp).toBe('string');
    for (const robot of status.robots) {
      expect(typeof robot.robotId).toBe('string');
      expect(robot.status).toBe('armed');
    }
  });

  it('GET /api/safety/robots/:id carries one robot status', async () => {
    const status = await safetyApi.getRobotSafetyStatus('demo-h1-001');

    expect(status.robotId).toBe('demo-h1-001');
    expect(Array.isArray(status.warnings)).toBe(true);
  });

  it('GET /api/command/history carries entries and pagination', async () => {
    const history = await commandApi.getHistory();

    // commandStore.fetchHistory() does `state.history = response.entries`.
    expect(Array.isArray(history.entries)).toBe(true);
    expect(typeof history.pagination.page).toBe('number');
    expect(typeof history.pagination.totalPages).toBe('number');
  });

  it('GET /api/team carries a members list', async () => {
    await expect(teamApi.list()).resolves.toEqual([]);
  });

  it('GET /api/team/service-accounts carries an accounts list', async () => {
    await expect(serviceAccountsApi.list()).resolves.toEqual([]);
  });

  it('GET /api/tenants carries a tenants list', async () => {
    await expect(organizationsApi.list()).resolves.toEqual([]);
  });

  it('GET /api/tenants/current carries one organization', async () => {
    const tenant = await organizationsApi.getCurrent();

    expect(typeof tenant.id).toBe('string');
    expect(typeof tenant.name).toBe('string');
    expect(typeof tenant.counts.robots).toBe('number');
  });

  it('GET /api/patrol/routes is a bare array', async () => {
    const routes = await patrolApi.listRoutes();

    expect(Array.isArray(routes)).toBe(true);
  });

  it('GET /api/tour/runs is a bare array', async () => {
    const runs = await tourApi.listRuns();

    expect(Array.isArray(runs)).toBe(true);
  });

  it('GET /api/settings carries a complete UserSettings record', async () => {
    const settings = await settingsApi.getSettings();

    expect(settings.theme).toBe('dark');
    expect(typeof settings.refreshIntervalSec).toBe('number');
    expect(typeof settings.compactMode).toBe('boolean');
    expect(typeof settings.defaultDashboardView).toBe('string');
  });

  it('GET /api/auth/mfa/status carries the three MFA booleans', async () => {
    const status = await authApi.mfaGetStatus();

    expect(status).toEqual({
      mfaEnabled: false,
      totpConfigured: false,
      hasRecoveryCodes: false,
    });
  });
});

describe('an endpoint nobody wrote a handler for', () => {
  it('rejects with 404 instead of resolving an empty envelope', async () => {
    const failure = await apiClient
      .get('/not-a-real-endpoint')
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiRequestError);
    expect((failure as ApiRequestError).statusCode).toBe(404);
    expect((failure as ApiRequestError).message).toContain(
      'No demo handler for GET /api/not-a-real-endpoint'
    );
  });

  it('marks the answer with x-msw-unhandled so the e2e gate can see it', async () => {
    const response = await fetch('/api/not-a-real-endpoint');

    expect(response.status).toBe(404);
    expect(response.headers.get('x-msw-unhandled')).toBe('1');
  });
});
