/**
 * @file DeploymentStatusBadge.tsx
 * @description Status badge for deployment status display
 * @feature deployment
 */

import { Badge, type BadgeVariant } from '@/shared/components/ui';
import type { DeploymentStatus } from '../types';
import { DEPLOYMENT_STATUS_LABELS } from '../types';

export interface DeploymentStatusBadgeProps {
  status: DeploymentStatus;
  showDot?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const statusToVariant: Record<DeploymentStatus, BadgeVariant> = {
  pending: 'default',
  deploying: 'info',
  canary: 'warning',
  production: 'success',
  rolling_back: 'warning',
  failed: 'error',
  completed: 'success',
  rolled_back: 'warning',
  cancelled: 'default',
};

const shouldPulse: Record<DeploymentStatus, boolean> = {
  pending: false,
  deploying: true,
  canary: true,
  production: false,
  rolling_back: true,
  failed: false,
  completed: false,
  rolled_back: false,
  cancelled: false,
};

export function DeploymentStatusBadge({
  status,
  showDot = true,
  size = 'md',
}: DeploymentStatusBadgeProps) {
  return (
    <Badge
      variant={statusToVariant[status]}
      size={size}
      dot={showDot}
      dotPulse={shouldPulse[status]}
    >
      {DEPLOYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
