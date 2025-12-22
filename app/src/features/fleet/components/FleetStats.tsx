/**
 * @file FleetStats.tsx
 * @description Fleet statistics KPI cards component
 * @feature fleet
 * @dependencies @/shared/utils/cn, @/shared/components/ui, @/features/fleet/types
 */

import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { Spinner } from '@/shared/components/ui/Spinner';
import type { FleetStatsProps } from '../types/fleet.types';
import { ROBOT_STATUS_COLORS } from '../types/fleet.types';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Single stat card */
function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  children,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-theme-tertiary uppercase tracking-wide">{title}</span>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: color ? `${color}20` : 'rgb(var(--color-cobalt-100))' }}
        >
          <span style={{ color: color || 'rgb(var(--color-cobalt-500))' }}>{icon}</span>
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-theme-primary">{value}</span>
        {subtitle && <span className="text-sm text-theme-tertiary">{subtitle}</span>}
      </div>
      {children}
    </Card>
  );
}

/** Status breakdown mini-bar */
function StatusBreakdown({
  robotsByStatus,
  total,
}: {
  robotsByStatus: Record<string, number>;
  total: number;
}) {
  if (total === 0) return null;

  const statuses = ['online', 'busy', 'charging', 'error', 'maintenance', 'offline'] as const;

  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-theme-elevated">
      {statuses.map((status) => {
        const count = robotsByStatus[status] || 0;
        const percentage = (count / total) * 100;
        if (percentage === 0) return null;
        return (
          <div
            key={status}
            className="h-full transition-all"
            style={{
              width: `${percentage}%`,
              backgroundColor: ROBOT_STATUS_COLORS[status],
            }}
            title={`${status}: ${count}`}
          />
        );
      })}
    </div>
  );
}

/** Battery level indicator */
function BatteryIndicator({ level }: { level: number }) {
  const getColor = () => {
    if (level >= 60) return '#22c55e'; // green
    if (level >= 30) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-theme-elevated overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${level}%`,
            backgroundColor: getColor(),
          }}
        />
      </div>
    </div>
  );
}

/** Alert count with severity indicator */
function AlertIndicator({
  counts,
  total,
}: {
  counts: Record<string, number>;
  total: number;
}) {
  const criticalCount = counts.critical || 0;
  const errorCount = counts.error || 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      {criticalCount > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {criticalCount} critical
        </span>
      )}
      {errorCount > 0 && (
        <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
          {errorCount} error
        </span>
      )}
      {criticalCount === 0 && errorCount === 0 && total === 0 && (
        <span className="text-green-600 dark:text-green-400">All clear</span>
      )}
    </div>
  );
}

// ============================================================================
// ICONS
// ============================================================================

const RobotIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
  </svg>
);

const OnlineIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const BusyIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const AlertIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const BatteryIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const TaskIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Fleet statistics component displaying KPI cards.
 *
 * @example
 * ```tsx
 * function FleetDashboard() {
 *   const { status, isLoading } = useFleetStatus();
 *
 *   return <FleetStats status={status} isLoading={isLoading} />;
 * }
 * ```
 */
export function FleetStats({ status, isLoading, className }: FleetStatsProps) {
  if (isLoading) {
    return (
      <div className={cn('grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6', className)}>
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="p-4 h-28 flex items-center justify-center">
            <Spinner size="sm" />
          </Card>
        ))}
      </div>
    );
  }

  const {
    totalRobots,
    robotsByStatus,
    avgBatteryLevel,
    alertCounts,
    totalUnacknowledgedAlerts,
    activeTaskCount,
  } = status;

  return (
    <div className={cn('grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6', className)}>
      {/* Total Robots */}
      <StatCard
        title="Total Robots"
        value={totalRobots}
        icon={<RobotIcon />}
      >
        <StatusBreakdown robotsByStatus={robotsByStatus} total={totalRobots} />
      </StatCard>

      {/* Online */}
      <StatCard
        title="Online"
        value={robotsByStatus.online || 0}
        subtitle={`of ${totalRobots}`}
        icon={<OnlineIcon />}
        color={ROBOT_STATUS_COLORS.online}
      />

      {/* Busy */}
      <StatCard
        title="Busy"
        value={robotsByStatus.busy || 0}
        subtitle="active"
        icon={<BusyIcon />}
        color={ROBOT_STATUS_COLORS.busy}
      />

      {/* Alerts */}
      <StatCard
        title="Alerts"
        value={totalUnacknowledgedAlerts}
        subtitle="unacknowledged"
        icon={<AlertIcon />}
        color={totalUnacknowledgedAlerts > 0 ? '#ef4444' : '#22c55e'}
      >
        <AlertIndicator counts={alertCounts} total={totalUnacknowledgedAlerts} />
      </StatCard>

      {/* Battery */}
      <StatCard
        title="Avg Battery"
        value={`${avgBatteryLevel}%`}
        icon={<BatteryIcon />}
        color={avgBatteryLevel >= 60 ? '#22c55e' : avgBatteryLevel >= 30 ? '#eab308' : '#ef4444'}
      >
        <BatteryIndicator level={avgBatteryLevel} />
      </StatCard>

      {/* Active Tasks */}
      <StatCard
        title="Active Tasks"
        value={activeTaskCount}
        subtitle="running"
        icon={<TaskIcon />}
        color="#3b82f6"
      />
    </div>
  );
}
