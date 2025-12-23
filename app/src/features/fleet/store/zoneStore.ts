/**
 * @file zoneStore.ts
 * @description Zustand store for zone management with API integration
 * @feature fleet
 * @dependencies zustand, immer, @/features/fleet/types, @/features/fleet/api
 * @stateAccess useZoneStore (read/write)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type {
  Zone,
  ZoneType,
  ZoneBounds,
  CreateZoneRequest,
  UpdateZoneRequest,
  ZoneEditorMode,
} from '../types/fleet.types';
import { zoneApi } from '../api/zoneApi';

// ============================================================================
// TYPES
// ============================================================================

// Re-export ZoneEditorMode for convenience (imported from fleet.types)
export type { ZoneEditorMode };

/** Zone store state */
export interface ZoneState {
  /** All zones */
  zones: Zone[];
  /** Currently selected zone ID */
  selectedZoneId: string | null;
  /** Current floor filter */
  currentFloor: string;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;

  /** Editor mode */
  editorMode: ZoneEditorMode;
  /** Zone being edited (for modal) */
  editingZone: Zone | null;
  /** Temporary bounds while drawing */
  drawingBounds: ZoneBounds | null;
  /** Show zone form modal */
  showFormModal: boolean;
}

/** Zone store actions */
export interface ZoneActions {
  // Query actions
  fetchZones: () => Promise<void>;
  fetchZonesByFloor: (floor: string) => Promise<void>;

  // Selection actions
  selectZone: (id: string | null) => void;
  setCurrentFloor: (floor: string) => void;

  // CRUD actions
  createZone: (request: CreateZoneRequest) => Promise<Zone>;
  updateZone: (id: string, request: UpdateZoneRequest) => Promise<Zone | null>;
  deleteZone: (id: string) => Promise<boolean>;

  // Editor actions
  setEditorMode: (mode: ZoneEditorMode) => void;
  startEditingZone: (zone: Zone) => void;
  startCreatingZone: () => void;
  setDrawingBounds: (bounds: ZoneBounds | null) => void;
  closeFormModal: () => void;

  // WebSocket event handlers
  handleZoneCreated: (zone: Zone) => void;
  handleZoneUpdated: (zone: Zone) => void;
  handleZoneDeleted: (zone: Zone) => void;

  // Reset
  reset: () => void;
}

export type ZoneStore = ZoneState & ZoneActions;

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: ZoneState = {
  zones: [],
  selectedZoneId: null,
  currentFloor: '1',
  isLoading: false,
  error: null,

  editorMode: 'view',
  editingZone: null,
  drawingBounds: null,
  showFormModal: false,
};

// ============================================================================
// STORE
// ============================================================================

