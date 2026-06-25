/**
 * @file twinStore.ts
 * @description Zustand store for digital-twin sites, backed by server
 *   `DigitalTwin` rows (no longer localStorage). Holds only small site/DTO
 *   metadata — the heavy accumulated point cloud lives in component state inside
 *   useScanSession, never in this immer store (immer cannot draft a
 *   Float32Array).
 * @feature digitaltwin
 */

import { createStore } from '@/store';
import { twinApi } from '../api/twinApi';
import type { DigitalTwinDTO, Site } from '../types/twin.types';
import { twinToSite } from '../types/twin.types';

interface TwinStore {
  /** Server twins (system of record). */
  twins: DigitalTwinDTO[];
  isLoading: boolean;
  error: string | null;

  fetchTwins: () => Promise<void>;
  createTwin: (body: { name: string; robotId?: string; floor?: string }) => Promise<DigitalTwinDTO>;
  removeTwin: (id: string) => Promise<void>;
  /** Replace/insert a single twin (e.g. from a `twin:ready` event or a fetch). */
  upsertTwin: (twin: DigitalTwinDTO) => void;
}

export const useTwinStore = createStore<TwinStore>(
  (set) => ({
    twins: [],
    isLoading: false,
    error: null,

    fetchTwins: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const twins = await twinApi.listTwins();
        set((state) => {
          state.twins = twins;
          state.isLoading = false;
        });
      } catch (e) {
        set((state) => {
          state.isLoading = false;
          state.error = e instanceof Error ? e.message : 'Failed to load twins';
        });
      }
    },

    createTwin: async (body) => {
      const twin = await twinApi.createTwin(body);
      set((state) => {
        state.twins.unshift(twin);
      });
      return twin;
    },

    removeTwin: async (id) => {
      await twinApi.deleteTwin(id);
      set((state) => {
        state.twins = state.twins.filter((t) => t.id !== id);
      });
    },

    upsertTwin: (twin) => {
      set((state) => {
        const idx = state.twins.findIndex((t) => t.id === twin.id);
        if (idx === -1) state.twins.unshift(twin);
        else state.twins[idx] = twin;
      });
    },
  }),
  // No persistence: the server is the source of truth now.
  { name: 'TwinStore', persist: false },
);

/** Server twins. */
export const selectTwins = (state: TwinStore): DigitalTwinDTO[] => state.twins;

/** Server twins mapped to the gallery `Site` view model. */
export function selectSites(state: TwinStore): Site[] {
  return state.twins.map(twinToSite);
}
