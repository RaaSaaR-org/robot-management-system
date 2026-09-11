/**
 * @file FindingBadge.tsx
 * @description Status tags for patrol runs and findings: severity, finding
 *              type, run status, leg status, finding lifecycle. One renderer
 *              per value so the list, the detail and the map legend can never
 *              disagree. All of them render the kit's StatusTag.
 * @feature patrol
 */

import { memo } from 'react';
import { StatusTag, type StatusTagTone } from '@/shared/components/ui';
import type {
  PatrolFinding,
  PatrolFindingSeverity,
  PatrolFindingStatus,
  PatrolLegStatus,
  PatrolRunStatus,
} from '../types/patrol.types';
import {
  PATROL_FINDING_SEVERITY_LABELS,
  PATROL_FINDING_STATUS_LABELS,
  PATROL_FINDING_TYPE_LABELS,
  PATROL_RUN_STATUS_LABELS,
} from '../types/patrol.types';

const SEVERITY_TONE: Record<PatrolFindingSeverity, StatusTagTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

const RUN_TONE: Record<PatrolRunStatus, StatusTagTone> = {
  running: 'live',
  done: 'success',
  aborted: 'warning',
  failed: 'danger',
  skipped: 'neutral',
};

const LEG_TONE: Record<PatrolLegStatus, StatusTagTone> = {
  pending: 'neutral',
  running: 'info',
  done: 'success',
  failed: 'danger',
  skipped: 'neutral',
};

const LEG_LABEL: Record<PatrolLegStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

const FINDING_STATUS_TONE: Record<PatrolFindingStatus, StatusTagTone> = {
  candidate: 'neutral',
  open: 'info',
  acknowledged: 'neutral',
  dismissed_normal: 'success',
  escalated: 'danger',
};

export interface FindingBadgeProps {
  severity: PatrolFindingSeverity;
  /** Also print the finding type after the severity. */
  type?: PatrolFinding['type'];
  className?: string;
}

/** Severity tag (optionally "High · Door open"). */
export const FindingBadge = memo(function FindingBadge({ severity, type, className }: FindingBadgeProps) {
  const label = PATROL_FINDING_SEVERITY_LABELS[severity] ?? severity;
  return (
    <StatusTag
      tone={SEVERITY_TONE[severity] ?? 'neutral'}
      className={className}
      data-severity={severity}
      data-testid="patrol-finding-badge"
    >
      {type ? `${label} · ${PATROL_FINDING_TYPE_LABELS[type] ?? type}` : label}
    </StatusTag>
  );
});

export interface RunStatusChipProps {
  status: PatrolRunStatus;
  className?: string;
}

/** Run status tag; the running one pulses. */
export const RunStatusChip = memo(function RunStatusChip({ status, className }: RunStatusChipProps) {
  return (
    <StatusTag tone={RUN_TONE[status] ?? 'neutral'} dot pulse={status === 'running'} className={className} data-status={status}>
      {PATROL_RUN_STATUS_LABELS[status] ?? status}
    </StatusTag>
  );
});

export interface LegStatusChipProps {
  status: PatrolLegStatus;
  className?: string;
}

/** Leg status tag. */
export const LegStatusChip = memo(function LegStatusChip({ status, className }: LegStatusChipProps) {
  return (
    <StatusTag
      tone={LEG_TONE[status] ?? 'neutral'}
      size="sm"
      dot={status === 'running'}
      pulse={status === 'running'}
      className={className}
      data-status={status}
    >
      {LEG_LABEL[status] ?? status}
    </StatusTag>
  );
});

export interface FindingStatusChipProps {
  status: PatrolFindingStatus;
  className?: string;
}

/** Finding lifecycle tag. */
export const FindingStatusChip = memo(function FindingStatusChip({ status, className }: FindingStatusChipProps) {
  return (
    <StatusTag tone={FINDING_STATUS_TONE[status] ?? 'info'} className={className} data-status={status}>
      {PATROL_FINDING_STATUS_LABELS[status] ?? status}
    </StatusTag>
  );
});
