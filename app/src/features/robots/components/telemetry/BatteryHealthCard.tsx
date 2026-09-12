/**
 * @file BatteryHealthCard.tsx
 * @description Battery health panel — SOC gauge plus SOH, current, temperature, cell voltages, cycles
 * @feature robots
 */

import { memo } from 'react';
import { Panel } from '@/shared/components/ui';
import { BatteryGauge } from '../BatteryGauge';
import { SimBadge } from '../SimBadge';
import { Readout } from '../common';
import type { RobotTelemetry } from '../../types/robots.types';

// ============================================================================
// COMPONENT
// ============================================================================

export interface BatteryHealthCardProps {
  /** Current telemetry frame (reads `telemetry.battery`) */
  telemetry: RobotTelemetry;
  /** Whether the robot is currently charging */
  charging?: boolean;
}

interface Metric {
  label: string;
  value: string;
  unit?: string;
}

/**
 * BMS battery-health panel. Renders nothing without `telemetry.battery`;
 * sub-values (SOH, current, temperature, cells, cycles) render only when present.
 */
export const BatteryHealthCard = memo(function BatteryHealthCard({
  telemetry,
  charging = false,
}: BatteryHealthCardProps) {
  const battery = telemetry.battery;
  if (!battery) return null;

  const cellMin = battery.cellVoltages?.length ? Math.min(...battery.cellVoltages) : null;
  const cellMax = battery.cellVoltages?.length ? Math.max(...battery.cellVoltages) : null;

  const metrics: Metric[] = [];
  if (battery.soh != null) {
    metrics.push({ label: 'Health', value: battery.soh.toFixed(0), unit: '%' });
  }
  if (battery.current != null) {
    // Signed: positive = charging, negative = discharging.
    metrics.push({
      label: battery.current >= 0 ? 'Charge current' : 'Discharge current',
      value: `${battery.current >= 0 ? '+' : ''}${battery.current.toFixed(1)}`,
      unit: 'A',
    });
  }
  if (battery.temperature != null) {
    metrics.push({ label: 'Temperature', value: battery.temperature.toFixed(1), unit: '°C' });
  }
  if (cellMin !== null && cellMax !== null) {
    metrics.push({ label: 'Cell min / max', value: `${cellMin.toFixed(2)} / ${cellMax.toFixed(2)}`, unit: 'V' });
  }
  if (battery.cycles != null) {
    metrics.push({ label: 'Cycles', value: `${battery.cycles}` });
  }

  return (
    <Panel>
      <Panel.Header
        title="Battery health"
        actions={<SimBadge telemetry={telemetry} group="battery" />}
      />
      <Panel.Body className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <BatteryGauge level={battery.soc} charging={charging} size="lg" />
          <Readout label="Voltage" value={battery.voltage?.toFixed(1)} unit="V" />
        </div>
        {metrics.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {metrics.map((m) => (
              <Readout key={m.label} label={m.label} value={m.value} unit={m.unit} />
            ))}
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
});
