/**
 * @file SLABadge.tsx
 * @description Badge component showing SLA status for GDPR requests
 * @feature gdpr
 */

import type { GDPRRequest } from '../types';
import { getDaysUntilDeadline, isRequestOverdue } from '../types';

export interface SLABadgeProps {
  request: GDPRRequest;
  className?: string;
}

export function SLABadge({ request, className = '' }: SLABadgeProps) {
  const isOverdue = isRequestOverdue(request);
  const daysRemaining = getDaysUntilDeadline(request);

  // Don't show for completed/cancelled/rejected
  if (['completed', 'cancelled', 'rejected'].includes(request.status)) {
    return null;
  }

  let bgColor = 'bg-green-500/20 text-green-600 dark:text-green-400';
  let label = `${daysRemaining} days remaining`;

  if (isOverdue) {
    bgColor = 'bg-red-500/20 text-red-600 dark:text-red-400';
    label = `${Math.abs(daysRemaining)} days overdue`;
  } else if (daysRemaining <= 3) {
    bgColor = 'bg-red-500/20 text-red-600 dark:text-red-400';
    label = `${daysRemaining} days remaining`;
  } else if (daysRemaining <= 7) {
    bgColor = 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400';
    label = `${daysRemaining} days remaining`;
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${bgColor} ${className}`}
    >
      {label}
    </span>
  );
}
