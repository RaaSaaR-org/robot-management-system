/**
 * @file simulationStore.ts
 * @description Zustand store for the sim-scene registry — built-in environments
 *   and twin-derived rooms, plus the currently selected scene for the Launch tab.
 * @feature simulation
 */

import { createStore } from '@/store';
import { simulationApi } from '../api/simulationApi';
import type { SimScene } from '../types';

interface SimulationStore {
  scenes: SimScene[];
  scenesLoading: boolean;
  scenesError: string | null;
  selectedSceneId: string | null;

  fetchScenes: () => Promise<void>;
  selectScene: (id: string | null) => void;
  reset: () => void;
}

export const useSimulationStore = createStore<SimulationStore>(
  (set) => ({
    scenes: [],
    scenesLoading: false,
    scenesError: null,
    selectedSceneId: null,

    fetchScenes: async () => {
      set((state) => {
        state.scenesLoading = true;
        state.scenesError = null;
      });
      try {
        const scenes = await simulationApi.getScenes();
        set((state) => {
          state.scenes = scenes;
          state.scenesLoading = false;
        });
      } catch (e) {
        set((state) => {
          state.scenesLoading = false;
          state.scenesError = e instanceof Error ? e.message : 'Failed to load scenes';
        });
      }
    },

    selectScene: (id) => {
      set((state) => {
        state.selectedSceneId = id;
      });
    },

    reset: () => {
      set((state) => {
        state.scenes = [];
        state.scenesLoading = false;
        state.scenesError = null;
        state.selectedSceneId = null;
      });
    },
  }),
  { name: 'SimulationStore', persist: false },
);

/** All registry scenes (built-ins + twin rooms). */
export const selectScenes = (state: SimulationStore): SimScene[] => state.scenes;

/** True while scenes are being fetched. */
export const selectScenesLoading = (state: SimulationStore): boolean => state.scenesLoading;

/** Last fetch error, if any. */
export const selectScenesError = (state: SimulationStore): string | null => state.scenesError;

/** The currently selected scene id (Launch tab). */
export const selectSelectedSceneId = (state: SimulationStore): string | null =>
  state.selectedSceneId;
