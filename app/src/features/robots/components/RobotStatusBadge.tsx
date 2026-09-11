/**
 * @file RobotStatusBadge.tsx
 * @description Compatibility wrapper: robot status now renders through RobotStatusTag
 * @feature robots
 */

import { RobotStatusTag } from './common/RobotStatusTag';
import type { RobotStatus } from '../types/robots.types';

export interface RobotStatusBadgeProps {
  /** Robot status */
  status: RobotStatus;
  /** Tag size (legacy 'lg' maps to 'md') */
  size?: 'sm' | 'md' | 'lg';
  /** Kept for compatibility; the label always shows */
  showLabel?: boolean;
  /** Kept for compatibility; status tags do not pulse */
  showPulse?: boolean;
  /** Additional class names */
  className?: string;
}

/** Robot status tag. Prefer `RobotStatusTag` in new code. */
export function RobotStatusBadge({ status, size = 'sm', className }: RobotStatusBadgeProps) {
  return <RobotStatusTag status={status} size={size === 'sm' ? 'sm' : 'md'} className={className} />;
}
