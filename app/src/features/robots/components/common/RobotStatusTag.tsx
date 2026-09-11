/**
 * @file RobotStatusTag.tsx
 * @description The one way to show a robot's operational status: a kit StatusTag
 *   with the robot-specific tone map (protective stop reads as stopped, busy as sim).
 * @feature robots
 */

import { StatusTag, type Tone } from '@/shared/components/ui';
import { ROBOT_STATUS_LABELS, type RobotStatus } from '../../types/robots.types';

export interface RobotStatusTagProps {
  status: RobotStatus | string;
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
export function RobotStatusTag({ status, size, className }: RobotStatusTagProps) {
  const key = String(status).toLowerCase();
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
