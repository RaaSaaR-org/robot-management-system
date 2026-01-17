/**
 * @file SkillStatusBadge.tsx
 * @description Status badge for skill status display
 * @feature deployment
 */

import { Badge, type BadgeVariant } from '@/shared/components/ui';
import type { SkillStatus } from '../types';
import { SKILL_STATUS_LABELS } from '../types';

export interface SkillStatusBadgeProps {
  status: SkillStatus;
  showDot?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const statusToVariant: Record<SkillStatus, BadgeVariant> = {
  draft: 'default',
  published: 'success',
  deprecated: 'warning',
  archived: 'error',
};

export function SkillStatusBadge({
  status,
  showDot = false,
  size = 'md',
}: SkillStatusBadgeProps) {
  return (
    <Badge variant={statusToVariant[status]} size={size} dot={showDot}>
      {SKILL_STATUS_LABELS[status]}
    </Badge>
  );
}
