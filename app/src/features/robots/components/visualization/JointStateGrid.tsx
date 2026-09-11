/**
 * @file JointStateGrid.tsx
 * @description Grid display of joint states with visual indicators
 * @feature robots
 */

import { memo, useMemo } from 'react';
import { Activity } from 'lucide-react';
import { EmptyState } from '@/shared/components/ui';
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
   * `card` — one inset cell per joint (default, used on 3D/session pages).
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
  if (absDeg < 30) return 'bg-signal-measured';
  if (absDeg < 90) return 'bg-primary';
  if (absDeg < 150) return 'bg-signal-unknown';
  return 'bg-signal-stopped';
}

/**
 * Format joint name for display
 */
function formatJointName(name: string): string {
  const words = name.replace(/_/g, ' ').replace(/joint$/i, '').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
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
    return { label: `${side} hand`.trim(), order: 60 + sideOrder };
  }
  if (/hip|knee|ankle/.test(n)) {
    return { label: `${side} leg`.trim(), order: 10 + sideOrder };
  }
  if (/waist|torso/.test(n)) {
    return { label: 'Torso', order: 30 };
  }
  if (/shoulder|elbow|wrist/.test(n)) {
    return { label: `${side} arm`.trim(), order: 40 + sideOrder };
  }
  return { label: 'Joints', order: 90 };
}

/** Strip the side prefix when the section heading already carries it. */
function compactJointLabel(name: string, sectionLabel: string): string {
  const pretty = formatJointName(name);
  const side = sectionLabel.startsWith('Left') ? 'left ' : sectionLabel.startsWith('Right') ? 'right ' : '';
  let stripped = side && pretty.toLowerCase().startsWith(side) ? pretty.slice(side.length) : pretty;
  // "hand thumb 0" → "thumb 0" inside a "Left hand" section
  if (sectionLabel.endsWith('hand') && stripped.toLowerCase().startsWith('hand ')) stripped = stripped.slice(5);
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
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
    <div className="flex flex-col gap-2 rounded-control border border-line-subtle bg-inset p-3">
      {/* Joint name */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-ink-secondary">
          {formatJointName(joint.name)}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {joint.velocity !== undefined && Math.abs(joint.velocity) > 0.01 && (
            <span className="text-[11px] tabular-nums text-ink-tertiary">
              {joint.velocity > 0 ? '+' : ''}{joint.velocity.toFixed(2)} {positionUnit}/s
            </span>
          )}
          {joint.temperature !== undefined && (
            <span
              className={cn('flex items-center gap-1 text-[11px] tabular-nums', motorTempTextClass(joint.temperature))}
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
        <div className="h-1.5 overflow-hidden rounded-full bg-line-subtle">
          <div
            className={cn('h-full rounded-full transition-[width] duration-150', colorClass)}
            style={{ width: `${percentage}%` }}
          />
        </div>
        {/* Center line indicator */}
        <div className="absolute left-1/2 top-0 h-1.5 w-px -translate-x-1/2 bg-line-strong" />
      </div>

      {/* Position value */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold tabular-nums text-ink-primary">{degrees.toFixed(1)}°</span>
        <span className="tabular-nums text-ink-tertiary">
          {radians.toFixed(3)}
          <span className="ml-0.5">rad</span>
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
      <span className="flex w-[7.5rem] shrink-0 items-center gap-1.5 text-xs text-ink-secondary">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            isMoving ? 'bg-primary' : 'bg-line-strong'
          )}
          aria-hidden="true"
        />
        <span className="truncate">{label}</span>
      </span>

      <div className="relative h-1.5 min-w-0 flex-1 rounded-full bg-line-subtle">
        <div
          className={cn(
            'absolute top-0 h-full rounded-full transition-[width] duration-150',
            colorClass
          )}
          style={degrees >= 0 ? { left: '50%', width: `${halfPct}%` } : { right: '50%', width: `${halfPct}%` }}
        />
        <div className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-line-strong" />
      </div>

      <span className="w-14 shrink-0 text-right text-xs font-medium tabular-nums text-ink-primary">
        {degrees.toFixed(1)}°
      </span>
      <span className="w-9 shrink-0 text-right">
        {joint.temperature !== undefined && (
          <span
            className={cn('text-[11px] tabular-nums', motorTempTextClass(joint.temperature))}
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
      <EmptyState
        size="sm"
        icon={<Activity />}
        title="No joint data yet"
        description="Joint states appear once the robot agent streams telemetry."
        className={className}
      />
    );
  }

  const movingCount = jointStates.filter((j) => j.velocity && Math.abs(j.velocity) > 0.01).length;

  if (variant === 'compact') {
    const showHeadings = sections.length > 1;
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center justify-between text-sm">
          <span className="tabular-nums text-ink-secondary">{jointStates.length} joints</span>
          <span className="tabular-nums text-ink-tertiary">{movingCount} moving</span>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 2xl:grid-cols-3 items-start">
          {sections.map(({ region, joints }) => (
            <section key={region.label}>
              {showHeadings && (
                <h3 className="mb-1.5 flex items-baseline gap-2 border-b border-line-subtle pb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary">
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
        <span className="tabular-nums text-ink-secondary">{jointStates.length} joints</span>
        <span className="tabular-nums text-ink-tertiary">{movingCount} moving</span>
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
