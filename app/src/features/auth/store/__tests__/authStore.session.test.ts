/**
 * @file authStore.session.test.ts
 * @description Session upkeep ends the session only when the server rejects the
 *   credentials — a rate limit or an outage is not a logout (TASK-362).
 * @feature auth
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({
  refresh: vi.fn(),
  getCurrentUser: vi.fn(),
  logout: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../api/authApi', () => ({ authApi: api }));

import { tokenStorage, ApiRequestError } from '@/api/client';
import { useAuthStore } from '../authStore';

const failure = (statusCode: number) =>
  new ApiRequestError({ code: 'X', message: `status ${statusCode}`, statusCode });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  tokenStorage.setTokens('access', 'refresh');
  useAuthStore.setState({ user: { id: 'u1' } as never, isAuthenticated: true });
});

describe('refreshSession', () => {
  it.each([429, 500, 0])('keeps the session when the refresh fails with %i', async (status) => {
    api.refresh.mockRejectedValueOnce(failure(status));
    await expect(useAuthStore.getState().refreshSession()).rejects.toBeInstanceOf(ApiRequestError);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(tokenStorage.getRefreshToken()).toBe('refresh');
  });

  it('logs out when the server rejects the refresh token', async () => {
    api.refresh.mockRejectedValueOnce(failure(401));
    await useAuthStore.getState().refreshSession();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(tokenStorage.getRefreshToken()).toBeNull();
  });
});

describe('initialize', () => {
  it('keeps the tokens when /me and the refresh are rate limited', async () => {
    api.getCurrentUser.mockRejectedValue(failure(429));
    api.refresh.mockRejectedValueOnce(failure(429));
    await useAuthStore.getState().initialize();
    expect(tokenStorage.getAccessToken()).toBe('access');
    expect(tokenStorage.getRefreshToken()).toBe('refresh');
  });
});
