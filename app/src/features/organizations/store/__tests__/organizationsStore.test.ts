/**
 * @file organizationsStore.test.ts
 * @description Tests for the organizations Zustand store
 * @feature organizations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOrganizationsStore } from '../organizationsStore';
import type { Organization } from '../../types/organizations.types';

// Mock the feature api module the store imports
vi.mock('../../api/organizationsApi', () => ({
  organizationsApi: {
    list: vi.fn(),
    getCurrent: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { organizationsApi } from '../../api/organizationsApi';

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    slug: 'org-1',
    name: 'Org One',
    logoUrl: null,
    plan: 'free',
    settings: '{}',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isDefault: false,
    counts: { users: 0, robots: 0, datasets: 0, trainingJobs: 0 },
    ...overrides,
  };
}

const INITIAL = {
  list: [],
  current: null,
  listLoaded: false,
  listLoading: false,
  currentLoaded: false,
  currentLoading: false,
  error: null,
};

describe('organizationsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrganizationsStore.setState({ ...INITIAL });
  });

  it('starts with initial state', () => {
    const state = useOrganizationsStore.getState();
    expect(state.list).toEqual([]);
    expect(state.current).toBeNull();
    expect(state.listLoaded).toBe(false);
    expect(state.listLoading).toBe(false);
    expect(state.currentLoaded).toBe(false);
    expect(state.currentLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  // --- fetchList ---

  it('fetchList loads list and sets loaded flags', async () => {
    const orgs = [makeOrg({ id: 'a' }), makeOrg({ id: 'b' })];
    vi.mocked(organizationsApi.list).mockResolvedValue(orgs);

    await useOrganizationsStore.getState().fetchList();

    const state = useOrganizationsStore.getState();
    expect(state.list).toEqual(orgs);
    expect(state.listLoaded).toBe(true);
    expect(state.listLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(organizationsApi.list).toHaveBeenCalledOnce();
  });

  it('fetchList dedupes concurrent calls when already loading', async () => {
    useOrganizationsStore.setState({ listLoading: true });

    await useOrganizationsStore.getState().fetchList();

    expect(organizationsApi.list).not.toHaveBeenCalled();
  });

  it('fetchList sets error message from ApiError-shaped reject and clears loading', async () => {
    // API rejects with a plain object, not a native Error
    vi.mocked(organizationsApi.list).mockRejectedValue({ message: 'boom from server' });

    await useOrganizationsStore.getState().fetchList();

    const state = useOrganizationsStore.getState();
    expect(state.error).toBe('boom from server');
    expect(state.listLoading).toBe(false);
    expect(state.listLoaded).toBe(false);
  });

  it('fetchList falls back to default message when error has no message', async () => {
    vi.mocked(organizationsApi.list).mockRejectedValue({ status: 500 });

    await useOrganizationsStore.getState().fetchList();

    expect(useOrganizationsStore.getState().error).toBe('Failed to load organizations');
  });

  // --- fetchCurrent ---

  it('fetchCurrent loads current tenant', async () => {
    const org = makeOrg({ id: 'current' });
    vi.mocked(organizationsApi.getCurrent).mockResolvedValue(org);

    await useOrganizationsStore.getState().fetchCurrent();

    const state = useOrganizationsStore.getState();
    expect(state.current).toEqual(org);
    expect(state.currentLoaded).toBe(true);
    expect(state.currentLoading).toBe(false);
  });

  it('fetchCurrent dedupes when already loading', async () => {
    useOrganizationsStore.setState({ currentLoading: true });

    await useOrganizationsStore.getState().fetchCurrent();

    expect(organizationsApi.getCurrent).not.toHaveBeenCalled();
  });

  it('fetchCurrent skips when already loaded', async () => {
    useOrganizationsStore.setState({ currentLoaded: true });

    await useOrganizationsStore.getState().fetchCurrent();

    expect(organizationsApi.getCurrent).not.toHaveBeenCalled();
  });

  it('fetchCurrent sets error and clears loading on failure', async () => {
    vi.mocked(organizationsApi.getCurrent).mockRejectedValue(new Error('no tenant'));

    await useOrganizationsStore.getState().fetchCurrent();

    const state = useOrganizationsStore.getState();
    expect(state.error).toBe('no tenant');
    expect(state.currentLoading).toBe(false);
    expect(state.currentLoaded).toBe(false);
  });

  // --- create (optimistic append) ---

  it('create appends to list and returns created org', async () => {
    const existing = makeOrg({ id: 'a' });
    useOrganizationsStore.setState({ list: [existing], error: 'old error' });
    const created = makeOrg({ id: 'b', name: 'New Org' });
    vi.mocked(organizationsApi.create).mockResolvedValue(created);

    const result = await useOrganizationsStore
      .getState()
      .create({ name: 'New Org' });

    expect(result).toEqual(created);
    const state = useOrganizationsStore.getState();
    expect(state.list).toEqual([existing, created]);
    expect(state.error).toBeNull();
  });

  it('create propagates API error without mutating list', async () => {
    const existing = makeOrg({ id: 'a' });
    useOrganizationsStore.setState({ list: [existing] });
    vi.mocked(organizationsApi.create).mockRejectedValue(new Error('create failed'));

    await expect(
      useOrganizationsStore.getState().create({ name: 'X' })
    ).rejects.toThrow('create failed');

    expect(useOrganizationsStore.getState().list).toEqual([existing]);
  });

  // --- update ---

  it('update replaces matching org in list and current', async () => {
    const a = makeOrg({ id: 'a', name: 'A' });
    const b = makeOrg({ id: 'b', name: 'B' });
    useOrganizationsStore.setState({ list: [a, b], current: a });
    const updatedA = makeOrg({ id: 'a', name: 'A renamed' });
    vi.mocked(organizationsApi.update).mockResolvedValue(updatedA);

    const result = await useOrganizationsStore
      .getState()
      .update('a', { name: 'A renamed' });

    expect(result).toEqual(updatedA);
    const state = useOrganizationsStore.getState();
    expect(state.list).toEqual([updatedA, b]);
    expect(state.current).toEqual(updatedA);
  });

  it('update leaves current untouched when a different org is updated', async () => {
    const a = makeOrg({ id: 'a' });
    const b = makeOrg({ id: 'b' });
    useOrganizationsStore.setState({ list: [a, b], current: a });
    const updatedB = makeOrg({ id: 'b', name: 'B2' });
    vi.mocked(organizationsApi.update).mockResolvedValue(updatedB);

    await useOrganizationsStore.getState().update('b', { name: 'B2' });

    const state = useOrganizationsStore.getState();
    expect(state.current).toEqual(a);
    expect(state.list).toEqual([a, updatedB]);
  });

  it('update propagates API error', async () => {
    vi.mocked(organizationsApi.update).mockRejectedValue(new Error('update failed'));

    await expect(
      useOrganizationsStore.getState().update('a', { name: 'X' })
    ).rejects.toThrow('update failed');
  });

  // --- remove ---

  it('remove filters org out of list', async () => {
    const a = makeOrg({ id: 'a' });
    const b = makeOrg({ id: 'b' });
    useOrganizationsStore.setState({ list: [a, b] });
    vi.mocked(organizationsApi.delete).mockResolvedValue(undefined);

    await useOrganizationsStore.getState().remove('a');

    expect(useOrganizationsStore.getState().list).toEqual([b]);
    expect(organizationsApi.delete).toHaveBeenCalledWith('a');
  });

  it('remove propagates API error without mutating list', async () => {
    const a = makeOrg({ id: 'a' });
    useOrganizationsStore.setState({ list: [a] });
    vi.mocked(organizationsApi.delete).mockRejectedValue(new Error('delete failed'));

    await expect(
      useOrganizationsStore.getState().remove('a')
    ).rejects.toThrow('delete failed');

    expect(useOrganizationsStore.getState().list).toEqual([a]);
  });

  // --- reset ---

  it('reset restores initial state', () => {
    useOrganizationsStore.setState({
      list: [makeOrg()],
      current: makeOrg(),
      listLoaded: true,
      listLoading: true,
      currentLoaded: true,
      currentLoading: true,
      error: 'something',
    });

    useOrganizationsStore.getState().reset();

    expect(useOrganizationsStore.getState()).toMatchObject(INITIAL);
  });
});
