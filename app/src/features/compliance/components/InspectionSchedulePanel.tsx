/**
 * @file InspectionSchedulePanel.tsx
 * @description Inspections view: DGUV Vorschrift 3 and ISO 10218 inspection
 *              schedules per robot, with due dates and status.
 * @feature compliance
 */

import { useEffect } from 'react';
import { Wrench } from 'lucide-react';
import { StatusTag, type DataTableColumn } from '@/shared/components/ui';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { INSPECTION_TYPE_LABELS, type InspectionSchedule } from '../types';
import { ObligationTable } from './ObligationTable';
import { complianceTone, formatDate, formatDays, humanize } from './complianceFormat';

export interface InspectionSchedulePanelProps {
  className?: string;
}

const STATUS_OPTIONS = [
  { value: 'current', label: 'Current' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'overdue', label: 'Overdue' },
];

export function InspectionSchedulePanel({ className }: InspectionSchedulePanelProps) {
  const {
    inspectionSchedules, inspectionSummary, isLoadingInspections, error, fetchInspectionSchedules, fetchInspectionSummary,
  } = useComplianceTrackerStore();

  useEffect(() => {
    void fetchInspectionSchedules();
    void fetchInspectionSummary();
  }, [fetchInspectionSchedules, fetchInspectionSummary]);

  const summary = inspectionSummary
    ? `${inspectionSummary.overdue} overdue · ${inspectionSummary.dueSoon} due soon · ${inspectionSummary.current} current`
    : `${inspectionSchedules.length} scheduled`;

  const columns: DataTableColumn<InspectionSchedule>[] = [
    {
      key: 'inspectionType', header: 'Inspection', sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="text-sm text-ink-primary">{INSPECTION_TYPE_LABELS[r.inspectionType] ?? humanize(r.inspectionType)}</div>
          <div className="text-[13px] text-ink-tertiary">Every {r.intervalYears} {r.intervalYears === 1 ? 'year' : 'years'}</div>
        </div>
      ),
    },
    {
      key: 'robotId', header: 'Robot', hideBelow: 'sm',
      cell: (r) => (r.robotName ?? r.robotId ? <span title={r.robotId}>{r.robotName ?? <code className="font-mono text-[13px]">{r.robotId}</code>}</span> : 'Whole fleet'),
    },
    { key: 'lastInspectionDate', header: 'Last', sortable: true, hideBelow: 'lg', sortValue: (r) => new Date(r.lastInspectionDate), cell: (r) => formatDate(r.lastInspectionDate) },
    {
      key: 'nextDueDate', header: 'Next due', sortable: true, sortValue: (r) => new Date(r.nextDueDate),
      cell: (r) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(r.nextDueDate)} · {formatDays(r.daysUntilDue)}</span>,
    },
    { key: 'inspectorName', header: 'Inspector', hideBelow: 'lg' },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag tone={complianceTone(r.status)}>{humanize(r.status)}</StatusTag> },
  ];

  return (
    <div className={className}>
      <ObligationTable
        noun="inspections"
        title="Inspection schedule"
        description={summary}
        rows={inspectionSchedules}
        columns={columns}
        getRowId={(r) => r.id}
        searchText={(r) => `${INSPECTION_TYPE_LABELS[r.inspectionType] ?? r.inspectionType} ${r.robotName ?? ''} ${r.robotId ?? ''} ${r.inspectorName ?? ''}`}
        statusOf={(r) => r.status}
        statusOptions={STATUS_OPTIONS}
        defaultSort={{ key: 'nextDueDate', direction: 'asc' }}
        isLoading={isLoadingInspections}
        error={error}
        onRetry={() => void fetchInspectionSchedules()}
        emptyIcon={<Wrench />}
        emptyTitle="No inspections scheduled"
        emptyDescription="Recurring inspections (electrical safety, force verification, safety functions) are scheduled on the server and listed here."
      />
    </div>
  );
}
