/**
 * @file index.ts
 * @description Barrel export for tasks/processes components
 * @feature processes
 */

// Original exports
export * from './TaskStatusBadge';
export * from './TaskPriorityBadge';
export * from './TaskCard';
export * from './TaskList';
export * from './TaskTimeline';
export * from './TaskDetailPanel';
export * from './TaskDetailSkeleton';
export * from './CreateProcessModal';

// Process component aliases (user-facing terminology)
export { TaskStatusBadge as ProcessStatusBadge } from './TaskStatusBadge';
export { TaskPriorityBadge as ProcessPriorityBadge } from './TaskPriorityBadge';
export { TaskCard as ProcessCard } from './TaskCard';
export { TaskList as ProcessList } from './TaskList';
export { TaskTimeline as ProcessTimeline } from './TaskTimeline';
export { TaskDetailPanel as ProcessDetailPanel } from './TaskDetailPanel';

// Re-export props with Process naming
export type { TaskStatusBadgeProps as ProcessStatusBadgeProps } from './TaskStatusBadge';
export type { TaskPriorityBadgeProps as ProcessPriorityBadgeProps } from './TaskPriorityBadge';
export type { TaskCardProps as ProcessCardProps } from './TaskCard';
export type { TaskListProps as ProcessListProps } from './TaskList';
export type { TaskTimelineProps as ProcessTimelineProps } from './TaskTimeline';
export type { TaskDetailPanelProps as ProcessDetailPanelProps } from './TaskDetailPanel';
