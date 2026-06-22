/**
 * @file teamStore.test.ts
 * @description Tests for the team Zustand store (list + mutations).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTeamStore } from '../teamStore';
import { teamApi } from '../../api/teamApi';
import type { TeamMember } from '../../types/team.types';

vi.mock('../../api/teamApi', () => ({
  teamApi: {
    list: vi.fn(),
    add: vi.fn(),
    changeRole: vi.fn(),
    setActive: vi.fn(),
  },
}));

const mockedApi = vi.mocked(teamApi);

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'm1',
    email: 'a@neodem.local',
    name: 'Alice',
    role: 'member',
    isActive: true,
    lastLoginAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('teamStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTeamStore.setState({
      members: [],
      loaded: false,
      loading: false,
      error: null,
    });
  });

  it('starts with initial state', () => {
    const state = useTeamStore.getState();
    expect(state.members).toEqual([]);
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('fetch', () => {
    it('loads members on success and clears loading', async () => {
      const members = [member(), member({ id: 'm2', name: 'Bob' })];
      mockedApi.list.mockResolvedValueOnce(members);

      await useTeamStore.getState().fetch();

      const state = useTeamStore.getState();
      expect(state.members).toEqual(members);
      expect(state.loaded).toBe(true);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(mockedApi.list).toHaveBeenCalledTimes(1);
    });

    it('sets error and clears loading on failure, leaving loaded false', async () => {
      mockedApi.list.mockRejectedValueOnce(new Error('boom'));

      await useTeamStore.getState().fetch();

      const state = useTeamStore.getState();
      expect(state.error).toBe('boom');
      expect(state.loading).toBe(false);
      expect(state.loaded).toBe(false);
      expect(state.members).toEqual([]);
    });

    it('falls back to default error message when error has no message', async () => {
      mockedApi.list.mockRejectedValueOnce({});

      await useTeamStore.getState().fetch();

      expect(useTeamStore.getState().error).toBe('Failed to load team');
    });

    it('dedupes concurrent fetches while loading', async () => {
      useTeamStore.setState({ loading: true });

      await useTeamStore.getState().fetch();

      expect(mockedApi.list).not.toHaveBeenCalled();
      // loading flag untouched by the early return
      expect(useTeamStore.getState().loading).toBe(true);
    });

    it('clears a prior error when a new fetch starts', async () => {
      useTeamStore.setState({ error: 'previous' });
      mockedApi.list.mockResolvedValueOnce([member()]);

      await useTeamStore.getState().fetch();

      expect(useTeamStore.getState().error).toBeNull();
    });
  });

  describe('add', () => {
    it('appends the returned member and returns the result', async () => {
      const existing = member();
      useTeamStore.setState({ members: [existing] });
      const added = member({ id: 'm2', name: 'Bob' });
      mockedApi.add.mockResolvedValueOnce({
        member: added,
        tempPassword: 'pw123',
      });

      const result = await useTeamStore.getState().add({
        name: 'Bob',
        email: 'bob@neodem.local',
        role: 'viewer',
      });

      expect(result.tempPassword).toBe('pw123');
      expect(result.member).toEqual(added);
      expect(useTeamStore.getState().members).toEqual([existing, added]);
    });

    it('clears error before adding', async () => {
      useTeamStore.setState({ error: 'previous' });
      mockedApi.add.mockResolvedValueOnce({
        member: member(),
        tempPassword: 'x',
      });

      await useTeamStore.getState().add({
        name: 'Alice',
        email: 'a@neodem.local',
        role: 'member',
      });

      expect(useTeamStore.getState().error).toBeNull();
    });

    it('rejects and does not append on api error', async () => {
      const existing = member();
      useTeamStore.setState({ members: [existing] });
      mockedApi.add.mockRejectedValueOnce(new Error('add failed'));

      await expect(
        useTeamStore.getState().add({
          name: 'Bob',
          email: 'bob@neodem.local',
          role: 'viewer',
        })
      ).rejects.toThrow('add failed');

      expect(useTeamStore.getState().members).toEqual([existing]);
    });
  });

  describe('changeRole', () => {
    it('replaces the matching member with the updated one', async () => {
      const a = member({ id: 'm1', role: 'member' });
      const b = member({ id: 'm2', name: 'Bob' });
      useTeamStore.setState({ members: [a, b] });
      const updated = member({ id: 'm1', role: 'owner' });
      mockedApi.changeRole.mockResolvedValueOnce(updated);

      await useTeamStore.getState().changeRole('m1', 'owner');

      expect(mockedApi.changeRole).toHaveBeenCalledWith('m1', 'owner');
      expect(useTeamStore.getState().members).toEqual([updated, b]);
    });

    it('leaves non-matching members untouched', async () => {
      const a = member({ id: 'm1' });
      const b = member({ id: 'm2', name: 'Bob' });
      useTeamStore.setState({ members: [a, b] });
      mockedApi.changeRole.mockResolvedValueOnce(member({ id: 'm9' }));

      await useTeamStore.getState().changeRole('m9', 'owner');

      // no member with id m9 exists, so list is unchanged
      expect(useTeamStore.getState().members).toEqual([a, b]);
    });

    it('propagates errors and does not mutate members', async () => {
      const a = member({ id: 'm1' });
      useTeamStore.setState({ members: [a] });
      mockedApi.changeRole.mockRejectedValueOnce(new Error('nope'));

      await expect(
        useTeamStore.getState().changeRole('m1', 'owner')
      ).rejects.toThrow('nope');
      expect(useTeamStore.getState().members).toEqual([a]);
    });
  });

  describe('setActive', () => {
    it('replaces the matching member with the updated one', async () => {
      const a = member({ id: 'm1', isActive: true });
      useTeamStore.setState({ members: [a] });
      const updated = member({ id: 'm1', isActive: false });
      mockedApi.setActive.mockResolvedValueOnce(updated);

      await useTeamStore.getState().setActive('m1', false);

      expect(mockedApi.setActive).toHaveBeenCalledWith('m1', false);
      expect(useTeamStore.getState().members).toEqual([updated]);
    });

    it('propagates errors', async () => {
      mockedApi.setActive.mockRejectedValueOnce(new Error('fail'));
      await expect(
        useTeamStore.getState().setActive('m1', false)
      ).rejects.toThrow('fail');
    });
  });

  describe('reset', () => {
    it('restores initial state', () => {
      useTeamStore.setState({
        members: [member()],
        loaded: true,
        loading: true,
        error: 'x',
      });

      useTeamStore.getState().reset();

      const state = useTeamStore.getState();
      expect(state.members).toEqual([]);
      expect(state.loaded).toBe(false);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
