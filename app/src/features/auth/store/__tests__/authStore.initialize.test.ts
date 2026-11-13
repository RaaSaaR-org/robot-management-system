/**
 * @file authStore.initialize.test.ts
 * @description A session this browser already knows opens the shell without
 *              waiting for /auth/me, and survives /auth/me being throttled or
 *              down; only the server refusing it ends it (TASK-482).
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

const KNOWN = { id: 'u1', name: 'Ada', role: 'owner' } as never;

function reset(session: 'known' | 'tokens-only' | 'none') {
  localStorage.clear();
  vi.clearAllMocks();
  if (session !== 'none') tokenStorage.setTokens('access', 'refresh');
  useAuthStore.setState({
    user: session === 'known' ? KNOWN : null,
    isAuthenticated: session === 'known',
    isInitialized: false,
    isLoading: false,
    mustChangePassword: false,
  });
}

describe('initialize with a session this browser already knows', () => {
  beforeEach(() => reset('known'));

  it('opens the shell at once, before /auth/me has answered', async () => {
    let answer: (user: unknown) => void = () => {};
    api.getCurrentUser.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));

    const done = useAuthStore.getState().initialize();

    // /me is still in flight — the shell is not waiting for it.
    expect(useAuthStore.getState().isInitialized).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);

    answer({ id: 'u1', name: 'Ada Lovelace', role: 'owner' });
    await done;
    expect(useAuthStore.getState().user).toMatchObject({ name: 'Ada Lovelace' });
  });

  it.each([429, 503, 0])('keeps the session when /auth/me fails with %i', async (status) => {
    api.getCurrentUser.mockRejectedValue(failure(status));

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toMatchObject({ id: 'u1' });
    expect(tokenStorage.getAccessToken()).toBe('access');
    // A throttled /me is not answered with more requests.
    expect(api.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('ends the session when the server refuses it', async () => {
    api.getCurrentUser.mockRejectedValue(failure(401));
    api.refresh.mockRejectedValueOnce(failure(401));

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.isInitialized).toBe(true);
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(tokenStorage.getAccessToken()).toBeNull();
  });

  it('keeps the forced password change gate up from the first render', () => {
    useAuthStore.setState({ user: { id: 'u1', forcePasswordChange: true } as never });
    api.getCurrentUser.mockReturnValueOnce(new Promise(() => {}));

    void useAuthStore.getState().initialize();

    expect(useAuthStore.getState().mustChangePassword).toBe(true);
  });
});

describe('initialize with tokens but no known user', () => {
  beforeEach(() => reset('tokens-only'));

  it('waits for /auth/me, since there is nobody to show the shell for', async () => {
    let answer: (user: unknown) => void = () => {};
    api.getCurrentUser.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));

    const done = useAuthStore.getState().initialize();
    expect(useAuthStore.getState().isInitialized).toBe(false);
    expect(useAuthStore.getState().isLoading).toBe(true);

    answer({ id: 'u2', name: 'Grace', role: 'member' });
    await done;
    expect(useAuthStore.getState()).toMatchObject({ isInitialized: true, isAuthenticated: true, isLoading: false });
  });

  it('keeps the tokens when /auth/me stays throttled', async () => {
    api.getCurrentUser.mockRejectedValue(failure(429));
    api.refresh.mockRejectedValueOnce(failure(429));

    await useAuthStore.getState().initialize();

    expect(useAuthStore.getState()).toMatchObject({ isInitialized: true, isAuthenticated: false });
    expect(tokenStorage.getAccessToken()).toBe('access');
  });
});

describe('initialize signed out', () => {
  beforeEach(() => reset('none'));

  it('asks the server nothing', async () => {
    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().isInitialized).toBe(true);
    expect(api.getCurrentUser).not.toHaveBeenCalled();
  });
});
