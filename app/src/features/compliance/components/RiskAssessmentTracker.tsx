/**
 * @file RiskAssessmentTracker.tsx
 * @description Risk assessments view: each assessment with its version,
 *              review date and status.
 * @feature compliance
 */

import { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { StatusTag, type DataTableColumn } from '@/shared/components/ui';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { RISK_ASSESSMENT_TYPE_LABELS, type RiskAssessmentTracking } from '../types';
import { ObligationTable } from './ObligationTable';
import { complianceTone, formatDate, formatDays, humanize } from './complianceFormat';

export interface RiskAssessmentTrackerProps {
  className?: string;
}

type Row = RiskAssessmentTracking;

const STATUS_OPTIONS = [
  { value: 'current', label: 'Current' },
  { value: 'review_needed', label: 'Review needed' },
  { value: 'update_required', label: 'Update required' },
];

export function RiskAssessmentTracker({ className }: RiskAssessmentTrackerProps) {
  const { riskAssessments, isLoadingRiskAssessments, error, fetchRiskAssessments } = useComplianceTrackerStore();

  useEffect(() => {
    void fetchRiskAssessments();
  }, [fetchRiskAssessments]);

  const needsReview = riskAssessments.filter((r) => r.status !== 'current').length;

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name', header: 'Assessment', sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-sm text-ink-primary">{r.name}</div>
          <div className="text-[13px] text-ink-tertiary">{RISK_ASSESSMENT_TYPE_LABELS[r.assessmentType] ?? humanize(r.assessmentType)}</div>
        </div>
      ),
    },
    { key: 'version', header: 'Version', hideBelow: 'md', cell: (r) => <code className="font-mono text-[13px] text-ink-secondary">{r.version}</code> },
    { key: 'responsiblePerson', header: 'Owner', hideBelow: 'lg' },
    {
      key: 'nextReviewDate', header: 'Next review', sortable: true, sortValue: (r) => new Date(r.nextReviewDate), hideBelow: 'sm',
      cell: (r) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(r.nextReviewDate)} · {formatDays(r.daysUntilReview)}</span>,
    },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag tone={complianceTone(r.status)}>{humanize(r.status)}</StatusTag> },
  ];

  return (
    <div className={className}>
      <ObligationTable
        noun="risk assessments"
        title="Risk assessments"
        description={`${needsReview} need review · ${riskAssessments.length - needsReview} current`}
        rows={riskAssessments}
        columns={columns}
        getRowId={(r) => r.id}
        searchText={(r) => `${r.name} ${r.description ?? ''} ${r.responsiblePerson ?? ''}`}
        statusOf={(r) => r.status}
        statusOptions={STATUS_OPTIONS}
        defaultSort={{ key: 'nextReviewDate', direction: 'asc' }}
        isLoading={isLoadingRiskAssessments}
        error={error}
        onRetry={() => void fetchRiskAssessments()}
        emptyIcon={<ShieldAlert />}
        emptyTitle="No risk assessments yet"
        emptyDescription="Risk assessments (machinery, DPIA, cybersecurity, occupational) are recorded on the server and listed here with their review dates."
      />
    </div>
  );
}
