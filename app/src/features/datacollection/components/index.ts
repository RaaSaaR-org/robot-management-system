/**
 * @file index.ts
 * @description Barrel export for data collection components
 * @feature datacollection
 */

export { SessionStatusBadge } from './SessionStatusBadge';
export type { SessionStatusBadgeProps } from './SessionStatusBadge';

export { SessionList } from './SessionList';
export type { SessionListProps } from './SessionList';

export { SessionTypeSelector } from './SessionTypeSelector';
export type { SessionTypeSelectorProps } from './SessionTypeSelector';

export { QualityIndicator } from './QualityIndicator';
export type { QualityIndicatorProps } from './QualityIndicator';

export { PriorityDashboard } from './PriorityDashboard';
export type { PriorityDashboardProps } from './PriorityDashboard';

export { UncertaintyHeatmap } from './UncertaintyHeatmap';
export type { UncertaintyHeatmapProps } from './UncertaintyHeatmap';


export { TakeDock, KeyHint, dockSlotKind } from './console/TakeDock';
export type { TakeDockProps, DockSlotKind } from './console/TakeDock';
export { TakesList } from './console/TakesList';
export type { TakesListProps } from './console/TakesList';
export { SystemsStrip, worstCell } from './console/SystemsStrip';
export type { SystemsStripProps, StripCell } from './console/SystemsStrip';
export { OperatorChip } from './console/OperatorChip';
export type { OperatorChipProps } from './console/OperatorChip';

export { VRSessionPanel } from './VRSessionPanel';
export type { VRSessionPanelProps, VRSessionPanelVariant } from './VRSessionPanel';

export { PresenceBar, dedupeViewers } from './PresenceBar';
export type { PresenceBarProps } from './PresenceBar';

export { SessionCommandBar, SessionCommandBarSkeleton } from './console/SessionCommandBar';
export type { SessionCommandBarProps, RobotLink } from './console/SessionCommandBar';
export { TestingTools, TestingToolsRow } from './console/TestingTools';
export type { TestingToolsProps, TestingToolsRowProps } from './console/TestingTools';
export { HeadsetHero, RobotSetupDisclosure } from './console/HeadsetHero';
export type { HeadsetHeroProps } from './console/HeadsetHero';
export { SetupRail } from './console/SetupRail';
export type { SetupRailProps, SetupStepContent } from './console/SetupRail';
export { SetupStep } from './console/SetupStep';
export type { SetupStepProps } from './console/SetupStep';
export { LiveView, cameraLabel, leadCameraOf } from './console/LiveView';
export type { LiveViewProps } from './console/LiveView';
