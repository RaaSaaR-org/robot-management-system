/**
 * @file SafetyStatusDashboard.tsx
 * @description Dashboard showing real-time safety status for the fleet
 * @feature safety
 */

import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { Badge } from '@/shared/components/ui/Badge';
import { useSafetyOverview } from '../hooks/useSafety';
import { FleetEmergencyStopButton } from './FleetEmergencyStopButton';
import {
  ESTOP_STATUS_LABELS,
  OPERATING_MODE_LABELS,
  type RobotSafetyStatus,
} from '../types/safety.types';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface StatusIndicatorProps {
  label: string;
  value: string | number;
  status?: 'good' | 'warning' | 'error' | 'neutral';
  className?: string;
}

function StatusIndicator({ label, value, status = 'neutral', className }: StatusIndicatorProps) {
  const statusColors = {
    good: 'text-green-500',
    warning: 'text-yellow-500',
    error: 'text-red-500',
    neutral: 'text-theme-secondary',
  };

  return (
    <div className={cn('flex flex-col', className)}>
      <span className="text-xs text-theme-muted uppercase tracking-wide">{label}</span>
      <span className={cn('text-lg font-semibold', statusColors[status])}>{value}</span>
    </div>
  );
}

interface RobotSafetyCardProps {
  robot: RobotSafetyStatus;
}

