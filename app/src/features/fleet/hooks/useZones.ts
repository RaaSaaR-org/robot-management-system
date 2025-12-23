/**
 * @file useZones.ts
 * @description Hooks for zone management and zone editor functionality
 * @feature fleet
 * @dependencies @/features/fleet/store, @/features/fleet/types
 * @stateAccess useZoneStore (read/write)
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
  useZoneStore,
  selectZones,
  selectSelectedZone,
  selectCurrentFloor,
  selectIsLoading,
  selectError,
  selectEditorMode,
  selectIsEditing,
  selectEditingZone,
  selectDrawingBounds,
  selectShowFormModal,
  type ZoneEditorMode,
} from '../store/zoneStore';
import type { Zone, ZoneBounds, CreateZoneRequest, UpdateZoneRequest } from '../types/fleet.types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseZonesReturn {
  /** All zones */
  zones: Zone[];
  /** Zones for current floor */
  zonesForCurrentFloor: Zone[];
  /** Currently selected zone */
  selectedZone: Zone | null;
  /** Current floor */
  currentFloor: string;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Select a zone */
  selectZone: (id: string | null) => void;
  /** Change current floor */
  setCurrentFloor: (floor: string) => void;
  /** Refresh zones from server */
  refresh: () => Promise<void>;
}

export interface UseZoneManagementReturn {
  /** Create a new zone */
  createZone: (request: CreateZoneRequest) => Promise<Zone>;
  /** Update a zone */
  updateZone: (id: string, request: UpdateZoneRequest) => Promise<Zone | null>;
  /** Delete a zone */
  deleteZone: (id: string) => Promise<boolean>;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
}

