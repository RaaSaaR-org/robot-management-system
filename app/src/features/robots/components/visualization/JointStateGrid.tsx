/**
 * @file JointStateGrid.tsx
 * @description Grid display of joint states with visual indicators
 * @feature robots
 */

import { memo, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import type { JointState } from '../../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface JointStateGridProps {
  /** Array of joint states from telemetry */
  jointStates: JointState[];
  /** Number of columns in the grid */
  columns?: 1 | 2 | 3;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Convert radians to degrees
 */
function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Normalize joint position to 0-100 percentage
 * Assumes typical joint range of -PI to PI
 */
function normalizePosition(position: number): number {
  const normalized = (position + Math.PI) / (2 * Math.PI);
  return Math.max(0, Math.min(100, normalized * 100));
}

/**
 * Get color class based on position (centered = green, extremes = orange/red)
 */
function getPositionColor(position: number): string {
  const absPos = Math.abs(position);
  if (absPos < 0.5) return 'from-green-400 to-emerald-500';
  if (absPos < 1.5) return 'from-cobalt-400 to-turquoise-400';
  if (absPos < 2.5) return 'from-yellow-400 to-orange-400';
  return 'from-orange-400 to-red-400';
}

/**
 * Format joint name for display
 */
function formatJointName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/joint$/i, '')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ============================================================================
// JOINT ITEM COMPONENT
// ============================================================================

interface JointItemProps {
  joint: JointState;
}

const JointItem = memo(function JointItem({ joint }: JointItemProps) {
  const percentage = normalizePosition(joint.position);
  const degrees = toDegrees(joint.position);
  const colorClass = getPositionColor(joint.position);

  return (
    <div className="glass-subtle p-3 rounded-lg space-y-2">
      {/* Joint name */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-theme-secondary truncate">
          {formatJointName(joint.name)}
        </span>
        {joint.velocity !== undefined && Math.abs(joint.velocity) > 0.01 && (
          <span className="text-[10px] text-theme-tertiary">
            {joint.velocity > 0 ? '+' : ''}{joint.velocity.toFixed(2)} rad/s
          </span>
        )}
      </div>

      {/* Position bar */}
      <div className="relative">
        <div className="h-2 bg-surface-600 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-150', colorClass)}
            style={{ width: `${percentage}%` }}
          />
        </div>
        {/* Center line indicator */}
        <div className="absolute top-0 left-1/2 w-px h-2 bg-theme-tertiary/50 transform -translate-x-1/2" />
      </div>

      {/* Position value */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-theme-primary">
          {degrees.toFixed(1)}deg
        </span>
        <span className="font-mono text-theme-tertiary">
          {joint.position.toFixed(3)} rad
        </span>
      </div>
    </div>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const JointStateGrid = memo(function JointStateGrid({
  jointStates,
  columns = 2,
  className,
}: JointStateGridProps) {
  const gridClass = useMemo(() => {
    switch (columns) {
      case 1:
        return 'grid-cols-1';
      case 3:
        return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
      default:
        return 'grid-cols-1 sm:grid-cols-2';
    }
  }, [columns]);

  if (jointStates.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-center', className)}>
        <div className="glass-subtle rounded-2xl p-4 mb-3">
          <svg
            className="h-8 w-8 text-theme-tertiary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
            />
          </svg>
        </div>
        <p className="text-theme-secondary font-medium">No joint data available</p>
        <p className="text-sm text-theme-tertiary mt-1">
          Connect to robot for real-time joint states
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Summary stats */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-theme-secondary">
          {jointStates.length} joints
        </span>
        <span className="text-theme-tertiary">
          {jointStates.filter((j) => j.velocity && Math.abs(j.velocity) > 0.01).length} moving
        </span>
      </div>

      {/* Joint grid */}
      <div className={cn('grid gap-3', gridClass)}>
        {jointStates.map((joint) => (
          <JointItem key={joint.name} joint={joint} />
        ))}
      </div>
    </div>
  );
});
