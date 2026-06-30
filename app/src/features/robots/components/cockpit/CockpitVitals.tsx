/**
 * @file CockpitVitals.tsx
 * @description Compact telemetry rail for the cockpit — battery, compute, thermal,
 *   motion and joint count as monospace readouts. Reads the live telemetry stream
 *   and degrades to placeholder dashes when the link is down.
 * @feature robots
 */

import { memo } from 'react';
import { Cpu, MemoryStick, Thermometer, Gauge, Bone, Activity } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { BatteryGauge } from '../BatteryGauge';
import type { RobotTelemetry } from '../../types/robots.types';

export interface CockpitVitalsProps {
  telemetry: RobotTelemetry | null;
  connected: boolean;
  lastUpdate: Date | null;
  className?: string;
}

function fmt(value: number | null | undefined, unit = '', digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}${unit}`;
}

/** Colour a 0–100 utilisation reading green → amber → red. */
function loadColor(v: number | undefined): string {
  if (v === undefined) return 'text-theme-secondary';
  if (v >= 85) return 'text-red-400';
  if (v >= 65) return 'text-amber-400';
  return 'text-[#18E4C3]';
}

export const CockpitVitals = memo(function CockpitVitals({
  telemetry,
  connected,
  lastUpdate,
  className,
}: CockpitVitalsProps) {
  const t = telemetry;
  const jointCount = t?.jointStates?.length ?? 0;

  return (
    <div
      className={cn(
        'rounded-2xl border border-theme bg-theme-card/40 px-4 py-3',
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-theme-secondary">
          <Activity className="h-3.5 w-3.5" /> Vitals
        </span>
        <span className="font-mono text-[10px] text-theme-tertiary">
          {connected && lastUpdate ? `updated ${lastUpdate.toLocaleTimeString()}` : 'link down'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        {/* Battery */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wide text-theme-tertiary">Power</span>
          <BatteryGauge
            level={t?.batteryLevel ?? null}
            voltage={t?.batteryVoltage}
            temperature={t?.batteryTemperature}
            powerSource={t?.powerSource}
            size="sm"
          />
        </div>

        <Stat icon={<Cpu className="h-3.5 w-3.5" />} label="CPU" value={fmt(t?.cpuUsage, '%')} valueClass={loadColor(t?.cpuUsage)} bar={t?.cpuUsage} />
        <Stat icon={<MemoryStick className="h-3.5 w-3.5" />} label="Memory" value={fmt(t?.memoryUsage, '%')} valueClass={loadColor(t?.memoryUsage)} bar={t?.memoryUsage} />
        <Stat icon={<Thermometer className="h-3.5 w-3.5" />} label="Temp" value={fmt(t?.temperature, '°C')} />
        <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="Speed" value={fmt(t?.speed, ' m/s', 2)} />
        <Stat icon={<Bone className="h-3.5 w-3.5" />} label="Joints" value={jointCount ? String(jointCount) : '—'} />
      </div>
    </div>
  );
});

function Stat({
  icon,
  label,
  value,
  valueClass,
  bar,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  bar?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-theme-tertiary">
        {icon} {label}
      </span>
      <span className={cn('font-mono text-lg leading-none', valueClass ?? 'text-theme-primary')}>{value}</span>
      {bar !== undefined && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-theme-secondary/15">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              bar >= 85 ? 'bg-red-400' : bar >= 65 ? 'bg-amber-400' : 'bg-[#18E4C3]',
            )}
            style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}
          />
        </div>
      )}
    </div>
  );
}
