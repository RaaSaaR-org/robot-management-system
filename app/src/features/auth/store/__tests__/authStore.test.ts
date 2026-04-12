/**
 * @file authStore.test.ts
 * @description Tests for the auth Zustand store
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../authStore';
import type { User } from '../../types/auth.types';

const MOCK_USER: User = {
  id: 'test-user-001',
  email: 'test@neodem.local',
  name: 'Test User',
  role: 'owner',
  avatar: undefined,
  tenantId: 'test-tenant',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  lastLoginAt: '2024-01-01T00:00:00.000Z',
};

describe('authStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,
      error: null,
    });
  });

  it('starts with initial state', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.isInitialized).toBe(false);
    expect(state.error).toBeNull();
  });

  it('devLogin sets user and marks as authenticated', () => {
    useAuthStore.getState().devLogin(MOCK_USER);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(MOCK_USER);
    expect(state.isAuthenticated).toBe(true);
    expect(state.isInitialized).toBe(true);
    expect(state.isLoading).toBe(false);
  });

  it('logout clears user state', () => {
    // First login
    useAuthStore.getState().devLogin(MOCK_USER);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    // Then logout
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it('setUser updates user and authentication status', () => {
    useAuthStore.getState().setUser(MOCK_USER);

    expect(useAuthStore.getState().user).toEqual(MOCK_USER);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    useAuthStore.getState().setUser(null);

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('clearError resets error', () => {
    useAuthStore.setState({ error: 'Some error' });
    expect(useAuthStore.getState().error).toBe('Some error');

    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });

  it('setLoading updates loading state', () => {
    useAuthStore.getState().setLoading(true);
    expect(useAuthStore.getState().isLoading).toBe(true);

    useAuthStore.getState().setLoading(false);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});
