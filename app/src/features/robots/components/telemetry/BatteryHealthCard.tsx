/**
 * @file BatteryHealthCard.tsx
 * @description Battery health card — SOC gauge plus SOH, current, temperature, cell voltages, cycles
 * @feature robots
 */

import { memo } from 'react';
import { Card } from '@/shared/components/ui';
import { BatteryGauge } from '../BatteryGauge';
import { SimBadge } from '../SimBadge';
import type { RobotTelemetry } from '../../types/robots.types';

// ============================================================================
// SUB-VALUE
// ============================================================================

function HealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-subtle p-2.5 rounded-lg">
      <span className="card-label">{label}</span>
      <p className="font-mono text-sm font-semibold text-theme-primary">{value}</p>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface BatteryHealthCardProps {
  /** Current telemetry frame (reads `telemetry.battery`) */
  telemetry: RobotTelemetry;
  /** Whether the robot is currently charging (drives the gauge animation) */
  charging?: boolean;
}

/**
 * BMS battery-health card. Renders nothing without `telemetry.battery`;
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

  const metrics: Array<{ label: string; value: string }> = [];
  if (battery.soh != null) {
    metrics.push({ label: 'SOH', value: `${battery.soh.toFixed(0)}%` });
  }
  if (battery.current != null) {
    // Signed: positive = charging, negative = discharging.
    metrics.push({
      label: battery.current >= 0 ? 'Current (charge)' : 'Current (discharge)',
      value: `${battery.current >= 0 ? '+' : ''}${battery.current.toFixed(1)} A`,
    });
  }
  if (battery.temperature != null) {
    metrics.push({ label: 'Temperature', value: `${battery.temperature.toFixed(1)}°C` });
  }
  if (cellMin !== null && cellMax !== null) {
    metrics.push({ label: 'Cell min / max', value: `${cellMin.toFixed(2)} / ${cellMax.toFixed(2)} V` });
  }
  if (battery.cycles != null) {
    metrics.push({ label: 'Cycles', value: `${battery.cycles}` });
  }

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-theme-primary">Battery Health</h2>
          <SimBadge telemetry={telemetry} group="battery" />
        </div>
      </Card.Header>
      <Card.Body>
        <div className="flex items-center gap-6 p-4 rounded-xl glass-subtle">
          <BatteryGauge
            level={battery.soc}
            voltage={battery.voltage}
            temperature={battery.temperature}
            charging={charging}
            size="lg"
            showDetails
          />
          <div className="flex-1">
            <div className="text-sm text-theme-secondary mb-1">State of Charge</div>
            <div className="text-lg font-semibold text-theme-primary">
              {battery.soc.toFixed(0)}%
            </div>
          </div>
        </div>
        {metrics.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {metrics.map((m) => (
              <HealthMetric key={m.label} label={m.label} value={m.value} />
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
});
