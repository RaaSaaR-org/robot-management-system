/**
 * @file SLAIndicator.tsx
 * @description SLA deadline as a StatusTag: overdue, nearing the deadline, or time left
 * @feature approvals
 */

import { StatusTag } from '@/shared/components/ui';
import type { ApprovalStatus } from '../types';
import { slaInfo } from './approvalFormat';

export interface SLAIndicatorProps {
  slaDeadline: string;
  slaHours: number;
  status: ApprovalStatus;
  className?: string;
}

export function SLAIndicator({ slaDeadline, slaHours, status, className }: SLAIndicatorProps) {
  const sla = slaInfo({ slaDeadline, slaHours, status });
  return (
    <StatusTag tone={sla.tone} className={className}>
      {sla.label}
    </StatusTag>
  );
}
