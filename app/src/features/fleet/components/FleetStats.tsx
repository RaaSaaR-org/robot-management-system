/**
 * @file FleetStats.tsx
 * @description Fleet state at a glance: robots online, busy, open alerts and
 *   average battery, as a kit StatRow of StatTiles.
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/types
 */

import { AlertTriangle, BatteryMedium, Bot, Loader } from 'lucide-react';
import { StatRow, StatTile, type Tone } from '@/shared/components/ui';
import type { FleetStatsProps } from '../types/fleet.types';

const ICON = { className: 'h-4 w-4', strokeWidth: 1.75 } as const;

/** Open-alert tone: stopped when anything is critical, gated for any alert. */
function alertTone(critical: number, total: number): Tone {
  if (critical > 0) return 'stopped';
  if (total > 0) return 'gated';
  return 'neutral';
}

/** Hint naming the alert mix, e.g. "2 critical · 1 error". */
function alertHint(counts: Record<string, number>, total: number): string {
  if (total === 0) return 'All clear';
  const parts = [
    counts.critical ? `${counts.critical} critical` : null,
    counts.error ? `${counts.error} error` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Unacknowledged';
}

/**
 * Fleet KPI row. Numbers come straight from the robot agents via
 * useFleetStatus; the hints say so.
 */
export function FleetStats({ status, isLoading, className }: FleetStatsProps) {
  const {
    totalRobots,
    robotsByStatus,
    avgBatteryLevel,
    alertCounts,
    totalUnacknowledgedAlerts,
  } = status;

  const online = (robotsByStatus.online || 0) + (robotsByStatus.busy || 0);
  const busy = robotsByStatus.busy || 0;
  const critical = alertCounts.critical || 0;

  return (
    <StatRow columns={4} className={className}>
      <StatTile
        label="Robots online"
        value={online}
        unit={`/ ${totalRobots}`}
        tone={online > 0 ? 'live' : 'neutral'}
        icon={<Bot {...ICON} />}
        hint="Live from robot agents"
        isLoading={isLoading}
      />
      <StatTile
        label="Busy"
        value={busy}
        tone={busy > 0 ? 'info' : 'neutral'}
        icon={<Loader {...ICON} />}
        hint="Running a task"
        isLoading={isLoading}
      />
      <StatTile
        label="Open alerts"
        value={totalUnacknowledgedAlerts}
        tone={alertTone(critical, totalUnacknowledgedAlerts)}
        icon={<AlertTriangle {...ICON} />}
        hint={alertHint(alertCounts, totalUnacknowledgedAlerts)}
        isLoading={isLoading}
      />
      <StatTile
        label="Avg battery"
        value={avgBatteryLevel ?? '—'}
        unit={avgBatteryLevel !== null ? '%' : undefined}
        tone={avgBatteryLevel !== null && avgBatteryLevel < 30 ? 'gated' : 'neutral'}
        progress={avgBatteryLevel ?? undefined}
        icon={<BatteryMedium {...ICON} />}
        hint={avgBatteryLevel === null ? 'All robots on AC power' : 'Across battery robots'}
        isLoading={isLoading}
      />
    </StatRow>
  );
}
