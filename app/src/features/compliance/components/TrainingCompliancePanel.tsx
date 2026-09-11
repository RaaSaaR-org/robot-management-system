/**
 * @file TrainingCompliancePanel.tsx
 * @description Training view: operator training records (DGUV) with expiry
 *              and status.
 * @feature compliance
 */

import { useEffect } from 'react';
import { GraduationCap } from 'lucide-react';
import { StatusTag, type DataTableColumn } from '@/shared/components/ui';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { TRAINING_TYPE_LABELS, type TrainingRecord } from '../types';
import { ObligationTable } from './ObligationTable';
import { complianceTone, formatDate, formatDays, humanize } from './complianceFormat';

export interface TrainingCompliancePanelProps {
  className?: string;
}

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Valid' },
  { value: 'expiring_soon', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
];

export function TrainingCompliancePanel({ className }: TrainingCompliancePanelProps) {
  const {
    trainingRecords, trainingSummary, isLoadingTraining, error, fetchTrainingRecords, fetchTrainingSummary,
  } = useComplianceTrackerStore();

  useEffect(() => {
    void fetchTrainingRecords();
    void fetchTrainingSummary();
  }, [fetchTrainingRecords, fetchTrainingSummary]);

  const summary = trainingSummary
    ? `${trainingSummary.expired} expired · ${trainingSummary.expiringSoon} expiring soon · ${trainingSummary.totalEmployees} people`
    : `${trainingRecords.length} records`;

  const columns: DataTableColumn<TrainingRecord>[] = [
    {
      key: 'userName', header: 'Person', sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-sm text-ink-primary">{r.userName}</div>
          {r.userEmail && <div className="truncate text-[13px] text-ink-tertiary">{r.userEmail}</div>}
        </div>
      ),
    },
    { key: 'trainingType', header: 'Training', sortable: true, cell: (r) => TRAINING_TYPE_LABELS[r.trainingType] ?? humanize(r.trainingType) },
    { key: 'trainingProvider', header: 'Provider', hideBelow: 'lg' },
    { key: 'completedAt', header: 'Completed', sortable: true, hideBelow: 'md', sortValue: (r) => new Date(r.completedAt), cell: (r) => formatDate(r.completedAt) },
    {
      key: 'expiresAt', header: 'Expires', sortable: true, hideBelow: 'sm', sortValue: (r) => new Date(r.expiresAt),
      cell: (r) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(r.expiresAt)} · {formatDays(r.daysUntilExpiry)}</span>,
    },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag tone={complianceTone(r.status)}>{humanize(r.status)}</StatusTag> },
  ];

  return (
    <div className={className}>
      <ObligationTable
        noun="training records"
        title="Training records"
        description={summary}
        rows={trainingRecords}
        columns={columns}
        getRowId={(r) => r.id}
        searchText={(r) => `${r.userName} ${r.userEmail ?? ''} ${TRAINING_TYPE_LABELS[r.trainingType] ?? r.trainingType}`}
        statusOf={(r) => r.status}
        statusOptions={STATUS_OPTIONS}
        defaultSort={{ key: 'expiresAt', direction: 'asc' }}
        isLoading={isLoadingTraining}
        error={error}
        onRetry={() => void fetchTrainingRecords()}
        emptyIcon={<GraduationCap />}
        emptyTitle="No training records yet"
        emptyDescription="Operator trainings (robot safety, first aid, DGUV instructions) are recorded on the server and tracked here until they expire."
      />
    </div>
  );
}
