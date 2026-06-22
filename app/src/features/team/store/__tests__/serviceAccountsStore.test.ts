/**
 * @file serviceAccountsStore.test.ts
 * @description Tests for the service accounts Zustand store (TASK-165).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useServiceAccountsStore } from '../serviceAccountsStore';
import { serviceAccountsApi } from '../../api/serviceAccountsApi';
import type { ServiceAccount } from '../../types/serviceAccount.types';

vi.mock('../../api/serviceAccountsApi', () => ({
  serviceAccountsApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockedApi = vi.mocked(serviceAccountsApi);

function account(overrides: Partial<ServiceAccount> = {}): ServiceAccount {
  return {
    id: 'sa1',
    name: 'CI Bot',
    email: 'ci@neodem.local',
    role: 'member',
    isActive: true,
    kind: 'service',
    createdById: 'u1',
    tokenCount: 0,
    lastUsedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('serviceAccountsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useServiceAccountsStore.setState({
      accounts: [],
      loaded: false,
      loading: false,
      error: null,
    });
  });

  it('starts with initial state', () => {
    const state = useServiceAccountsStore.getState();
    expect(state.accounts).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('fetch', () => {
    it('loads accounts on success and clears loading', async () => {
      const accounts = [account(), account({ id: 'sa2', name: 'Deploy Bot' })];
      mockedApi.list.mockResolvedValueOnce(accounts);

      await useServiceAccountsStore.getState().fetch();

      const state = useServiceAccountsStore.getState();
      expect(state.accounts).toEqual(accounts);
      expect(state.loaded).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockedApi.list).toHaveBeenCalledTimes(1);
    });

    it('sets error and clears loading on failure, leaving loaded false', async () => {
      mockedApi.list.mockRejectedValueOnce(new Error('down'));

      await useServiceAccountsStore.getState().fetch();

      const state = useServiceAccountsStore.getState();
      expect(state.error).toBe('down');
      expect(state.loading).toBe(false);
      expect(state.loaded).toBe(false);
      expect(state.accounts).toEqual([]);
    });

    it('falls back to default error message when error has no message', async () => {
      mockedApi.list.mockRejectedValueOnce({});

      await useServiceAccountsStore.getState().fetch();

      expect(useServiceAccountsStore.getState().error).toBe(
        'Failed to load service accounts'
      );
    });

    it('dedupes concurrent fetches while loading', async () => {
      useServiceAccountsStore.setState({ loading: true });

      await useServiceAccountsStore.getState().fetch();

      expect(mockedApi.list).not.toHaveBeenCalled();
      expect(useServiceAccountsStore.getState().loading).toBe(true);
    });

    it('clears a prior error when a new fetch starts', async () => {
      useServiceAccountsStore.setState({ error: 'previous' });
      mockedApi.list.mockResolvedValueOnce([account()]);

      await useServiceAccountsStore.getState().fetch();

      expect(useServiceAccountsStore.getState().error).toBeNull();
    });
  });

  describe('create', () => {
    it('prepends the new account and returns it', async () => {
      const existing = account({ id: 'sa1' });
      useServiceAccountsStore.setState({ accounts: [existing] });
      const created = account({ id: 'sa2', name: 'New Bot' });
      mockedApi.create.mockResolvedValueOnce(created);

      const result = await useServiceAccountsStore
        .getState()
        .create({ name: 'New Bot', role: 'member' });

      expect(result).toEqual(created);
      expect(mockedApi.create).toHaveBeenCalledWith({
        name: 'New Bot',
        role: 'member',
      });
      // newest first
      expect(useServiceAccountsStore.getState().accounts).toEqual([
        created,
        existing,
      ]);
    });

    it('clears error before creating', async () => {
      useServiceAccountsStore.setState({ error: 'previous' });
      mockedApi.create.mockResolvedValueOnce(account());

      await useServiceAccountsStore
        .getState()
        .create({ name: 'x', role: 'viewer' });

      expect(useServiceAccountsStore.getState().error).toBeNull();
    });

    it('rejects and does not add on api error', async () => {
      const existing = account();
      useServiceAccountsStore.setState({ accounts: [existing] });
      mockedApi.create.mockRejectedValueOnce(new Error('create failed'));

      await expect(
        useServiceAccountsStore
          .getState()
          .create({ name: 'x', role: 'viewer' })
      ).rejects.toThrow('create failed');

      expect(useServiceAccountsStore.getState().accounts).toEqual([existing]);
    });
  });

  describe('remove', () => {
    it('filters out the removed account', async () => {
      const a = account({ id: 'sa1' });
      const b = account({ id: 'sa2', name: 'Bob' });
      useServiceAccountsStore.setState({ accounts: [a, b] });
      mockedApi.remove.mockResolvedValueOnce(undefined);

      await useServiceAccountsStore.getState().remove('sa1');

      expect(mockedApi.remove).toHaveBeenCalledWith('sa1');
      expect(useServiceAccountsStore.getState().accounts).toEqual([b]);
    });

    it('leaves list unchanged when id is not present', async () => {
      const a = account({ id: 'sa1' });
      useServiceAccountsStore.setState({ accounts: [a] });
      mockedApi.remove.mockResolvedValueOnce(undefined);

      await useServiceAccountsStore.getState().remove('missing');

      expect(useServiceAccountsStore.getState().accounts).toEqual([a]);
    });

    it('propagates errors and does not mutate list', async () => {
      const a = account({ id: 'sa1' });
      useServiceAccountsStore.setState({ accounts: [a] });
      mockedApi.remove.mockRejectedValueOnce(new Error('remove failed'));

      await expect(
        useServiceAccountsStore.getState().remove('sa1')
      ).rejects.toThrow('remove failed');

      expect(useServiceAccountsStore.getState().accounts).toEqual([a]);
    });
  });

  describe('reset', () => {
    it('restores initial state', () => {
      useServiceAccountsStore.setState({
        accounts: [account()],
        loaded: true,
        loading: true,
        error: 'x',
      });

      useServiceAccountsStore.getState().reset();

      const state = useServiceAccountsStore.getState();
      expect(state.accounts).toEqual([]);
      expect(state.loaded).toBe(false);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
