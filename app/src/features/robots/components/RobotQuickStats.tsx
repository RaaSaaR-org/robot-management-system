/**
 * @file RobotQuickStats.tsx
 * @description Horizontal strip of key robot metrics displayed as small pill cards
 * @feature robots
 */

import { memo, type ReactNode } from 'react';
import { cn } from '@/shared/utils';
import { brandColors } from '@/brand';
import { SimBadge } from './SimBadge';
import type { Robot, RobotTelemetry } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotQuickStatsProps {
  /** Robot data */
  robot: Robot;
  /** Live telemetry data */
  telemetry?: RobotTelemetry | null;
  /** Number of active tasks */
  taskCount: number;
  /** Whether telemetry stream is connected */
  isTelemetryConnected: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function getColor(value: number | null | undefined, type: 'battery' | 'cpu' | 'memory' | 'temp'): string {
  if (value === null || value === undefined) return 'rgba(107,114,128,0.7)'; // gray
  const thresholds = {
    battery: { good: 50, warn: 20, higherIsBetter: true },
    cpu:     { good: 70, warn: 90, higherIsBetter: false },
    memory:  { good: 70, warn: 90, higherIsBetter: false },
    temp:    { good: 50, warn: 70, higherIsBetter: false },
  };
  const t = thresholds[type];
  if (t.higherIsBetter) {
    if (value > t.good) return '#22c55e';
    if (value > t.warn) return '#eab308';
    return '#ef4444';
  } else {
    if (value < t.good) return '#22c55e';
    if (value < t.warn) return '#eab308';
    return '#ef4444';
  }
}

// ============================================================================
// STAT PILL
// ============================================================================

interface StatPillProps {
  label: string;
  value: string;
  color: string;
  icon: ReactNode;
  /** Optional marker rendered after the label (e.g. a SIM badge) */
  badge?: ReactNode;
}

function StatPill({ label, value, color, icon, badge }: StatPillProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg flex-shrink-0',
        'glass-subtle border border-[rgba(255,255,255,0.05)]'
      )}
    >
      <span style={{ color }} className="flex-shrink-0">
        {icon}
      </span>
      <div>
        <p className="text-[10px] text-theme-tertiary uppercase tracking-wide leading-none mb-0.5">
          {label}
          {badge}
        </p>
        <p className="font-mono text-sm font-semibold leading-none" style={{ color }}>
          {value}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// ICONS (inline SVG, 14x14)
// ============================================================================

const BatteryIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 10.5h.375c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125H21M3.75 18h15A2.25 2.25 0 0021 15.75v-6a2.25 2.25 0 00-2.25-2.25h-15A2.25 2.25 0 001.5 9.75v6A2.25 2.25 0 003.75 18z" />
  </svg>
);

const CpuIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
  </svg>
);

const TempIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
  </svg>
);

const SpeedIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
  </svg>
);

const PositionIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
  </svg>
);

const TaskIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const MemIcon = (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 6c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Horizontal scrollable strip of key robot metrics as pill cards.
 * Shows "N/A" in gray when offline or data unavailable.
 */
export const RobotQuickStats = memo(function RobotQuickStats({
  robot,
  telemetry,
  taskCount,
  isTelemetryConnected,
  className,
}: RobotQuickStatsProps) {
  const na = 'N/A';
  const offline = !isTelemetryConnected && !telemetry;

  const battery = telemetry?.batteryLevel ?? robot.batteryLevel;
  const isAcPowered =
    telemetry?.powerSource === 'ac_powered' ||
    robot.metadata?.powerSource === 'ac_powered' ||
    battery === null;

  const batteryValue = isAcPowered ? 'AC' : (battery !== null && battery !== undefined ? `${battery.toFixed(0)}%` : na);
  const batteryColor = isAcPowered ? '#22c55e' : getColor(battery, 'battery');

  const cpuValue = offline ? na : (telemetry?.cpuUsage !== undefined ? `${telemetry.cpuUsage.toFixed(0)}%` : na);
  const cpuColor = offline ? 'rgba(107,114,128,0.7)' : getColor(telemetry?.cpuUsage, 'cpu');

  const memValue = offline ? na : (telemetry?.memoryUsage !== undefined ? `${telemetry.memoryUsage.toFixed(0)}%` : na);
  const memColor = offline ? 'rgba(107,114,128,0.7)' : getColor(telemetry?.memoryUsage, 'memory');

  const tempValue = offline ? na : (telemetry?.temperature !== undefined ? `${telemetry.temperature.toFixed(0)}°C` : na);
  const tempColor = offline ? 'rgba(107,114,128,0.7)' : getColor(telemetry?.temperature, 'temp');

  // Odometry (TASK-184): prefer real base velocity for the speed pill and show
  // the world position when the frame carries odometry.
  const odometry = telemetry?.odometry ?? null;
  const odomSpeed = odometry?.velocity
    ? Math.sqrt(
        odometry.velocity[0] ** 2 + odometry.velocity[1] ** 2 + odometry.velocity[2] ** 2
      )
    : null;
  const speedSource = odomSpeed ?? telemetry?.speed;
  const speedValue = speedSource !== undefined && speedSource !== null ? `${speedSource.toFixed(1)} m/s` : na;
  const speedColor = speedSource !== undefined && speedSource !== null ? brandColors().accent : 'rgba(107,114,128,0.7)';

  const positionValue = odometry
    ? `${odometry.position[0].toFixed(1)}, ${odometry.position[1].toFixed(1)}, ${odometry.position[2].toFixed(1)} m`
    : null;

  const odomBadge = <SimBadge telemetry={telemetry} group="odometry" className="ml-1 align-middle" />;

  const taskColor = taskCount > 0 ? '#2A5FFF' : 'rgba(184,187,194,0.7)';

  return (
    <div
      className={cn(
        'flex gap-3 overflow-x-auto scrollbar-hide py-1',
        className
      )}
    >
      <StatPill label="Battery" value={batteryValue} color={batteryColor} icon={BatteryIcon} />
      <StatPill label="CPU" value={cpuValue} color={cpuColor} icon={CpuIcon} />
      <StatPill label="Memory" value={memValue} color={memColor} icon={MemIcon} />
      <StatPill label="Temp" value={tempValue} color={tempColor} icon={TempIcon} />
      <StatPill
        label="Speed"
        value={speedValue}
        color={speedColor}
        icon={SpeedIcon}
        badge={odomSpeed !== null ? odomBadge : undefined}
      />
      {positionValue && (
        <StatPill
          label="Position"
          value={positionValue}
          color={brandColors().accent}
          icon={PositionIcon}
          badge={odomBadge}
        />
      )}
      <StatPill label="Tasks" value={String(taskCount)} color={taskColor} icon={TaskIcon} />
    </div>
  );
});
