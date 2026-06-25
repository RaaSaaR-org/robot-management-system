/**
 * @file index.ts
 * @description Public exports for the digital-twin feature.
 * @feature digitaltwin
 */

export { SitesGalleryPage } from './pages/SitesGalleryPage';
export { TwinViewerPage } from './pages/TwinViewerPage';
export { TwinViewer } from './components/TwinViewer';
export { TwinBackdrop } from './components/TwinBackdrop';
export type { TwinBackdropKind } from './components/TwinBackdrop';
export { ZoneVolumes } from './components/ZoneVolumes';
export { ZoneAuthoringOverlay } from './components/ZoneAuthoringOverlay';
export { ZoneLegend } from './components/ZoneLegend';
export { TwinLifecycleStepper } from './components/TwinLifecycleStepper';
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
