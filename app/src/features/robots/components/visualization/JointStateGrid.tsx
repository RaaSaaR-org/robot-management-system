/**
 * @file JointStateGrid.tsx
 * @description Grid display of joint states with visual indicators
 * @feature robots
 */

import { memo, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { motorTempColor, motorTempTextClass } from '../../utils/temperature';
import type { JointState } from '../../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface JointStateGridProps {
  /** Array of joint states from telemetry */
  jointStates: JointState[];
  /** Number of columns in the grid (card variant only) */
  columns?: 1 | 2 | 3;
  /**
   * Unit of the incoming `position`/`velocity` values. SO-101 (LeRobot) reports
   * degrees; the Unitree humanoids report radians (see `jointPositionUnit`).
   */
  positionUnit?: 'deg' | 'rad';
  /**
   * `card` — one glass card per joint (default, used on 3D/session pages).
   * `compact` — dense single-line rows grouped by body region (legs, torso,
   * arms, hands); scales to a 43-DOF humanoid without an inner scrollbar.
   */
  variant?: 'card' | 'compact';
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Normalize joint position (degrees) to 0-100 percentage.
 * Assumes typical joint range of -180° to +180°.
 */
function normalizePosition(degrees: number): number {
  const normalized = (degrees + 180) / 360;
  return Math.max(0, Math.min(100, normalized * 100));
}

/**
 * Get color class based on position in degrees. Semantic scale:
 * centered = success, normal range = brand primary, approaching a limit =
 * warning (amber), near the limit = error.
 */
function getPositionColor(degrees: number): string {
  const absDeg = Math.abs(degrees);
  if (absDeg < 30) return 'bg-green-500';
  if (absDeg < 90) return 'bg-cobalt-500';
  if (absDeg < 150) return 'bg-amber-500';
  return 'bg-red-500';
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
// BODY-REGION GROUPING (compact variant)
// ============================================================================

interface JointRegion {
  /** Section heading, e.g. "Left Leg" */
  label: string;
  /** Anatomical sort order (top of the page = legs → torso → arms → hands) */
  order: number;
}

/**
 * Classify a joint into a body region from its name. Covers the Unitree
 * humanoid naming (left_hip_pitch_joint, waist_yaw_joint,
 * left_hand_thumb_0_joint, …); unknown names fall into "Joints" so
 * non-humanoids (SO-101) render as a single flat section.
 */
function jointRegion(name: string): JointRegion {
  const n = name.toLowerCase();
  const side = n.includes('right') ? 'Right' : n.includes('left') ? 'Left' : '';
  const sideOrder = side === 'Right' ? 1 : 0;
  if (/hand|thumb|index|middle|finger|gripper/.test(n)) {
    return { label: `${side} Hand`.trim(), order: 60 + sideOrder };
  }
  if (/hip|knee|ankle/.test(n)) {
    return { label: `${side} Leg`.trim(), order: 10 + sideOrder };
  }
  if (/waist|torso/.test(n)) {
    return { label: 'Torso', order: 30 };
  }
  if (/shoulder|elbow|wrist/.test(n)) {
    return { label: `${side} Arm`.trim(), order: 40 + sideOrder };
  }
  return { label: 'Joints', order: 90 };
}

/** Strip the side prefix when the section heading already carries it. */
function compactJointLabel(name: string, sectionLabel: string): string {
  const pretty = formatJointName(name);
  const side = sectionLabel.startsWith('Left') ? 'Left ' : sectionLabel.startsWith('Right') ? 'Right ' : '';
  const stripped = side && pretty.startsWith(side) ? pretty.slice(side.length) : pretty;
  // "Hand Thumb 0" → "Thumb 0" inside a "Left Hand" section
  return sectionLabel.endsWith('Hand') && stripped.startsWith('Hand ')
    ? stripped.slice(5)
    : stripped;
}

// ============================================================================
// JOINT ITEM COMPONENT (card variant)
// ============================================================================

interface JointItemProps {
  joint: JointState;
  positionUnit: 'deg' | 'rad';
}

const JointItem = memo(function JointItem({ joint, positionUnit }: JointItemProps) {
  const degrees = positionUnit === 'rad' ? joint.position * (180 / Math.PI) : joint.position;
  const radians = positionUnit === 'rad' ? joint.position : toRadians(joint.position);
  const percentage = normalizePosition(degrees);
  const colorClass = getPositionColor(degrees);

  return (
    <div className="glass-subtle p-3 rounded-lg space-y-2">
      {/* Joint name */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-theme-secondary truncate">
          {formatJointName(joint.name)}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {joint.velocity !== undefined && Math.abs(joint.velocity) > 0.01 && (
            <span className="text-[10px] text-theme-tertiary">
              {joint.velocity > 0 ? '+' : ''}{joint.velocity.toFixed(2)} {positionUnit}/s
            </span>
          )}
          {joint.temperature !== undefined && (
            <span
              className={cn('flex items-center gap-1 text-[10px] font-mono', motorTempTextClass(joint.temperature))}
              title={`Motor temperature: ${joint.temperature.toFixed(1)}°C`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: motorTempColor(joint.temperature) }}
                aria-hidden="true"
              />
              {joint.temperature.toFixed(0)}°C
            </span>
          )}
        </span>
      </div>

      {/* Position bar */}
      <div className="relative">
        <div className="h-2 bg-surface-600 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-150', colorClass)}
            style={{ width: `${percentage}%` }}
          />
        </div>
        {/* Center line indicator */}
        <div className="absolute top-0 left-1/2 w-px h-2 bg-theme-tertiary/50 transform -translate-x-1/2" />
      </div>

      {/* Position value */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-theme-primary">
          {degrees.toFixed(1)}°
        </span>
        <span className="font-mono text-theme-tertiary">
          {radians.toFixed(3)} rad
        </span>
      </div>
    </div>
  );
});

// ============================================================================
// COMPACT ROW COMPONENT
// ============================================================================

interface CompactJointRowProps {
  joint: JointState;
  label: string;
  positionUnit: 'deg' | 'rad';
}

const CompactJointRow = memo(function CompactJointRow({ joint, label, positionUnit }: CompactJointRowProps) {
  const degrees = positionUnit === 'rad' ? joint.position * (180 / Math.PI) : joint.position;
  const radians = positionUnit === 'rad' ? joint.position : toRadians(joint.position);
  const isMoving = joint.velocity !== undefined && Math.abs(joint.velocity) > 0.01;
  const colorClass = getPositionColor(degrees);
  // Center-origin bar: 0° sits in the middle, ±180° reaches the edge.
  const halfPct = Math.min(50, (Math.abs(degrees) / 180) * 50);

  return (
    <div
      className="flex items-center gap-2 py-[3px]"
      title={`${formatJointName(joint.name)}: ${degrees.toFixed(1)}° (${radians.toFixed(3)} rad)${
        joint.velocity !== undefined ? ` · ${joint.velocity.toFixed(2)} ${positionUnit}/s` : ''
      }`}
    >
      <span className="flex w-[7.5rem] shrink-0 items-center gap-1.5 text-xs text-theme-secondary">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            isMoving ? 'bg-cobalt-400 animate-pulse' : 'bg-surface-600'
          )}
          aria-hidden="true"
        />
        <span className="truncate">{label}</span>
      </span>

      <div className="relative h-1.5 flex-1 rounded-full bg-surface-600">
        <div
          className={cn(
            'absolute top-0 h-full rounded-full transition-all duration-150',
            colorClass
          )}
          style={degrees >= 0 ? { left: '50%', width: `${halfPct}%` } : { right: '50%', width: `${halfPct}%` }}
        />
        <div className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-theme-tertiary/50" />
      </div>

      <span className="w-14 shrink-0 text-right font-mono text-xs text-theme-primary">
        {degrees.toFixed(1)}°
      </span>
      <span className="w-9 shrink-0 text-right">
        {joint.temperature !== undefined && (
          <span
            className={cn('font-mono text-[10px]', motorTempTextClass(joint.temperature))}
            title={`Motor temperature: ${joint.temperature.toFixed(1)}°C`}
          >
            {joint.temperature.toFixed(0)}°C
          </span>
        )}
      </span>
    </div>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const JointStateGrid = memo(function JointStateGrid({
  jointStates,
  columns = 2,
  positionUnit = 'deg',
  variant = 'card',
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

  // Body-region sections for the compact variant, in anatomical order.
  const sections = useMemo(() => {
    if (variant !== 'compact') return [];
    const byLabel = new Map<string, { region: JointRegion; joints: JointState[] }>();
    for (const joint of jointStates) {
      const region = jointRegion(joint.name);
      const entry = byLabel.get(region.label);
      if (entry) entry.joints.push(joint);
      else byLabel.set(region.label, { region, joints: [joint] });
    }
    return [...byLabel.values()].sort((a, b) => a.region.order - b.region.order);
  }, [variant, jointStates]);

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

  const movingCount = jointStates.filter((j) => j.velocity && Math.abs(j.velocity) > 0.01).length;

  if (variant === 'compact') {
    const showHeadings = sections.length > 1;
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-theme-secondary">{jointStates.length} joints</span>
          <span className="text-theme-tertiary">{movingCount} moving</span>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 2xl:grid-cols-3 items-start">
          {sections.map(({ region, joints }) => (
            <section key={region.label}>
              {showHeadings && (
                <h3 className="mb-1 flex items-baseline gap-2 border-b border-glass-subtle pb-1 text-xs font-semibold uppercase tracking-wide text-theme-tertiary">
                  {region.label}
                  <span className="font-normal normal-case tracking-normal">{joints.length} joints</span>
                </h3>
              )}
              {joints.map((joint) => (
                <CompactJointRow
                  key={joint.name}
                  joint={joint}
                  label={compactJointLabel(joint.name, region.label)}
                  positionUnit={positionUnit}
                />
              ))}
            </section>
          ))}
        </div>
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
          {movingCount} moving
        </span>
      </div>

      {/* Joint grid */}
      <div className={cn('grid gap-3', gridClass)}>
        {jointStates.map((joint) => (
          <JointItem key={joint.name} joint={joint} positionUnit={positionUnit} />
        ))}
      </div>
    </div>
  );
});
