/**
 * @file index.ts
 * @description Barrel export for fleet stores
 * @feature fleet
 */

export {
  useZoneStore,
  selectZones,
  selectZonesForCurrentFloor,
  selectZonesByFloor,
  selectZonesByType,
  selectSelectedZone,
  selectZoneById,
  selectCurrentFloor,
  selectIsLoading,
  selectError,
  selectEditorMode,
  selectIsEditing,
  selectEditingZone,
  selectDrawingBounds,
  selectShowFormModal,
  selectRestrictedZones,
  selectChargingZones,
} from './zoneStore';
export type { ZoneState, ZoneActions, ZoneStore } from './zoneStore';
// ZoneEditorMode is exported from types/fleet.types.ts
