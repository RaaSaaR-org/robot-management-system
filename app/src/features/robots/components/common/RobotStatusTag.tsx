/**
 * @file RobotStatusTag.tsx
 * @description The one way to show a robot's operational status: a kit StatusTag
 *   with the robot-specific tone map (protective stop reads as stopped, busy as sim).
 * @feature robots
 */

import { StatusTag, type Tone } from '@/shared/components/ui';
import {
  ROBOT_PROVISIONING_LABELS,
  ROBOT_STATUS_LABELS,
  type RobotProvisioningState,
  type RobotStatus,
} from '../../types/robots.types';

export interface RobotStatusTagProps {
  status: RobotStatus | string;
  /**
   * Set for an expected robot (`robotProvisioning(robot)?.state`): it reads
   * "Not connected" or "Arriving" — it was never online, so "Offline" would
   * suggest something stopped working.
   */
  provisioning?: RobotProvisioningState | null;
  size?: 'sm' | 'md';
  className?: string;
}

const TONES: Record<string, Tone> = {
  online: 'live',
  busy: 'sim',
  charging: 'gated',
  maintenance: 'gated',
  protective_stop: 'stopped',
  error: 'stopped',
  estop: 'stopped',
  offline: 'neutral',
};

const EXTRA_LABELS: Record<string, string> = {
  protective_stop: 'Protective stop',
  estop: 'E-stop',
};

/** Robot status as a dotted StatusTag. */
export function RobotStatusTag({ status, provisioning, size, className }: RobotStatusTagProps) {
  const key = String(status).toLowerCase();
  if (provisioning && key === 'offline') {
    return (
      <StatusTag tone="neutral" size={size} className={className}>
        {ROBOT_PROVISIONING_LABELS[provisioning]}
      </StatusTag>
    );
  }
  const label =
    EXTRA_LABELS[key] ??
    (ROBOT_STATUS_LABELS as Record<string, string>)[key] ??
    key.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return (
    <StatusTag tone={TONES[key] ?? 'neutral'} dot size={size} className={className}>
      {label}
    </StatusTag>
  );
}
