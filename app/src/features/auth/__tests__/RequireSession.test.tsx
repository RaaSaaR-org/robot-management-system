/**
 * @file RequireSession.test.tsx
 * @description TASK-483: what a browser sees when it opens an app URL, in both
 *              server modes. Without sign-in a fresh browser lands on the deep
 *              link it asked for as the server's shared user — no token, no
 *              form — and /login leads into the app. With sign-in, a missing
 *              or rejected session still goes to the sign-in page.
 * @feature auth
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';

const http = vi.hoisted(() => ({ get: vi.fn() }));
const api = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/api', () => ({ apiClient: http }));
vi.mock('../api/authApi', () => ({ authApi: api }));
vi.mock('../components/LoginForm', () => ({ LoginForm: () => <form aria-label="Sign in form" /> }));

import { tokenStorage, ApiRequestError } from '@/api/client';
import { useFeaturesStore } from '@/shared/hooks/useFeatures';
import { useAuthStore } from '../store/authStore';
import { RequireSession } from '../components/RequireSession';
import { LoginPage } from '../pages/LoginPage';

const SHARED_USER = {
  id: 'dev-user-id',
  email: 'dev@neodem.local',
  name: 'Demo user',
  role: 'super-admin' as const,
  createdAt: '2026-11-13T00:00:00.000Z',
  updatedAt: '2026-11-13T00:00:00.000Z',
};
const ADA = { ...SHARED_USER, id: 'u-1', email: 'ada@example.com', name: 'Ada Lovelace' };

const DEEP_LINK = '/datasets/a549a2b4/episodes';
const toSignIn = vi.fn();

const failure = (statusCode: number) =>
  new ApiRequestError({ code: 'X', message: `status ${statusCode}`, statusCode });

/** The server's answer to the public `/config/features`. */
function serverSays(flags: Record<string, boolean> | Error) {
  http.get.mockImplementation((url: string) =>
    url === '/config/features' && !(flags instanceof Error)
      ? Promise.resolve({ data: flags })
      : Promise.reject(flags instanceof Error ? flags : new Error(`unexpected GET ${url}`)),
  );
}

function EpisodesPage() {
  const { id } = useParams();
  return <h1>Episodes of {id}</h1>;
}

/** Boot the way main.tsx does: initialize the session, then render the routes. */
async function open(path: string) {
  await useAuthStore.getState().initialize();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={<RequireSession onSignInNeeded={toSignIn}><h1>Dashboard</h1></RequireSession>}
        />
        <Route
          path="/datasets/:id/episodes"
          element={<RequireSession onSignInNeeded={toSignIn}><EpisodesPage /></RequireSession>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useFeaturesStore.setState({
    flags: { ...useFeaturesStore.getInitialState().flags },
    loaded: false,
    loading: false,
    error: null,
  });
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isInitialized: false,
    mustChangePassword: false,
  });
});

describe('a server without sign-in', () => {
  beforeEach(() => serverSays({ signInRequired: false }));

  it('opens the requested deep link in a fresh browser, as the shared user and without a token', async () => {
    api.getCurrentUser.mockResolvedValue(SHARED_USER);

    await open(DEEP_LINK);

    expect(await screen.findByRole('heading', { name: 'Episodes of a549a2b4' })).toBeInTheDocument();
    expect(useAuthStore.getState().user).toEqual(SHARED_USER);
    expect(tokenStorage.getAccessToken()).toBeNull();
    expect(toSignIn).not.toHaveBeenCalled();
  });

  it('turns /login into the dashboard instead of a form nobody has credentials for', async () => {
    api.getCurrentUser.mockResolvedValue(SHARED_USER);

    await open('/login');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Sign in form' })).not.toBeInTheDocument();
  });

  it('offers a retry, not the sign-in page, when the server does not answer', async () => {
    api.getCurrentUser.mockRejectedValueOnce(failure(429));

    await open(DEEP_LINK);

    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
    expect(toSignIn).not.toHaveBeenCalled();

    api.getCurrentUser.mockResolvedValue(SHARED_USER);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Episodes of a549a2b4' })).toBeInTheDocument();
    expect(toSignIn).not.toHaveBeenCalled();
  });

  it('ignores a leftover token from an earlier setup', async () => {
    tokenStorage.setTokens('stale', 'stale');
    api.getCurrentUser.mockResolvedValue(SHARED_USER);

    await open(DEEP_LINK);

    expect(await screen.findByRole('heading', { name: 'Episodes of a549a2b4' })).toBeInTheDocument();
  });
});

