/**
 * @file RobotIdentityBar.tsx
 * @description Compact header bar displaying robot identity, status, and emergency stop
 * @feature robots
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';
import { RobotStatusBadge } from './RobotStatusBadge';
import { RobotEmergencyStopButton } from '@/features/safety';
import type { Robot, RobotTelemetry } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotIdentityBarProps {
  /** Robot data */
  robot: Robot;
  /** Live telemetry data */
  telemetry?: RobotTelemetry | null;
  /** Whether telemetry stream is connected */
  isTelemetryConnected: boolean;
  /** Called when back button is clicked */
  onBack?: () => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Compact single-row identity bar for the robot detail page header.
 * Replaces the large hero section with a dense, glassy bar.
 */
export const RobotIdentityBar = memo(function RobotIdentityBar({
  robot,
  isTelemetryConnected,
  onBack,
  className,
}: RobotIdentityBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 h-16 glass-card rounded-xl',
        'border-b border-[#FF6700]/10',
        className
      )}
    >
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back to robots list"
          className={cn(
            'flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg',
            'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            'hover:bg-[rgba(255,103,0,0.08)] transition-colors duration-150'
          )}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
      )}

      {/* Robot icon */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ background: 'rgba(255,103,0,0.1)', border: '1px solid rgba(255,103,0,0.2)' }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="#FF6700" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.34 1.34a2.25 2.25 0 01-1.59.659H6.13a2.25 2.25 0 01-1.59-.659L3.2 15m16.6 0l-1.2 1.2m-15.4 0L4.4 16.2M3.2 15a2.25 2.25 0 01-.659-1.591V9.75m0 0A2.25 2.25 0 014.79 7.5h14.42A2.25 2.25 0 0121.45 9.75v3.659m-18.25 0v0" />
        </svg>
      </div>

      {/* Robot name + model */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-sm font-semibold text-theme-primary truncate leading-tight">
            {robot.name}
          </h1>
          <RobotStatusBadge status={robot.status} size="sm" />
        </div>
        <p className="text-xs text-theme-tertiary truncate leading-tight mt-0.5 font-mono">
          {robot.model}
        </p>
      </div>

      {/* Telemetry connection indicator */}
      <div className="flex-shrink-0 flex items-center gap-1.5 glass-subtle px-2.5 py-1 rounded-full">
        <span
          className={cn(
            'w-2 h-2 rounded-full transition-colors duration-300',
            isTelemetryConnected
              ? 'bg-green-500 animate-pulse'
              : 'bg-gray-500'
          )}
        />
        <span className="text-xs text-theme-tertiary font-mono hidden sm:inline">
          {isTelemetryConnected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      {/* Emergency stop */}
      <div className="flex-shrink-0">
        <RobotEmergencyStopButton robotId={robot.id} robotName={robot.name} size="sm" />
      </div>
    </div>
  );
});
