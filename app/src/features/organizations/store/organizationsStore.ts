/**
 * @file organizationsStore.ts
 * @description Zustand store for the Organizations feature — list + current
 * tenant with lazy fetch, deduped like `useFeaturesStore`. Optimistically
 * updates the list on create/delete so the UI stays snappy.
 * @feature organizations
 */

import { create } from 'zustand';
import { organizationsApi } from '../api/organizationsApi';
import type {
  Organization,
  CreateOrganizationInput,
} from '../types/organizations.types';

interface OrganizationsState {
  list: Organization[];
  current: Organization | null;
  listLoaded: boolean;
  listLoading: boolean;
  currentLoaded: boolean;
  currentLoading: boolean;
  error: string | null;

  fetchList: () => Promise<void>;
  fetchCurrent: () => Promise<void>;
  create: (input: CreateOrganizationInput) => Promise<Organization>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

export const useOrganizationsStore = create<OrganizationsState>((set, get) => ({
  list: [],
  current: null,
  listLoaded: false,
  listLoading: false,
  currentLoaded: false,
  currentLoading: false,
  error: null,

  async fetchList() {
    if (get().listLoading) return;
    set({ listLoading: true, error: null });
    try {
      const list = await organizationsApi.list();
      set({ list, listLoaded: true, listLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load organizations',
        listLoading: false,
      });
    }
  },

  async fetchCurrent() {
    if (get().currentLoading || get().currentLoaded) return;
    set({ currentLoading: true });
    try {
      const current = await organizationsApi.getCurrent();
      set({ current, currentLoaded: true, currentLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load current tenant',
        currentLoading: false,
      });
    }
  },

  async create(input) {
    set({ error: null });
    const created = await organizationsApi.create(input);
    set((state) => ({ list: [...state.list, created] }));
    return created;
  },

  async remove(id) {
    set({ error: null });
    await organizationsApi.delete(id);
    set((state) => ({ list: state.list.filter((o) => o.id !== id) }));
  },

  reset() {
    set({
      list: [],
      current: null,
      listLoaded: false,
      listLoading: false,
      currentLoaded: false,
      currentLoading: false,
      error: null,
    });
  },
}));
