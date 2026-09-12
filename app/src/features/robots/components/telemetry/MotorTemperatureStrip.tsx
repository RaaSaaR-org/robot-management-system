/**
 * @file MotorTemperatureStrip.tsx
 * @description Compact heatmap strip of per-joint motor temperatures with warning colors ≥60°C
 * @feature robots
 */

import { memo, useMemo } from 'react';
import { Panel, StatusTag, Tooltip } from '@/shared/components/ui';
import { SimBadge } from '../SimBadge';
import { Readout } from '../common';
import {
  MOTOR_TEMP_CRITICAL_C,
  MOTOR_TEMP_WARNING_C,
  motorTempColor,
} from '../../utils/temperature';
import type { RobotTelemetry } from '../../types/robots.types';

// ============================================================================
// HELPERS
// ============================================================================

/** "left_shoulder_pitch_joint" → "Left shoulder pitch" */
function formatJointName(name: string): string {
  const words = name.replace(/_/g, ' ').replace(/joint$/i, '').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
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

  const maxTone = maxTemp >= MOTOR_TEMP_CRITICAL_C ? 'stopped' : maxTemp >= MOTOR_TEMP_WARNING_C ? 'unknown' : undefined;

  return (
    <Panel>
      <Panel.Header
        title="Motor temperatures"
        actions={
          <>
            {hotCount > 0 && (
              <StatusTag tone="gated">
                {hotCount} at {MOTOR_TEMP_WARNING_C}°C+
              </StatusTag>
            )}
            <SimBadge telemetry={telemetry} group="motorTemperatures" />
          </>
        }
      />
      <Panel.Body className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Readout label="Hottest motor" value={maxTemp.toFixed(0)} unit="°C" tone={maxTone} />
          <Readout label="Motors" value={entries.length} />
        </div>
        <div className="flex flex-wrap gap-1" role="list" aria-label="Per-joint motor temperatures">
          {entries.map(([name, temp]) => (
            <Tooltip key={name} content={`${formatJointName(name)}: ${temp.toFixed(1)}°C`}>
              <div
                role="listitem"
                aria-label={`${formatJointName(name)}: ${temp.toFixed(1)} degrees Celsius`}
                className="h-7 w-4 cursor-default rounded-[3px] transition-colors duration-300 hover:outline hover:outline-1 hover:outline-[var(--border-color-strong)]"
                style={{ backgroundColor: motorTempColor(temp, 0.85) }}
              />
            </Tooltip>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-tertiary" aria-hidden="true">
          <span className="inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: motorTempColor(30, 0.85) }} />
          OK
          <span className="ml-2 inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: motorTempColor(60, 0.85) }} />
          {MOTOR_TEMP_WARNING_C}°C
          <span className="ml-2 inline-block h-3 w-3 rounded-[3px]" style={{ backgroundColor: motorTempColor(80, 0.85) }} />
          Hot
        </div>
      </Panel.Body>
    </Panel>
  );
});
