/**
 * @file index.ts
 * @description Barrel export for patrol components
 * @feature patrol
 */

export { FindingBadge, RunStatusChip, LegStatusChip, FindingStatusChip } from './FindingBadge';
export { RouteList } from './RouteList';
export type { RouteListProps } from './RouteList';
export { RouteEditor, moveCheckpoint, draftToInput, validateDraft, windowSegments } from './RouteEditor';
export type { RouteEditorProps, RouteEditorRobot } from './RouteEditor';
export { CheckpointCard } from './CheckpointCard';
export { WindowBar } from './WindowBar';
export { RunHistory } from './RunHistory';
export type { RunHistoryProps } from './RunHistory';
export { RunStartModal } from './RunStartModal';
export type { RunStartModalProps } from './RunStartModal';
export { RunDetail } from './RunDetail';
export { PhotoPair } from './PhotoPair';
export { RouteOverlay, overlayMarkers } from './RouteOverlay';
export type { RouteOverlayProps, Projector } from './RouteOverlay';
export { ActiveRunBanner } from './ActiveRunBanner';
export {
  ArmedTag,
  LiveTag,
  RoutePath,
  RunStatusTag,
  formatDuration,
  formatElapsed,
  formatRelative,
  formatStarted,
  runDurationMs,
} from './opsUi';
export type { RoutePathLeg, RoutePathProps, RoutePathStatus } from './opsUi';