export const useZoneStore = create<ZoneStore>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // --------------------------------------------------------------------
      // QUERY ACTIONS
      // --------------------------------------------------------------------

      fetchZones: async (): Promise<void> => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const result = await zoneApi.getZones();
          set((state) => {
            state.zones = result.data;
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to fetch zones';
          });
        }
      },

      fetchZonesByFloor: async (floor: string): Promise<void> => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
          state.currentFloor = floor;
        });

        try {
          const zones = await zoneApi.getZonesByFloor(floor);
          set((state) => {
            // Update only zones for this floor, keep others
            const otherZones = state.zones.filter((z) => z.floor !== floor);
            state.zones = [...otherZones, ...zones];
            state.isLoading = false;
          });
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to fetch zones';
          });
        }
      },

      // --------------------------------------------------------------------
      // SELECTION ACTIONS
      // --------------------------------------------------------------------

      selectZone: (id: string | null): void => {
        set((state) => {
          state.selectedZoneId = id;
        });
      },

      setCurrentFloor: (floor: string): void => {
        set((state) => {
          state.currentFloor = floor;
        });
        // Fetch zones for the new floor
        get().fetchZonesByFloor(floor);
      },

      // --------------------------------------------------------------------
      // CRUD ACTIONS
      // --------------------------------------------------------------------

      createZone: async (request: CreateZoneRequest): Promise<Zone> => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const zone = await zoneApi.createZone(request);
          set((state) => {
            state.zones.push(zone);
            state.isLoading = false;
            state.showFormModal = false;
            state.editingZone = null;
            state.drawingBounds = null;
            state.editorMode = 'view';
          });
          return zone;
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to create zone';
          });
          throw error;
        }
      },

      updateZone: async (id: string, request: UpdateZoneRequest): Promise<Zone | null> => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          const zone = await zoneApi.updateZone(id, request);
          set((state) => {
            const index = state.zones.findIndex((z) => z.id === id);
            if (index !== -1) {
              state.zones[index] = zone;
            }
            state.isLoading = false;
            state.showFormModal = false;
            state.editingZone = null;
            state.editorMode = 'view';
          });
          return zone;
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to update zone';
          });
          throw error;
        }
      },

      deleteZone: async (id: string): Promise<boolean> => {
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });

        try {
          await zoneApi.deleteZone(id);
          set((state) => {
            state.zones = state.zones.filter((z) => z.id !== id);
            state.isLoading = false;
            if (state.selectedZoneId === id) {
              state.selectedZoneId = null;
            }
            state.editorMode = 'view';
          });
          return true;
        } catch (error) {
          set((state) => {
            state.isLoading = false;
            state.error = error instanceof Error ? error.message : 'Failed to delete zone';
          });
          return false;
        }
      },

      // --------------------------------------------------------------------
      // EDITOR ACTIONS
      // --------------------------------------------------------------------

      setEditorMode: (mode: ZoneEditorMode): void => {
        set((state) => {
          state.editorMode = mode;
          if (mode === 'view') {
            state.drawingBounds = null;
            state.editingZone = null;
          }
        });
      },

      startEditingZone: (zone: Zone): void => {
        set((state) => {
          state.editingZone = zone;
          state.showFormModal = true;
          state.editorMode = 'edit';
        });
      },

      startCreatingZone: (): void => {
        set((state) => {
          state.editingZone = null;
          state.showFormModal = true;
          state.editorMode = 'draw';
        });
      },

      setDrawingBounds: (bounds: ZoneBounds | null): void => {
        set((state) => {
          state.drawingBounds = bounds;
        });
      },

      closeFormModal: (): void => {
        set((state) => {
          state.showFormModal = false;
          state.editingZone = null;
          state.drawingBounds = null;
          state.editorMode = 'view';
        });
      },

      // --------------------------------------------------------------------
      // WEBSOCKET EVENT HANDLERS
      // --------------------------------------------------------------------

      handleZoneCreated: (zone: Zone): void => {
        set((state) => {
          const exists = state.zones.some((z) => z.id === zone.id);
          if (!exists) {
            state.zones.push(zone);
          }
        });
      },

      handleZoneUpdated: (zone: Zone): void => {
        set((state) => {
          const index = state.zones.findIndex((z) => z.id === zone.id);
          if (index !== -1) {
            state.zones[index] = zone;
          }
        });
      },

      handleZoneDeleted: (zone: Zone): void => {
        set((state) => {
          state.zones = state.zones.filter((z) => z.id !== zone.id);
          if (state.selectedZoneId === zone.id) {
            state.selectedZoneId = null;
          }
        });
      },

      // --------------------------------------------------------------------
      // RESET
      // --------------------------------------------------------------------

      reset: (): void => {
        set(initialState);
      },
    })),
    { name: 'zone-store' }
  )
);

// ============================================================================
// SELECTORS
// ============================================================================

/** Select all zones */
export const selectZones = (state: ZoneStore): Zone[] => state.zones;

/** Select zones for current floor */
export const selectZonesForCurrentFloor = (state: ZoneStore): Zone[] =>
  state.zones.filter((z) => z.floor === state.currentFloor);

/** Select zones by floor */
export const selectZonesByFloor =
  (floor: string) =>
  (state: ZoneStore): Zone[] =>
    state.zones.filter((z) => z.floor === floor);

/** Select zones by type */
export const selectZonesByType =
  (type: ZoneType) =>
  (state: ZoneStore): Zone[] =>
    state.zones.filter((z) => z.type === type);

/** Select selected zone */
export const selectSelectedZone = (state: ZoneStore): Zone | null => {
  if (!state.selectedZoneId) return null;
  return state.zones.find((z) => z.id === state.selectedZoneId) ?? null;
};

/** Select zone by ID */
export const selectZoneById =
  (id: string) =>
  (state: ZoneStore): Zone | undefined =>
    state.zones.find((z) => z.id === id);

/** Select current floor */
export const selectCurrentFloor = (state: ZoneStore): string => state.currentFloor;

/** Select loading state */
export const selectIsLoading = (state: ZoneStore): boolean => state.isLoading;

/** Select error state */
export const selectError = (state: ZoneStore): string | null => state.error;

/** Select editor mode */
export const selectEditorMode = (state: ZoneStore): ZoneEditorMode => state.editorMode;

/** Select if in edit mode */
export const selectIsEditing = (state: ZoneStore): boolean =>
  state.editorMode === 'draw' || state.editorMode === 'edit';

/** Select editing zone */
export const selectEditingZone = (state: ZoneStore): Zone | null => state.editingZone;

/** Select drawing bounds */
export const selectDrawingBounds = (state: ZoneStore): ZoneBounds | null => state.drawingBounds;

/** Select show form modal */
export const selectShowFormModal = (state: ZoneStore): boolean => state.showFormModal;

/** Select restricted zones */
export const selectRestrictedZones = (state: ZoneStore): Zone[] =>
  state.zones.filter((z) => z.type === 'restricted');

/** Select charging zones */
export const selectChargingZones = (state: ZoneStore): Zone[] =>
  state.zones.filter((z) => z.type === 'charging');
