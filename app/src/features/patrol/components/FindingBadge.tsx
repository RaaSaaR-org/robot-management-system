/**
 * @file FindingBadge.tsx
 * @description Small pills for patrol runs and findings: severity, finding
 *              type, run status, leg status. One renderer per value so the
 *              list, the detail and the map legend can never disagree.
 * @feature patrol
 */

import { memo } from 'react';
import { cn } from '@/shared/utils/cn';
import type {
  PatrolFinding,
  PatrolFindingSeverity,
  PatrolFindingStatus,
  PatrolLegStatus,
  PatrolRunStatus,
} from '../types/patrol.types';
import {
  PATROL_FINDING_STATUS_LABELS,
  PATROL_FINDING_TYPE_LABELS,
} from '../types/patrol.types';
import { legStatusStyle, runStatusStyle, severityStyle } from '../utils/patrolFormat';

const PILL = 'inline-flex items-center gap-1 rounded-brand px-2 py-0.5 text-[11px] font-medium whitespace-nowrap';

export interface FindingBadgeProps {
  severity: PatrolFindingSeverity;
  /** Also print the finding type after the severity. */
  type?: PatrolFinding['type'];
  className?: string;
}

/** Severity pill (optionally "High · Person"). */
export const FindingBadge = memo(function FindingBadge({ severity, type, className }: FindingBadgeProps) {
  const style = severityStyle(severity);
  return (
    <span className={cn(PILL, style.className, className)} data-severity={severity} data-testid="patrol-finding-badge">
      {style.label}
      {type && <span className="opacity-80">· {PATROL_FINDING_TYPE_LABELS[type] ?? type}</span>}
    </span>
  );
});

export interface RunStatusChipProps {
  status: PatrolRunStatus;
  className?: string;
}

/** Run status pill; the running one pulses. */
export const RunStatusChip = memo(function RunStatusChip({ status, className }: RunStatusChipProps) {
  const style = runStatusStyle(status);
  return (
    <span className={cn(PILL, style.className, className)} data-status={status}>
      {style.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />}
      {style.label}
    </span>
  );
});

export interface LegStatusChipProps {
  status: PatrolLegStatus;
  className?: string;
}

/** Leg status pill. */
export const LegStatusChip = memo(function LegStatusChip({ status, className }: LegStatusChipProps) {
  const style = legStatusStyle(status);
  return (
    <span className={cn(PILL, style.className, className)} data-status={status}>
      {style.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" />}
      {style.label}
    </span>
  );
});

const FINDING_STATUS_CLASS: Record<PatrolFindingStatus, string> = {
  candidate: 'glass-subtle text-theme-muted',
  open: 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-300',
  acknowledged: 'glass-subtle text-theme-secondary',
  dismissed_normal: 'bg-turquoise-500/15 text-turquoise-600 dark:text-turquoise-400',
  escalated: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

export interface FindingStatusChipProps {
  status: PatrolFindingStatus;
  className?: string;
}

/** Finding lifecycle pill. */
export const FindingStatusChip = memo(function FindingStatusChip({ status, className }: FindingStatusChipProps) {
  return (
    <span className={cn(PILL, FINDING_STATUS_CLASS[status] ?? FINDING_STATUS_CLASS.open, className)} data-status={status}>
      {PATROL_FINDING_STATUS_LABELS[status] ?? status}
    </span>
  );
});
