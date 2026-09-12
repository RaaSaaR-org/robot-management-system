/**
 * @file RobotQuickStats.tsx
 * @description The robot's state at a glance (Overview tab): battery, temperature,
 *              CPU and current task as a StatRow. Without telemetry the values read
 *              "—" with a hint saying how to get them, never "N/A".
 * @feature robots
 */

import { memo } from 'react';
import { BatteryMedium, Cpu, ListChecks, Thermometer } from 'lucide-react';
import { StatRow, StatTile, type Tone } from '@/shared/components/ui';
import type { Robot, RobotTelemetry } from '../types/robots.types';

export interface RobotQuickStatsProps {
  /** Robot data */
  robot: Robot;
  /** Live telemetry data */
  telemetry?: RobotTelemetry | null;
  /** Whether telemetry stream is connected */
  isTelemetryConnected: boolean;
  /** Additional class names */
  className?: string;
}

// Short on purpose: the tile hint truncates at phone width, and the offline
// hint above the tiles already says how to start the robot agent.
const NO_TELEMETRY = 'Awaiting telemetry';
const ICON = 'h-4 w-4';

function batteryTone(level: number | null, live: boolean): Tone {
  if (level == null || !live) return 'neutral';
  if (level < 10) return 'stopped';
  if (level < 20) return 'gated';
  return 'live';
}

function round(value: number | null | undefined): string | null {
  return value == null || Number.isNaN(value) ? null : value.toFixed(0);
}

/** Four StatTiles summarising one robot. */
export const RobotQuickStats = memo(function RobotQuickStats({
  robot,
  telemetry,
  isTelemetryConnected,
  className,
}: RobotQuickStatsProps) {
  const live = Boolean(telemetry) && robot.status !== 'offline';
  const acPowered = robot.metadata?.powerSource === 'ac_powered';
  const battery = telemetry?.batteryLevel ?? robot.batteryLevel;
  const temperature = live ? round(telemetry?.temperature) : null;
  const cpu = live ? round(telemetry?.cpuUsage) : null;
  const measured = isTelemetryConnected ? 'Measured live' : 'Last telemetry frame';

  return (
    <StatRow columns={4} className={className}>
      <StatTile
        label="Battery"
        icon={<BatteryMedium className={ICON} strokeWidth={1.75} />}
        value={acPowered ? 'AC' : (round(battery) ?? '—')}
        unit={!acPowered && battery != null ? '%' : undefined}
        progress={!acPowered && battery != null ? battery : undefined}
        tone={batteryTone(battery, live)}
        hint={acPowered ? 'Mains powered' : live ? measured : battery != null ? 'Last reported' : NO_TELEMETRY}
      />
      <StatTile
        label="Temperature"
        icon={<Thermometer className={ICON} strokeWidth={1.75} />}
        value={temperature ?? '—'}
        unit={temperature ? '°C' : undefined}
        hint={temperature ? measured : NO_TELEMETRY}
      />
      <StatTile
        label="CPU"
        icon={<Cpu className={ICON} strokeWidth={1.75} />}
        value={cpu ?? '—'}
        unit={cpu ? '%' : undefined}
        hint={cpu ? measured : NO_TELEMETRY}
      />
      <StatTile
        label="Current task"
        icon={<ListChecks className={ICON} strokeWidth={1.75} />}
        value={robot.currentTaskName || 'None'}
        hint={robot.currentTaskName ? 'Running now' : 'Idle — no task assigned'}
      />
    </StatRow>
  );
});
