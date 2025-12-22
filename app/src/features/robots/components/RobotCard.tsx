/**
 * @file RobotCard.tsx
 * @description Card component displaying robot summary information
 * @feature robots
 * @dependencies @/shared/components/ui, @/features/robots/types
 */

import { Card } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { RobotStatusBadge } from './RobotStatusBadge';
import { type Robot, formatRobotLocation, getBatteryCategory } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotCardProps {
  /** Robot data */
  robot: Robot;
  /** Click handler */
  onClick?: () => void;
  /** Whether this card is selected */
  selected?: boolean;
  /** Compact mode for list views */
  compact?: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// BATTERY ICON COMPONENT
// ============================================================================

function BatteryIcon({ level, className }: { level: number; className?: string }) {
  const category = getBatteryCategory(level);
  const fillWidth = Math.max(0, Math.min(100, level));

  const colorClass = {
    critical: 'fill-red-500',
    low: 'fill-orange-500',
    medium: 'fill-yellow-500',
    high: 'fill-green-500',
    full: 'fill-green-500',
  }[category];

  return (
    <svg
      className={cn('h-5 w-5', className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-label={`Battery ${level}%`}
    >
      {/* Battery outline */}
      <rect x="2" y="7" width="18" height="10" rx="2" className="stroke-current" />
      {/* Battery terminal */}
      <rect x="20" y="10" width="2" height="4" rx="0.5" className="fill-current" />
      {/* Battery fill */}
      <rect
        x="3.5"
        y="8.5"
        width={`${(fillWidth / 100) * 15}`}
        height="7"
        rx="1"
        className={cn('transition-all duration-300', colorClass)}
      />
    </svg>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Card component for displaying robot summary information.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <RobotCard robot={robot} onClick={() => selectRobot(robot.id)} />
 *
 * // Selected state
 * <RobotCard robot={robot} selected={true} />
 *
 * // Compact mode
 * <RobotCard robot={robot} compact />
 * ```
 */
export function RobotCard({
  robot,
  onClick,
  selected = false,
  compact = false,
  className,
}: RobotCardProps) {
  const batteryCategory = getBatteryCategory(robot.batteryLevel);
  const needsAttention = robot.status === 'error' || batteryCategory === 'critical';

  return (
    <Card
      interactive={!!onClick}
      className={cn(
        // Glass selection state with softer ring
        selected && 'ring-2 ring-cobalt-400/50 border-cobalt-400/30',
        // Attention state with subtle red border
        needsAttention && !selected && 'border-red-400/30',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-pressed={onClick ? selected : undefined}
    >
      {/* Header: Icon + Name + Status */}
      <div className="flex items-center gap-4">
        {/* Robot icon in glass container */}
        <div className="glass-subtle p-3 rounded-xl shrink-0">
          <svg
            className="h-6 w-6 text-cobalt-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
            />
          </svg>
        </div>

        {/* Name and model */}
        <div className="flex-1 min-w-0">
          <h3 className="card-title truncate">{robot.name}</h3>
          <p className="card-meta">{robot.model}</p>
        </div>

        {/* Status badge */}
        <RobotStatusBadge status={robot.status} showPulse />
      </div>

      {/* Full mode: Separator + Metrics */}
      {!compact && (
        <>
          {/* Glass separator */}
          <div className="my-4 h-px bg-glass-subtle" />

          {/* Bottom metrics row */}
          <div className="flex items-center justify-between">
            {/* Battery indicator */}
            <div className="flex items-center gap-2">
              <BatteryIcon level={robot.batteryLevel} className="h-4 w-4" />
              <span
                className={cn(
                  'text-sm font-medium',
                  batteryCategory === 'critical' && 'text-red-400',
                  batteryCategory === 'low' && 'text-orange-400',
                  batteryCategory !== 'critical' && batteryCategory !== 'low' && 'text-theme-secondary'
                )}
              >
                {robot.batteryLevel}%
              </span>
            </div>

            {/* Location */}
            <span className="card-meta">
              {formatRobotLocation(robot.location)}
            </span>
          </div>

          {/* Current Task (if any) */}
          {robot.currentTaskName && (
            <div className="mt-3 flex items-center gap-2">
              <span className="card-label">Task</span>
              <span className="card-meta truncate flex-1 text-right">
                {robot.currentTaskName}
              </span>
            </div>
          )}
        </>
      )}

      {/* Compact mode: inline metrics */}
      {compact && (
        <div className="flex items-center gap-4 ml-auto">
          <div className="flex items-center gap-1.5">
            <BatteryIcon level={robot.batteryLevel} className="h-4 w-4" />
            <span className="card-meta">{robot.batteryLevel}%</span>
          </div>
          <span className="card-meta">{formatRobotLocation(robot.location)}</span>
        </div>
      )}
    </Card>
  );
}