describe('a server that requires sign-in', () => {
  beforeEach(() => serverSays({ signInRequired: true }));

  it('sends a fresh browser on a deep link to sign in, without asking /me', async () => {
    await open(DEEP_LINK);

    await waitFor(() => expect(toSignIn).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Episodes of a549a2b4' })).not.toBeInTheDocument();
    expect(api.getCurrentUser).not.toHaveBeenCalled();
  });

  it('shows the sign-in form on /login', async () => {
    await open('/login');

    expect(await screen.findByRole('form', { name: 'Sign in form' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('opens the deep link for a stored session', async () => {
    tokenStorage.setTokens('access', 'refresh');
    api.getCurrentUser.mockResolvedValue(ADA);

    await open(DEEP_LINK);

    expect(await screen.findByRole('heading', { name: 'Episodes of a549a2b4' })).toBeInTheDocument();
    expect(tokenStorage.getAccessToken()).toBe('access');
    expect(toSignIn).not.toHaveBeenCalled();
  });

  it('sends a session the server answers 401 to back to sign in and drops its tokens', async () => {
    tokenStorage.setTokens('expired', 'revoked');
    api.getCurrentUser.mockRejectedValue(failure(401));
    api.refresh.mockRejectedValue(failure(401));

    await open(DEEP_LINK);

    await waitFor(() => expect(toSignIn).toHaveBeenCalled());
    expect(tokenStorage.getAccessToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('sends a signed-in user to sign in when a 401 ends the session mid-use', async () => {
    tokenStorage.setTokens('access', 'refresh');
    api.getCurrentUser.mockResolvedValue(ADA);
    await open(DEEP_LINK);
    expect(await screen.findByRole('heading', { name: 'Episodes of a549a2b4' })).toBeInTheDocument();

    // The refresh that follows a 401 is rejected: the store signs out.
    api.refresh.mockRejectedValue(failure(401));
    await useAuthStore.getState().refreshSession();

    await waitFor(() => expect(toSignIn).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Episodes of a549a2b4' })).not.toBeInTheDocument();
    expect(tokenStorage.getRefreshToken()).toBeNull();
  });
});

describe('a server that does not say', () => {
  it('is treated as requiring sign-in when it predates the flag', async () => {
    serverSays({ multiTenancyEnabled: false });

    await open(DEEP_LINK);

    await waitFor(() => expect(toSignIn).toHaveBeenCalled());
    expect(api.getCurrentUser).not.toHaveBeenCalled();
  });

  it('is treated as requiring sign-in when the feature snapshot cannot be read', async () => {
    serverSays(new Error('network down'));

    await open(DEEP_LINK);

    await waitFor(() => expect(toSignIn).toHaveBeenCalled());
    expect(api.getCurrentUser).not.toHaveBeenCalled();
  });

  it('opens the page by itself once a late snapshot says no sign-in is needed', async () => {
    serverSays(new Error('network down'));
    await open(DEEP_LINK);
    await waitFor(() => expect(toSignIn).toHaveBeenCalled());

    // The retry `useFeatures` schedules after a failed request gets through.
    serverSays({ signInRequired: false });
    api.getCurrentUser.mockResolvedValue(SHARED_USER);
    await useFeaturesStore.getState().fetch();

    expect(await screen.findByRole('heading', { name: 'Episodes of a549a2b4' })).toBeInTheDocument();
    expect(screen.queryByText("Can't reach the server")).not.toBeInTheDocument();
    expect(tokenStorage.getAccessToken()).toBeNull();
  });

  it('stays on sign-in when a late snapshot says sign-in is required', async () => {
    serverSays(new Error('network down'));
    await open(DEEP_LINK);
    await waitFor(() => expect(toSignIn).toHaveBeenCalled());

    serverSays({ signInRequired: true });
    await useFeaturesStore.getState().fetch();

    expect(api.getCurrentUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
