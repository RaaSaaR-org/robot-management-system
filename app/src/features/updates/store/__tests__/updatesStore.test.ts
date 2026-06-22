/**
 * @file updatesStore.test.ts
 * @description Tests for the updates (OTA) Zustand store
 * @feature updates
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useUpdatesStore,
  selectPackages,
  selectDeployments,
  selectIsLoading,
  selectError,
  selectPendingPackages,
  selectApprovedPackages,
} from '../updatesStore';
import type { UpdatePackage, UpdateDeployment } from '../../types/updates.types';

vi.mock('../../api/updatesApi', () => ({
  updatesApi: {
    getPackages: vi.fn(),
    getPackage: vi.fn(),
    createPackage: vi.fn(),
    approvePackage: vi.fn(),
    deployToRobot: vi.fn(),
    triggerRollback: vi.fn(),
    getDeployments: vi.fn(),
  },
}));

import { updatesApi } from '../../api/updatesApi';

const makePackage = (overrides: Partial<UpdatePackage> = {}): UpdatePackage => ({
  id: 'pkg-1',
  version: '1.0.0',
  changelog: 'Initial',
  signature: 'sig',
  publicKey: 'key',
  checksum: 'sum',
  fileSize: 100,
  status: 'pending',
  approvedBy: null,
  approvedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makeDeployment = (overrides: Partial<UpdateDeployment> = {}): UpdateDeployment => ({
  id: 'dep-1',
  packageId: 'pkg-1',
  robotId: 'robot-1',
  status: 'pending',
  previousVersion: null,
  deployedAt: null,
  rolledBackAt: null,
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('updatesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdatesStore.setState({
      packages: [],
      deployments: [],
      isLoading: false,
      error: null,
    });
  });

  it('starts with initial state', () => {
    const state = useUpdatesStore.getState();
    expect(state.packages).toEqual([]);
    expect(state.deployments).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('fetchPackages', () => {
    it('loads packages and clears loading on success', async () => {
      const pkgs = [makePackage(), makePackage({ id: 'pkg-2' })];
      vi.mocked(updatesApi.getPackages).mockResolvedValue(pkgs);

      await useUpdatesStore.getState().fetchPackages();

      const state = useUpdatesStore.getState();
      expect(state.packages).toEqual(pkgs);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(updatesApi.getPackages).toHaveBeenCalledWith(undefined);
    });

    it('forwards the status filter to the api', async () => {
      vi.mocked(updatesApi.getPackages).mockResolvedValue([]);

      await useUpdatesStore.getState().fetchPackages('approved');

      expect(updatesApi.getPackages).toHaveBeenCalledWith('approved');
    });

    it('sets isLoading true while in-flight', async () => {
      let resolve!: (v: UpdatePackage[]) => void;
      vi.mocked(updatesApi.getPackages).mockReturnValue(
        new Promise<UpdatePackage[]>((r) => {
          resolve = r;
        })
      );

      const promise = useUpdatesStore.getState().fetchPackages();
      expect(useUpdatesStore.getState().isLoading).toBe(true);

      resolve([]);
      await promise;
      expect(useUpdatesStore.getState().isLoading).toBe(false);
    });

    it('captures error message and clears loading on failure', async () => {
      vi.mocked(updatesApi.getPackages).mockRejectedValue(new Error('boom'));

      await useUpdatesStore.getState().fetchPackages();

      const state = useUpdatesStore.getState();
      expect(state.error).toBe('boom');
      expect(state.isLoading).toBe(false);
      expect(state.packages).toEqual([]);
    });

    it('uses fallback message for non-Error rejections', async () => {
      vi.mocked(updatesApi.getPackages).mockRejectedValue('string failure');

      await useUpdatesStore.getState().fetchPackages();

      expect(useUpdatesStore.getState().error).toBe('Failed to fetch packages');
    });
  });

  describe('createPackage', () => {
    it('prepends the created package on success', async () => {
      const existing = makePackage({ id: 'old' });
      useUpdatesStore.setState({ packages: [existing] });
      const created = makePackage({ id: 'new' });
      vi.mocked(updatesApi.createPackage).mockResolvedValue(created);

      await useUpdatesStore.getState().createPackage({ version: '2.0.0', changelog: 'x' });

      const state = useUpdatesStore.getState();
      expect(state.packages).toEqual([created, existing]);
      expect(state.isLoading).toBe(false);
    });

    it('records error and leaves packages untouched on failure', async () => {
      const existing = makePackage({ id: 'old' });
      useUpdatesStore.setState({ packages: [existing] });
      vi.mocked(updatesApi.createPackage).mockRejectedValue(new Error('create fail'));

      await useUpdatesStore.getState().createPackage({ version: '2.0.0', changelog: 'x' });

      const state = useUpdatesStore.getState();
      expect(state.error).toBe('create fail');
      expect(state.isLoading).toBe(false);
      expect(state.packages).toEqual([existing]);
    });
  });

  describe('approvePackage', () => {
    it('replaces the matching package with the updated one', async () => {
      const original = makePackage({ id: 'pkg-1', status: 'pending' });
      const other = makePackage({ id: 'pkg-2' });
      useUpdatesStore.setState({ packages: [original, other] });
      const approved = makePackage({ id: 'pkg-1', status: 'approved', approvedBy: 'u1' });
      vi.mocked(updatesApi.approvePackage).mockResolvedValue(approved);

      await useUpdatesStore.getState().approvePackage('pkg-1', 'u1');

      const state = useUpdatesStore.getState();
      expect(state.packages[0]).toEqual(approved);
      expect(state.packages[1]).toEqual(other);
      expect(updatesApi.approvePackage).toHaveBeenCalledWith('pkg-1', 'u1');
    });

    it('does nothing to the list when the id is not found', async () => {
      const original = makePackage({ id: 'pkg-1' });
      useUpdatesStore.setState({ packages: [original] });
      vi.mocked(updatesApi.approvePackage).mockResolvedValue(
        makePackage({ id: 'missing', status: 'approved' })
      );

      await useUpdatesStore.getState().approvePackage('missing', 'u1');

      expect(useUpdatesStore.getState().packages).toEqual([original]);
    });

    it('sets error on failure', async () => {
      vi.mocked(updatesApi.approvePackage).mockRejectedValue(new Error('approve fail'));

      await useUpdatesStore.getState().approvePackage('pkg-1', 'u1');

      expect(useUpdatesStore.getState().error).toBe('approve fail');
    });
  });

  describe('deployPackage', () => {
    it('prepends the new deployment and passes previousVersion through', async () => {
      const existing = makeDeployment({ id: 'old-dep' });
      useUpdatesStore.setState({ deployments: [existing] });
      const deployment = makeDeployment({ id: 'new-dep' });
      vi.mocked(updatesApi.deployToRobot).mockResolvedValue(deployment);

      await useUpdatesStore.getState().deployPackage('pkg-1', 'robot-1', '0.9.0');

      const state = useUpdatesStore.getState();
      expect(state.deployments).toEqual([deployment, existing]);
      expect(updatesApi.deployToRobot).toHaveBeenCalledWith('pkg-1', 'robot-1', {
        previousVersion: '0.9.0',
      });
    });

    it('sets error on failure', async () => {
      vi.mocked(updatesApi.deployToRobot).mockRejectedValue(new Error('deploy fail'));

      await useUpdatesStore.getState().deployPackage('pkg-1', 'robot-1');

      expect(useUpdatesStore.getState().error).toBe('deploy fail');
      expect(useUpdatesStore.getState().deployments).toEqual([]);
    });
  });

  describe('triggerRollback', () => {
    it('prepends the rollback deployment and forwards target version', async () => {
      const deployment = makeDeployment({ id: 'rb', status: 'rolled_back' });
      vi.mocked(updatesApi.triggerRollback).mockResolvedValue(deployment);

      await useUpdatesStore.getState().triggerRollback('pkg-1', 'robot-1', '0.8.0');

      const state = useUpdatesStore.getState();
      expect(state.deployments[0]).toEqual(deployment);
      expect(updatesApi.triggerRollback).toHaveBeenCalledWith('pkg-1', 'robot-1', {
        targetVersion: '0.8.0',
      });
    });

    it('sets error on failure', async () => {
      vi.mocked(updatesApi.triggerRollback).mockRejectedValue(new Error('rollback fail'));

      await useUpdatesStore.getState().triggerRollback('pkg-1', 'robot-1', '0.8.0');

      expect(useUpdatesStore.getState().error).toBe('rollback fail');
    });
  });

  describe('fetchDeployments', () => {
    it('replaces deployments and clears loading on success', async () => {
      const deployments = [makeDeployment(), makeDeployment({ id: 'dep-2' })];
      vi.mocked(updatesApi.getDeployments).mockResolvedValue(deployments);

      await useUpdatesStore.getState().fetchDeployments('robot-1');

      const state = useUpdatesStore.getState();
      expect(state.deployments).toEqual(deployments);
      expect(state.isLoading).toBe(false);
      expect(updatesApi.getDeployments).toHaveBeenCalledWith('robot-1');
    });

    it('captures error and clears loading on failure', async () => {
      vi.mocked(updatesApi.getDeployments).mockRejectedValue(new Error('fetch dep fail'));

      await useUpdatesStore.getState().fetchDeployments('robot-1');

      const state = useUpdatesStore.getState();
      expect(state.error).toBe('fetch dep fail');
      expect(state.isLoading).toBe(false);
    });
  });

  describe('reset', () => {
    it('returns the store to initial state', () => {
      useUpdatesStore.setState({
        packages: [makePackage()],
        deployments: [makeDeployment()],
        isLoading: true,
        error: 'oops',
      });

      useUpdatesStore.getState().reset();

      const state = useUpdatesStore.getState();
      expect(state.packages).toEqual([]);
      expect(state.deployments).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('selectors', () => {
    it('selectPackages / selectDeployments / selectIsLoading / selectError read state', () => {
      const pkg = makePackage();
      const dep = makeDeployment();
      useUpdatesStore.setState({
        packages: [pkg],
        deployments: [dep],
        isLoading: true,
        error: 'err',
      });
      const state = useUpdatesStore.getState();

      expect(selectPackages(state)).toEqual([pkg]);
      expect(selectDeployments(state)).toEqual([dep]);
      expect(selectIsLoading(state)).toBe(true);
      expect(selectError(state)).toBe('err');
    });

    it('selectPendingPackages filters by pending status', () => {
      useUpdatesStore.setState({
        packages: [
          makePackage({ id: 'a', status: 'pending' }),
          makePackage({ id: 'b', status: 'approved' }),
          makePackage({ id: 'c', status: 'pending' }),
        ],
      });
      const result = selectPendingPackages(useUpdatesStore.getState());
      expect(result.map((p) => p.id)).toEqual(['a', 'c']);
    });

    it('selectApprovedPackages filters by approved status', () => {
      useUpdatesStore.setState({
        packages: [
          makePackage({ id: 'a', status: 'pending' }),
          makePackage({ id: 'b', status: 'approved' }),
          makePackage({ id: 'c', status: 'deployed' }),
        ],
      });
      const result = selectApprovedPackages(useUpdatesStore.getState());
      expect(result.map((p) => p.id)).toEqual(['b']);
    });
  });
});
