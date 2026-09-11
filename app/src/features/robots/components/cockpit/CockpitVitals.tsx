/**
 * @file CockpitVitals.tsx
 * @description The control center's vitals: battery, CPU, memory, temperature, speed
 *   and joint count as a StatRow. Every tile shows "—" and "No link" while the
 *   telemetry link is down.
 * @feature robots
 */

import { memo } from 'react';
import { Battery, Bone, Cpu, Gauge, MemoryStick, Thermometer } from 'lucide-react';
import { StatRow, StatTile, type Tone } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type { RobotTelemetry } from '../../types/robots.types';

export interface CockpitVitalsProps {
  telemetry: RobotTelemetry | null;
  connected: boolean;
  lastUpdate: Date | null;
  className?: string;
}

const ICON = 'h-4 w-4';

function num(value: number | null | undefined, digits = 0): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value.toFixed(digits);
}

/** 0–100 load: stopped at 85+, gated at 65+, otherwise untoned. */
function loadTone(v: number | null | undefined): Tone | undefined {
  if (v == null) return undefined;
  if (v >= 85) return 'stopped';
  if (v >= 65) return 'gated';
  return undefined;
}

export const CockpitVitals = memo(function CockpitVitals({
  telemetry,
  connected,
  lastUpdate,
  className,
}: CockpitVitalsProps) {
  const t = connected ? telemetry : null;
  const updated = t && lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString(UI_DATE_LOCALE)}` : 'Live';
  const hint = t ? updated : 'No link';
  const value = (v: string | null) => v ?? '—';
  const unit = (v: string | null, u: string) => (v === null ? undefined : u);

  const battery = num(t?.batteryLevel);
  const batteryTone: Tone | undefined =
    t?.batteryLevel == null ? undefined : t.batteryLevel < 10 ? 'stopped' : t.batteryLevel < 20 ? 'gated' : undefined;
  const cpu = num(t?.cpuUsage);
  const mem = num(t?.memoryUsage);
  const temp = num(t?.temperature);
  const speed = num(t?.speed, 2);
  const joints = t?.jointStates?.length ? String(t.jointStates.length) : null;
  const acPowered = t?.powerSource === 'ac_powered';

  return (
    <StatRow columns={6} className={className}>
      <StatTile
        label="Battery"
        icon={<Battery className={ICON} strokeWidth={1.75} />}
        value={acPowered ? 'AC' : value(battery)}
        unit={acPowered ? undefined : unit(battery, '%')}
        tone={batteryTone}
        progress={!acPowered && t?.batteryLevel != null ? t.batteryLevel : undefined}
        hint={t && t.batteryVoltage != null ? `${t.batteryVoltage.toFixed(1)} V` : hint}
      />
      <StatTile
        label="CPU"
        icon={<Cpu className={ICON} strokeWidth={1.75} />}
        value={value(cpu)}
        unit={unit(cpu, '%')}
        tone={loadTone(t?.cpuUsage)}
        progress={t?.cpuUsage ?? undefined}
        hint={hint}
      />
      <StatTile
        label="Memory"
        icon={<MemoryStick className={ICON} strokeWidth={1.75} />}
        value={value(mem)}
        unit={unit(mem, '%')}
        tone={loadTone(t?.memoryUsage)}
        progress={t?.memoryUsage ?? undefined}
        hint={hint}
      />
      <StatTile
        label="Temperature"
        icon={<Thermometer className={ICON} strokeWidth={1.75} />}
        value={value(temp)}
        unit={unit(temp, '°C')}
        hint={hint}
      />
      <StatTile
        label="Speed"
        icon={<Gauge className={ICON} strokeWidth={1.75} />}
        value={value(speed)}
        unit={unit(speed, 'm/s')}
        hint={hint}
      />
      <StatTile
        label="Joints"
        icon={<Bone className={ICON} strokeWidth={1.75} />}
        value={value(joints)}
        hint={joints ? 'Reporting state' : hint}
      />
    </StatRow>
  );
});