export interface UseZoneEditorReturn {
  /** Current editor mode */
  editorMode: ZoneEditorMode;
  /** Whether in edit mode (draw or edit) */
  isEditing: boolean;
  /** Zone being edited */
  editingZone: Zone | null;
  /** Temporary drawing bounds */
  drawingBounds: ZoneBounds | null;
  /** Whether form modal is shown */
  showFormModal: boolean;
  /** Set editor mode */
  setEditorMode: (mode: ZoneEditorMode) => void;
  /** Start editing an existing zone */
  startEditingZone: (zone: Zone) => void;
  /** Start creating a new zone */
  startCreatingZone: () => void;
  /** Set drawing bounds */
  setDrawingBounds: (bounds: ZoneBounds | null) => void;
  /** Close form modal */
  closeFormModal: () => void;
  /** Exit edit mode */
  exitEditMode: () => void;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook for accessing and managing zones.
 *
 * @param autoFetch - Whether to automatically fetch zones on mount (default: true)
 *
 * @example
 * ```tsx
 * function ZoneList() {
 *   const { zones, zonesForCurrentFloor, selectedZone, selectZone } = useZones();
 *
 *   return (
 *     <ul>
 *       {zonesForCurrentFloor.map((zone) => (
 *         <li
 *           key={zone.id}
 *           onClick={() => selectZone(zone.id)}
 *           className={selectedZone?.id === zone.id ? 'selected' : ''}
 *         >
 *           {zone.name}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useZones(autoFetch = true): UseZonesReturn {
  const zones = useZoneStore(selectZones);
  const selectedZone = useZoneStore(selectSelectedZone);
  const currentFloor = useZoneStore(selectCurrentFloor);
  const isLoading = useZoneStore(selectIsLoading);
  const error = useZoneStore(selectError);

  const fetchZones = useZoneStore((state) => state.fetchZones);
  const selectZone = useZoneStore((state) => state.selectZone);
  const setCurrentFloor = useZoneStore((state) => state.setCurrentFloor);

  // Derive filtered zones with useMemo to prevent infinite loop
  // (selectors with .filter() create new array references each render)
  const zonesForCurrentFloor = useMemo(
    () => zones.filter((z) => z.floor === currentFloor),
    [zones, currentFloor]
  );

  // Fetch zones on mount if autoFetch is true
  useEffect(() => {
    if (autoFetch) {
      fetchZones();
    }
  }, [autoFetch, fetchZones]);

  const refresh = useCallback(async () => {
    await fetchZones();
  }, [fetchZones]);

  return {
    zones,
    zonesForCurrentFloor,
    selectedZone,
    currentFloor,
    isLoading,
    error,
    selectZone,
    setCurrentFloor,
    refresh,
  };
}

/**
 * Hook for zone CRUD operations.
 *
 * @example
 * ```tsx
 * function CreateZoneButton() {
 *   const { createZone, isLoading } = useZoneManagement();
 *
 *   const handleCreate = async () => {
 *     await createZone({
 *       name: 'New Zone',
 *       floor: '1',
 *       type: 'operational',
 *       bounds: { x: 0, y: 0, width: 10, height: 10 },
 *     });
 *   };
 *
 *   return (
 *     <button onClick={handleCreate} disabled={isLoading}>
 *       Create Zone
 *     </button>
 *   );
 * }
 * ```
 */
export function useZoneManagement(): UseZoneManagementReturn {
  const isLoading = useZoneStore(selectIsLoading);
  const error = useZoneStore(selectError);

  const createZoneAction = useZoneStore((state) => state.createZone);
  const updateZoneAction = useZoneStore((state) => state.updateZone);
  const deleteZoneAction = useZoneStore((state) => state.deleteZone);

  const createZone = useCallback(
    async (request: CreateZoneRequest): Promise<Zone> => {
      return createZoneAction(request);
    },
    [createZoneAction]
  );

  const updateZone = useCallback(
    async (id: string, request: UpdateZoneRequest): Promise<Zone | null> => {
      return updateZoneAction(id, request);
    },
    [updateZoneAction]
  );

  const deleteZone = useCallback(
    async (id: string): Promise<boolean> => {
      return deleteZoneAction(id);
    },
    [deleteZoneAction]
  );

  return {
    createZone,
    updateZone,
    deleteZone,
    isLoading,
    error,
  };
}

/**
 * Hook for zone editor functionality.
 *
 * @example
 * ```tsx
 * function ZoneEditor() {
 *   const {
 *     editorMode,
 *     isEditing,
 *     drawingBounds,
 *     setEditorMode,
 *     startCreatingZone,
 *     setDrawingBounds,
 *   } = useZoneEditor();
 *
 *   return (
 *     <div>
 *       <button onClick={() => setEditorMode('draw')}>Draw Mode</button>
 *       <button onClick={() => setEditorMode('view')}>View Mode</button>
 *       {isEditing && <span>Editing...</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useZoneEditor(): UseZoneEditorReturn {
  const editorMode = useZoneStore(selectEditorMode);
  const isEditing = useZoneStore(selectIsEditing);
  const editingZone = useZoneStore(selectEditingZone);
  const drawingBounds = useZoneStore(selectDrawingBounds);
  const showFormModal = useZoneStore(selectShowFormModal);

  const setEditorMode = useZoneStore((state) => state.setEditorMode);
  const startEditingZoneAction = useZoneStore((state) => state.startEditingZone);
  const startCreatingZoneAction = useZoneStore((state) => state.startCreatingZone);
  const setDrawingBoundsAction = useZoneStore((state) => state.setDrawingBounds);
  const closeFormModalAction = useZoneStore((state) => state.closeFormModal);

  const startEditingZone = useCallback(
    (zone: Zone) => {
      startEditingZoneAction(zone);
    },
    [startEditingZoneAction]
  );

  const startCreatingZone = useCallback(() => {
    startCreatingZoneAction();
  }, [startCreatingZoneAction]);

  const setDrawingBounds = useCallback(
    (bounds: ZoneBounds | null) => {
      setDrawingBoundsAction(bounds);
    },
    [setDrawingBoundsAction]
  );

  const closeFormModal = useCallback(() => {
    closeFormModalAction();
  }, [closeFormModalAction]);

  const exitEditMode = useCallback(() => {
    setEditorMode('view');
  }, [setEditorMode]);

  return {
    editorMode,
    isEditing,
    editingZone,
    drawingBounds,
    showFormModal,
    setEditorMode,
    startEditingZone,
    startCreatingZone,
    setDrawingBounds,
    closeFormModal,
    exitEditMode,
  };
}
