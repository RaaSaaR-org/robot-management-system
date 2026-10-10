/**
 * @file health-storage-status.test.ts
 * @description `/health` and the storage routes report RustFS status through the real app.
 * @feature storage
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { mockGetRustFSStatus, mockIsRustFSInitialized } = vi.hoisted(() => ({
  mockGetRustFSStatus: vi.fn(),
  mockIsRustFSInitialized: vi.fn(),
}));

vi.mock('../storage/rustfs-client.js', async (importActual) => ({
  ...(await importActual<typeof import('../storage/rustfs-client.js')>()),
  getRustFSStatus: mockGetRustFSStatus,
  isRustFSInitialized: mockIsRustFSInitialized,
}));

import { createApp } from '../app.js';

const app = createApp();
const lastAttemptAt = '2026-10-11T08:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_DISABLED', 'true');
});

describe('GET /health', () => {
  it('stays 200 and reports unavailable storage without errorDetail', async () => {
    mockGetRustFSStatus.mockReturnValue({
      configured: true, state: 'unavailable', errorKind: 'auth',
      errorDetail: 'InvalidAccessKeyId (403)', lastAttemptAt, attempts: 3,
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.dependencies.storage).toEqual({
      configured: true, state: 'unavailable', errorKind: 'auth', lastAttemptAt, attempts: 3,
    });
    expect(res.body.dependencies.storage).not.toHaveProperty('errorDetail');
  });

  it('reports ready storage', async () => {
    mockGetRustFSStatus.mockReturnValue({ configured: true, state: 'ready', lastAttemptAt, attempts: 1 });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.dependencies.storage.state).toBe('ready');
  });
});

describe('GET /api/storage/stats while storage is down', () => {
  it('answers 503 carrying state and errorKind', async () => {
    mockIsRustFSInitialized.mockReturnValue(false);
    mockGetRustFSStatus.mockReturnValue({
      configured: true, state: 'unavailable', errorKind: 'auth', errorDetail: 'x', attempts: 2,
    });
    const res = await request(app).get('/api/storage/stats');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ state: 'unavailable', errorKind: 'auth' });
    expect(res.body.message).toBe('RustFS storage is configured but unavailable (auth), retrying');
  });

  it('says not configured when there is no endpoint', async () => {
    mockIsRustFSInitialized.mockReturnValue(false);
    mockGetRustFSStatus.mockReturnValue({ configured: false, state: 'disabled', attempts: 0 });
    const res = await request(app).get('/api/storage/stats');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ state: 'disabled', message: 'RustFS storage is not configured' });
  });
});
