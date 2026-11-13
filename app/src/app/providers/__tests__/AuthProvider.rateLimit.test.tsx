/**
 * @file AuthProvider.rateLimit.test.tsx
 * @description A throttled /auth/me never blanks the shell: a known session
 *              renders the app at once, and a first visit that has to wait
 *              says why under its spinner (TASK-482).
 * @feature auth
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({
  refresh: vi.fn(),
  getCurrentUser: vi.fn(),
  logout: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/features/auth/api/authApi', () => ({ authApi: api }));

import { tokenStorage } from '@/api/client';
import { RATE_LIMIT_HINT_DELAY_MS, beginRateLimitWait, resetRateLimitStatus } from '@/api/rateLimitStatus';
import { useAuthStore } from '@/features/auth/store/authStore';
import { AuthProvider } from '../AuthProvider';

function setSession(known: boolean) {
  localStorage.clear();
  tokenStorage.setTokens('access', 'refresh');
  useAuthStore.setState({
    user: known ? ({ id: 'u1', name: 'Ada', role: 'owner' } as never) : null,
    isAuthenticated: known,
    isInitialized: false,
    isLoading: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  resetRateLimitStatus();
  // /auth/me is being waited out: it does not answer during the test.
  api.getCurrentUser.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  act(() => resetRateLimitStatus());
  vi.useRealTimers();
});

describe('AuthProvider while /auth/me is throttled', () => {
  it('renders the app at once for a session this browser already knows', () => {
    setSession(true);
    render(<AuthProvider><p>the shell</p></AuthProvider>);

    expect(screen.getByText('the shell')).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading authentication')).not.toBeInTheDocument();
  });

  it('says why a first visit is still waiting, once the wait lasts', () => {
    setSession(false);
    render(<AuthProvider><p>the shell</p></AuthProvider>);
    expect(screen.getByLabelText('Loading authentication')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-rate-limit-hint')).not.toBeInTheDocument();

    // What the API client does while it backs off after a 429.
    act(() => { beginRateLimitWait(); });
    act(() => { vi.advanceTimersByTime(RATE_LIMIT_HINT_DELAY_MS); });

    expect(screen.getByTestId('auth-rate-limit-hint')).toHaveTextContent('retrying automatically');
  });
});
