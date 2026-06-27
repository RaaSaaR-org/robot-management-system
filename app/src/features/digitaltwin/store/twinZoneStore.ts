/**
 * @file twinZoneStore.ts
 * @description Zustand store for a twin's L2 zones — fetch/create/update/delete
 *   against `/api/digital-twins/:id/zones`, plus the polygon-editor authoring
 *   state (mode, in-progress vertices, selection). Cloned from the fleet
 *   `zoneStore`, extended for multi-click polygon drawing in world meters.
 * @feature digitaltwin
 */

import { createStore } from '@/store';
import { twinZoneApi } from '../api/twinZoneApi';
import type {
  TwinZoneDTO,
  TwinPoint,
  CreateTwinZoneRequest,
  UpdateTwinZoneRequest,
} from '../types/twin.types';

/** Authoring mode for the polygon zone editor. */
export type TwinZoneEditorMode = 'view' | 'draw' | 'edit';

interface TwinZoneStore {
  /** The twin these zones belong to (set on fetch). */
  twinId: string | null;
  zones: TwinZoneDTO[];
  selectedZoneId: string | null;
  isLoading: boolean;
  error: string | null;

  /** Editor mode. */
  mode: TwinZoneEditorMode;
  /** Vertices of the polygon being drawn (world meters), in click order. */
  draftPoints: TwinPoint[];
  /** Zone being edited (drives the form modal). */
  editingZone: TwinZoneDTO | null;
  /** Whether the create/edit form modal is open. */
  showFormModal: boolean;
  /** Pending polygon awaiting name/type/color (after a draw is closed). */
  pendingPolygon: TwinPoint[] | null;

  // Queries
  fetchZones: (twinId: string) => Promise<void>;

  // CRUD
  createZone: (request: CreateTwinZoneRequest) => Promise<TwinZoneDTO | null>;
  updateZone: (zoneId: string, request: UpdateTwinZoneRequest) => Promise<TwinZoneDTO | null>;
  deleteZone: (zoneId: string) => Promise<boolean>;

  // Selection + editor
  selectZone: (id: string | null) => void;
  setMode: (mode: TwinZoneEditorMode) => void;
  addDraftPoint: (point: TwinPoint) => void;
  popDraftPoint: () => void;
  /** Finish a draw: stash the closed polygon and open the form. */
  closeDraft: () => void;
  cancelDraft: () => void;
  startEditingZone: (zone: TwinZoneDTO) => void;
  closeFormModal: () => void;

  // WebSocket handlers
  handleZoneCreated: (zone: TwinZoneDTO) => void;
  handleZoneUpdated: (zone: TwinZoneDTO) => void;
  handleZoneDeleted: (zoneId: string) => void;

  reset: () => void;
}

/** A polygon needs at least 3 vertices. */
const MIN_VERTICES = 3;

