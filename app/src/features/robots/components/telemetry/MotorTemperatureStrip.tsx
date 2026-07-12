/**
 * @file MotorTemperatureStrip.tsx
 * @description Compact heatmap strip of per-joint motor temperatures with warning colors ≥60°C
 * @feature robots
 */

import { memo, useMemo } from 'react';
import { Card, Tooltip } from '@/shared/components/ui';
import { SimBadge } from '../SimBadge';
import {
  MOTOR_TEMP_WARNING_C,
  motorTempColor,
  motorTempTextClass,
} from '../../utils/temperature';
import type { RobotTelemetry } from '../../types/robots.types';

// ============================================================================
// HELPERS
// ============================================================================

/** "left_shoulder_pitch_joint" → "Left Shoulder Pitch" */
function formatJointName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/joint$/i, '')
    .trim()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface MotorTemperatureStripProps {
  /** Current telemetry frame (reads `telemetry.motorTemperatures`) */
  telemetry: RobotTelemetry;
}

/**
 * Heatmap strip of all joints from `motorTemperatures` (name → °C).
 * Each cell is colored on the ok→warning scale (warning at ≥60°C) and shows
 * joint name + value in a tooltip. Renders nothing without data.
 */
export const MotorTemperatureStrip = memo(function MotorTemperatureStrip({
  telemetry,
}: MotorTemperatureStripProps) {
  const motorTemperatures = telemetry.motorTemperatures;

  const entries = useMemo(
    () => Object.entries(motorTemperatures ?? {}),
    [motorTemperatures]
  );

  if (entries.length === 0) return null;

  const temps = entries.map(([, t]) => t);
  const maxTemp = Math.max(...temps);
  const hotCount = temps.filter((t) => t >= MOTOR_TEMP_WARNING_C).length;

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-theme-primary">Motor Temperatures</h2>
            <SimBadge telemetry={telemetry} group="motorTemperatures" />
          </div>
          <span className="text-xs text-theme-tertiary">
            max{' '}
            <span className={`font-mono font-semibold ${motorTempTextClass(maxTemp)}`}>
              {maxTemp.toFixed(0)}°C
            </span>
            {hotCount > 0 && (
              <span className="ml-2 text-yellow-600 dark:text-yellow-400">
                {hotCount} ≥ {MOTOR_TEMP_WARNING_C}°C
              </span>
            )}
          </span>
        </div>
      </Card.Header>
      <Card.Body>
        <div className="flex flex-wrap gap-1" role="list" aria-label="Per-joint motor temperatures">
          {entries.map(([name, temp]) => (
            <Tooltip key={name} content={`${formatJointName(name)}: ${temp.toFixed(1)}°C`}>
              <div
                role="listitem"
                aria-label={`${formatJointName(name)}: ${temp.toFixed(1)} degrees Celsius`}
                className="w-4 h-7 rounded-sm cursor-default transition-colors duration-300 hover:ring-1 hover:ring-[var(--border-color-strong)]"
                style={{ backgroundColor: motorTempColor(temp, 0.85) }}
              />
            </Tooltip>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-theme-tertiary">
          <span>{entries.length} joints</span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: motorTempColor(30, 0.85) }} />
            ok
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: motorTempColor(60, 0.85) }} />
            {MOTOR_TEMP_WARNING_C}°C
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: motorTempColor(80, 0.85) }} />
            hot
          </span>
        </div>
      </Card.Body>
    </Card>
  );
});
