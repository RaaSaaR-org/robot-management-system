/**
 * @file index.ts
 * @description Public exports for the digital-twin feature.
 * @feature digitaltwin
 */

export { TwinViewerPage } from './pages/TwinViewerPage';
// The gallery is a tab of FleetPage now (TASK-276), so it is a component, not
// a page. FleetPage imports it by path — this barrel pulls in three.js.
export { SitesGallery } from './components/SitesGallery';
export type { SitesGalleryProps } from './components/SitesGallery';
export { TwinViewer } from './components/TwinViewer';
export { TwinBackdrop } from './components/TwinBackdrop';
export type { TwinBackdropKind } from './components/TwinBackdrop';
export { ZoneVolumes } from './components/ZoneVolumes';
export { ZoneAuthoringOverlay } from './components/ZoneAuthoringOverlay';
export { ZoneLegend } from './components/ZoneLegend';
export { TwinZoneFormModal } from './components/TwinZoneFormModal';
export { ExportPanel } from './components/ExportPanel';
export { useOccupancyImage } from './utils/occupancy';
export { useScanSession } from './hooks/useScanSession';
export { useScanCapableRobots } from './hooks/useScanCapableRobots';
export { useTwinEvents } from './hooks/useTwinEvents';
export { twinApi } from './api/twinApi';
export { twinZoneApi } from './api/twinZoneApi';
export { useTwinStore, selectTwins, selectSites } from './store/twinStore';
export { useTwinZoneStore, selectTwinZones, TWIN_ZONE_COLORS } from './store/twinZoneStore';
export type {
  Site,
  ScanStatus,
  TwinPose,
  AccumulatedCloud,
  DigitalTwinDTO,
  ScanSessionDTO,
  TwinZoneDTO,
  TwinZoneType,
  TwinStatus,
  SessionStatus,
} from './types/twin.types';
