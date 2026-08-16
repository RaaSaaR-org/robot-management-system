/**
 * @file index.ts
 * @description Barrel export for patrol components
 * @feature patrol
 */

export { FindingBadge, RunStatusChip, LegStatusChip, FindingStatusChip } from './FindingBadge';
export { RouteList } from './RouteList';
export { RouteEditor, moveCheckpoint, draftToInput, validateDraft } from './RouteEditor';
export type { RouteEditorProps, RouteEditorRobot } from './RouteEditor';
export { RunHistory } from './RunHistory';
export { RunDetail } from './RunDetail';
export { PhotoPair } from './PhotoPair';
export { RouteOverlay, overlayMarkers } from './RouteOverlay';
export type { RouteOverlayProps, Projector } from './RouteOverlay';
export { ActiveRunBanner } from './ActiveRunBanner';
export {
  PATROL_MOTION,
  PATROL_FADE_IN,
  PATROL_FOCUS,
  PATROL_PANEL,
  PATROL_INSET,
  PATROL_INSET_HOVER,
  PATROL_MICRO,
  PATROL_MONO,
  PATROL_KPI_VALUE,
  PATROL_GLOW_LIVE,
  PATROL_LIVE_BORDER,
  PATROL_ATTENTION_TEXT,
  PATROL_STICKY_RAIL,
  SEVERITY_RAIL,
  RUN_STATUS_DOT,
  LEG_NODE,
  OVERLAY_COLOR,
  StatusDot,
  KpiTile,
  SectionHeader,
  RoutePath,
} from './patrolUi';
export type { PatrolTone, StatusDotProps, KpiTileProps, SectionHeaderProps, RoutePathLeg, RoutePathProps } from './patrolUi';
