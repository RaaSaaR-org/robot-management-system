/**
 * @file SimBadge.tsx
 * @description "Sim" StatusTag marking telemetry field groups whose values are simulated
 * @feature robots
 */

import { memo } from 'react';
import { StatusTag, Tooltip } from '@/shared/components/ui';
import type { RobotTelemetry, TelemetryFieldGroup } from '../types/robots.types';

// ============================================================================
// HELPER
// ============================================================================

/**
 * Whether a telemetry field group is simulated for the given frame.
 *
 * Rule (TASK-184 contract §5): the group is simulated when it appears in
 * `telemetry.simulated`; if `simulated` is absent (old agent), fall back to
 * `hardwareConnected !== true`. Returns false when there is no frame at all.
 */
export function isSimulated(
  telemetry: RobotTelemetry | null | undefined,
  group: TelemetryFieldGroup
): boolean {
  if (!telemetry) return false;
  if (telemetry.simulated !== undefined) {
    return telemetry.simulated.includes(group);
  }
  return telemetry.hardwareConnected !== true;
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface SimBadgeProps {
  /** Current telemetry frame */
  telemetry: RobotTelemetry | null | undefined;
  /** Field group this badge guards */
  group: TelemetryFieldGroup;
  /** Additional class names */
  className?: string;
}

/**
 * "Sim" tag shown next to a telemetry panel/value when the underlying field
 * group is simulated rather than sourced from hardware. Renders nothing when
 * the data is real (or no frame exists yet).
 */
export const SimBadge = memo(function SimBadge({ telemetry, group, className }: SimBadgeProps) {
  if (!isSimulated(telemetry, group)) return null;

  return (
    <Tooltip content="Simulated data — no hardware source">
      <span aria-label="Simulated data — no hardware source" className={className}>
        <StatusTag tone="sim">Sim</StatusTag>
      </span>
    </Tooltip>
  );
});