function RobotSafetyCard({ robot }: RobotSafetyCardProps) {
  const statusVariant = useMemo(() => {
    if (robot.status === 'triggered') return 'error';
    if (!robot.systemHealthy) return 'warning';
    return 'default';
  }, [robot.status, robot.systemHealthy]);

  const statusBg = useMemo(() => {
    if (robot.status === 'triggered') return 'bg-red-100 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    if (!robot.systemHealthy) return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    return 'bg-theme-elevated border-theme-subtle';
  }, [robot.status, robot.systemHealthy]);

  return (
    <div className={cn('p-4 rounded-lg border', statusBg)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-theme-primary truncate">
              {robot.robotName}
            </h4>
            <Badge variant={statusVariant}>
              {ESTOP_STATUS_LABELS[robot.status]}
            </Badge>
          </div>

          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-theme-muted">Mode:</span>{' '}
              <span className="text-theme-secondary">
                {OPERATING_MODE_LABELS[robot.operatingMode]}
              </span>
            </div>
            <div>
              <span className="text-theme-muted">Speed:</span>{' '}
              <span
                className={cn(
                  robot.currentSpeed > robot.activeSpeedLimit * 0.9
                    ? 'text-yellow-500'
                    : 'text-theme-secondary'
                )}
              >
                {robot.currentSpeed.toFixed(0)} mm/s
              </span>
            </div>
            <div>
              <span className="text-theme-muted">Limit:</span>{' '}
              <span className="text-theme-secondary">{robot.activeSpeedLimit} mm/s</span>
            </div>
            <div>
              <span className="text-theme-muted">Connection:</span>{' '}
              <span
                className={robot.serverConnected ? 'text-green-500' : 'text-red-500'}
              >
                {robot.serverConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>

          {robot.warnings.length > 0 && (
            <div className="mt-2">
              {robot.warnings.map((warning, i) => (
                <span
                  key={i}
                  className="inline-block mr-2 px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded"
                >
                  {warning}
                </span>
              ))}
            </div>
          )}

          {robot.reason && robot.status === 'triggered' && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              Reason: {robot.reason}
            </p>
          )}
        </div>

        {/* Health indicator */}
        <div className="flex-shrink-0">
          <div
            className={cn(
              'w-3 h-3 rounded-full',
              robot.systemHealthy ? 'bg-green-500' : 'bg-red-500',
              robot.status === 'triggered' && 'animate-pulse'
            )}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export interface SafetyStatusDashboardProps {
  /** Additional class names */
  className?: string;
  /** Show compact version */
  compact?: boolean;
}

/**
 * Dashboard component showing real-time safety status for the fleet.
 * Displays E-stop status, operating modes, speed limits, and warnings.
 */
export function SafetyStatusDashboard({
  className,
  compact = false,
}: SafetyStatusDashboardProps) {
  const {
    fleetStatus,
    hasTriggeredEStop,
    triggeredCount,
    systemHealthy,
    totalRobots,
    onlineRobots,
    recentEvents,
  } = useSafetyOverview();

  if (!fleetStatus) {
    return (
      <div className={cn('p-4 text-center text-theme-muted', className)}>
        Loading safety status...
      </div>
    );
  }

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-4 p-3 rounded-lg border',
          hasTriggeredEStop
            ? 'bg-red-100 dark:bg-red-900/20 border-red-300 dark:border-red-700'
            : 'bg-theme-elevated border-theme-subtle',
          className
        )}
      >
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'w-4 h-4 rounded-full',
              systemHealthy ? 'bg-green-500' : 'bg-red-500',
              hasTriggeredEStop && 'animate-pulse'
            )}
          />
          <div>
            <span className="font-medium text-theme-primary">
              {hasTriggeredEStop
                ? `E-STOP ACTIVE (${triggeredCount})`
                : 'System Normal'}
            </span>
            <span className="ml-2 text-sm text-theme-muted">
              {onlineRobots}/{totalRobots} online
            </span>
          </div>
        </div>
        <FleetEmergencyStopButton size="sm" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header with fleet controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-theme-primary">
            Safety Status
          </h2>
          <p className="text-sm text-theme-secondary">
            Real-time monitoring of fleet safety systems
          </p>
        </div>
        <FleetEmergencyStopButton size="lg" />
      </div>

      {/* Status summary */}
      <div
        className={cn(
          'grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-lg border',
          hasTriggeredEStop
            ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
            : 'bg-theme-elevated border-theme-subtle'
        )}
      >
        <StatusIndicator
          label="System Status"
          value={systemHealthy ? 'Normal' : 'Alert'}
          status={systemHealthy ? 'good' : 'error'}
        />
        <StatusIndicator
          label="E-Stops Active"
          value={triggeredCount}
          status={triggeredCount > 0 ? 'error' : 'good'}
        />
        <StatusIndicator
          label="Robots Online"
          value={`${onlineRobots}/${totalRobots}`}
          status={onlineRobots === totalRobots ? 'good' : 'warning'}
        />
        <StatusIndicator
          label="Last Update"
          value={new Date(fleetStatus.timestamp).toLocaleTimeString()}
          status="neutral"
        />
      </div>

      {/* Robot list */}
      <div className="space-y-3">
        <h3 className="text-lg font-medium text-theme-primary">Robot Safety Status</h3>
        {fleetStatus.robots.length === 0 ? (
          <p className="text-theme-muted text-center py-8">
            No robots registered
          </p>
        ) : (
          <div className="space-y-2">
            {fleetStatus.robots.map((robot) => (
              <RobotSafetyCard key={robot.robotId} robot={robot} />
            ))}
          </div>
        )}
      </div>

      {/* Recent events */}
      {recentEvents.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-medium text-theme-primary">Recent Safety Events</h3>
          <div className="space-y-2">
            {recentEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between p-3 rounded-lg bg-theme-elevated border border-theme-subtle"
              >
                <div className="flex items-center gap-3">
                  <Badge
                    variant={event.scope === 'fleet' ? 'error' : 'warning'}
                  >
                    {event.scope.toUpperCase()}
                  </Badge>
                  <div>
                    <p className="text-sm font-medium text-theme-primary">
                      {event.reason}
                    </p>
                    <p className="text-xs text-theme-muted">
                      {event.affectedRobots.length} robot(s) affected
                    </p>
                  </div>
                </div>
                <span className="text-xs text-theme-muted">
                  {new Date(event.triggeredAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
