/**
 * @file serviceAccountsStore.ts
 * @description Zustand store for service accounts + token management (TASK-165).
 * @feature team
 */

import { create } from 'zustand';
import { errorMessage } from '@/shared/components/ui';
import { serviceAccountsApi } from '../api/serviceAccountsApi';
import type {
  ServiceAccount,
  CreateServiceAccountInput,
} from '../types/serviceAccount.types';

interface ServiceAccountsState {
  accounts: ServiceAccount[];
  loaded: boolean;
  loading: boolean;
  error: string | null;

  fetch: () => Promise<void>;
  create: (input: CreateServiceAccountInput) => Promise<ServiceAccount>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

export const useServiceAccountsStore = create<ServiceAccountsState>(
  (set, get) => ({
    accounts: [],
    loaded: false,
    loading: false,
    error: null,

    async fetch() {
      if (get().loading) return;
      set({ loading: true, error: null });
      try {
        const accounts = await serviceAccountsApi.list();
        set({ accounts, loaded: true, loading: false });
      } catch (err) {
        set({
          error: errorMessage(err, 'Failed to load service accounts'),
          loading: false,
        });
      }
    },

    async create(input) {
      set({ error: null });
      const account = await serviceAccountsApi.create(input);
      set((state) => ({ accounts: [account, ...state.accounts] }));
      return account;
    },

    async remove(id) {
      set({ error: null });
      await serviceAccountsApi.remove(id);
      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== id),
      }));
    },

    reset() {
      set({ accounts: [], loaded: false, loading: false, error: null });
    },
  })
);
