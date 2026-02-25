/**
 * @file updatesStore.ts
 * @description Zustand store for secure OTA update management
 * @feature updates
 */

import { create } from 'zustand';
import { devtools, } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { updatesApi } from '../api/updatesApi';
import type {
  UpdatesStore,
  UpdatesState,
  UpdatePackageStatus,
  CreateUpdateRequest,
} from '../types/updates.types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: UpdatesState = {
  packages: [],
  deployments: [],
  isLoading: false,
  error: null,
};

// ============================================================================
// STORE
// ============================================================================

export const useUpdatesStore = create<UpdatesStore>()(
  devtools(
    immer((set) => ({
      ...initialState,

      fetchPackages: async (status?: UpdatePackageStatus) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const packages = await updatesApi.getPackages(status);
          set((state) => {
            state.packages = packages;
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to fetch packages';
            state.isLoading = false;
          });
        }
      },

      createPackage: async (input: CreateUpdateRequest) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const pkg = await updatesApi.createPackage(input);
          set((state) => {
            state.packages.unshift(pkg);
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to create package';
            state.isLoading = false;
          });
        }
      },

      approvePackage: async (id: string, approverId: string) => {
        try {
          const updated = await updatesApi.approvePackage(id, approverId);
          set((state) => {
            const idx = state.packages.findIndex((p) => p.id === id);
            if (idx !== -1) {
              state.packages[idx] = updated;
            }
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to approve package';
          });
        }
      },

      deployPackage: async (packageId: string, robotId: string, previousVersion?: string) => {
        try {
          const deployment = await updatesApi.deployToRobot(packageId, robotId, { previousVersion });
          set((state) => {
            state.deployments.unshift(deployment);
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to deploy package';
          });
        }
      },

      triggerRollback: async (packageId: string, robotId: string, targetVersion: string) => {
        try {
          const deployment = await updatesApi.triggerRollback(packageId, robotId, { targetVersion });
          set((state) => {
            state.deployments.unshift(deployment);
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to trigger rollback';
          });
        }
      },

      fetchDeployments: async (robotId: string) => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        try {
          const deployments = await updatesApi.getDeployments(robotId);
          set((state) => {
            state.deployments = deployments;
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.error = error instanceof Error ? error.message : 'Failed to fetch deployments';
            state.isLoading = false;
          });
        }
      },

      reset: () => {
        set(initialState);
      },
    })),
    { name: 'updates-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectPackages = (state: UpdatesStore) => state.packages;
export const selectDeployments = (state: UpdatesStore) => state.deployments;
export const selectIsLoading = (state: UpdatesStore) => state.isLoading;
export const selectError = (state: UpdatesStore) => state.error;
export const selectPendingPackages = (state: UpdatesStore) =>
  state.packages.filter((p) => p.status === 'pending');
export const selectApprovedPackages = (state: UpdatesStore) =>
  state.packages.filter((p) => p.status === 'approved');