export const useTwinZoneStore = createStore<TwinZoneStore>(
  (set, get) => ({
    twinId: null,
    zones: [],
    selectedZoneId: null,
    isLoading: false,
    error: null,
    mode: 'view',
    draftPoints: [],
    editingZone: null,
    showFormModal: false,
    pendingPolygon: null,

    fetchZones: async (twinId) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
        state.twinId = twinId;
      });
      try {
        const zones = await twinZoneApi.getZones(twinId);
        set((state) => {
          state.zones = zones;
          state.isLoading = false;
        });
      } catch (e) {
        set((state) => {
          state.isLoading = false;
          state.error = e instanceof Error ? e.message : 'Failed to load zones';
        });
      }
    },

    createZone: async (request) => {
      const twinId = get().twinId;
      if (!twinId) return null;
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const zone = await twinZoneApi.createZone(twinId, request);
        set((state) => {
          if (!state.zones.some((z) => z.id === zone.id)) state.zones.push(zone);
          state.isLoading = false;
          state.showFormModal = false;
          state.pendingPolygon = null;
          state.draftPoints = [];
          state.editingZone = null;
          state.mode = 'view';
        });
        return zone;
      } catch (e) {
        set((state) => {
          state.isLoading = false;
          state.error = e instanceof Error ? e.message : 'Failed to create zone';
        });
        return null;
      }
    },

    updateZone: async (zoneId, request) => {
      const twinId = get().twinId;
      if (!twinId) return null;
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });
      try {
        const zone = await twinZoneApi.updateZone(twinId, zoneId, request);
        set((state) => {
          const idx = state.zones.findIndex((z) => z.id === zoneId);
          if (idx !== -1) state.zones[idx] = zone;
          state.isLoading = false;
          state.showFormModal = false;
          state.editingZone = null;
          state.mode = 'view';
        });
        return zone;
      } catch (e) {
        set((state) => {
          state.isLoading = false;
          state.error = e instanceof Error ? e.message : 'Failed to update zone';
        });
        return null;
      }
    },

    deleteZone: async (zoneId) => {
      const twinId = get().twinId;
      if (!twinId) return false;
      try {
        await twinZoneApi.deleteZone(twinId, zoneId);
        set((state) => {
          state.zones = state.zones.filter((z) => z.id !== zoneId);
          if (state.selectedZoneId === zoneId) state.selectedZoneId = null;
        });
        return true;
      } catch (e) {
        set((state) => {
          state.error = e instanceof Error ? e.message : 'Failed to delete zone';
        });
        return false;
      }
    },

    selectZone: (id) => set((state) => { state.selectedZoneId = id; }),

    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
        if (mode !== 'draw') state.draftPoints = [];
        if (mode === 'view') state.editingZone = null;
      }),

    addDraftPoint: (point) =>
      set((state) => {
        if (state.mode !== 'draw') state.mode = 'draw';
        state.draftPoints.push(point);
      }),

    popDraftPoint: () =>
      set((state) => {
        state.draftPoints.pop();
      }),

    closeDraft: () => {
      const pts = get().draftPoints;
      if (pts.length < MIN_VERTICES) return;
      set((state) => {
        state.pendingPolygon = [...state.draftPoints];
        state.draftPoints = [];
        state.editingZone = null;
        state.showFormModal = true;
      });
    },

    cancelDraft: () =>
      set((state) => {
        state.draftPoints = [];
        state.pendingPolygon = null;
      }),

    startEditingZone: (zone) =>
      set((state) => {
        state.editingZone = zone;
        state.pendingPolygon = null;
        state.showFormModal = true;
      }),

    closeFormModal: () =>
      set((state) => {
        state.showFormModal = false;
        state.editingZone = null;
        state.pendingPolygon = null;
      }),

    handleZoneCreated: (zone) =>
      set((state) => {
        if (state.twinId && zone.twinId !== state.twinId) return;
        if (!state.zones.some((z) => z.id === zone.id)) state.zones.push(zone);
      }),

    handleZoneUpdated: (zone) =>
      set((state) => {
        const idx = state.zones.findIndex((z) => z.id === zone.id);
        if (idx !== -1) state.zones[idx] = zone;
      }),

    handleZoneDeleted: (zoneId) =>
      set((state) => {
        state.zones = state.zones.filter((z) => z.id !== zoneId);
        if (state.selectedZoneId === zoneId) state.selectedZoneId = null;
      }),

    reset: () =>
      set((state) => {
        state.twinId = null;
        state.zones = [];
        state.selectedZoneId = null;
        state.isLoading = false;
        state.error = null;
        state.mode = 'view';
        state.draftPoints = [];
        state.editingZone = null;
        state.showFormModal = false;
        state.pendingPolygon = null;
      }),
  }),
  { name: 'TwinZoneStore', persist: false },
);

/** Default colors per zone type (used when no explicit color is set). */
export const TWIN_ZONE_COLORS: Record<string, string> = {
  keepout: '#ef4444',
  workcell: '#2A5FFF',
  charging: '#18E4C3',
  speed: '#f97316',
};

export const selectTwinZones = (state: TwinZoneStore): TwinZoneDTO[] => state.zones;
export const selectTwinZoneMode = (state: TwinZoneStore): TwinZoneEditorMode => state.mode;
export const selectTwinDraftPoints = (state: TwinZoneStore): TwinPoint[] => state.draftPoints;
