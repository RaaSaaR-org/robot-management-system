/**
 * @file RegulatoryTimeline.tsx
 * @description Deadlines view: regulatory deadlines as a table, with an
 *              "Update progress" form that ticks off requirements.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { CalendarClock, ListChecks } from 'lucide-react';
import {
  Checkbox, FormModal, ProgressBar, StatusTag, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { COMPLIANCE_STATUS_CONFIG, REGULATORY_FRAMEWORK_LABELS, type RegulatoryDeadline } from '../types';
import { ObligationTable } from './ObligationTable';
import { complianceTone, errorMessage, formatDate, formatDays, humanize, severityTone } from './complianceFormat';

export interface RegulatoryTimelineProps {
  className?: string;
}

const STATUS_OPTIONS = (Object.keys(COMPLIANCE_STATUS_CONFIG) as (keyof typeof COMPLIANCE_STATUS_CONFIG)[]).map((s) => ({
  value: s,
  label: COMPLIANCE_STATUS_CONFIG[s].label,
}));

function progressOf(d: RegulatoryDeadline): number {
  return d.requirements.length ? Math.round((d.completedRequirements.length / d.requirements.length) * 100) : 0;
}

export function RegulatoryTimeline({ className }: RegulatoryTimelineProps) {
  const { deadlines, isLoadingDeadlines, error, fetchRegulatoryDeadlines } = useComplianceTrackerStore();
  const [editing, setEditing] = useState<RegulatoryDeadline | null>(null);

  useEffect(() => {
    void fetchRegulatoryDeadlines();
  }, [fetchRegulatoryDeadlines]);

  const overdue = deadlines.filter((d) => d.status === 'overdue').length;
  const met = deadlines.filter((d) => d.status === 'compliant').length;

  const columns: DataTableColumn<RegulatoryDeadline>[] = [
    {
      key: 'name', header: 'Deadline', sortable: true,
      cell: (d) => (
        <div className="min-w-0">
          <div className="text-sm text-ink-primary">{d.name}</div>
          <div className="text-[13px] text-ink-tertiary">{REGULATORY_FRAMEWORK_LABELS[d.framework] ?? d.framework}</div>
        </div>
      ),
    },
    {
      key: 'deadline', header: 'Due', sortable: true, sortValue: (d) => new Date(d.deadline),
      cell: (d) => (
        <div className="whitespace-nowrap">
          <div className="text-sm text-ink-secondary">{formatDate(d.deadline)}</div>
          <div className="text-[13px] text-ink-tertiary">{formatDays(d.daysUntilDeadline)}</div>
        </div>
      ),
    },
    { key: 'priority', header: 'Priority', sortable: true, hideBelow: 'md', cell: (d) => <StatusTag tone={severityTone(d.priority)}>{humanize(d.priority)}</StatusTag> },
    {
      key: 'progress', header: 'Progress', hideBelow: 'sm', sortable: true, sortValue: progressOf, width: '12rem',
      cell: (d) => (
        <div className="flex min-w-[8rem] flex-col gap-1">
          <ProgressBar value={progressOf(d)} size="sm" showValue={false} />
          <span className="text-[13px] text-ink-tertiary">{d.completedRequirements.length} of {d.requirements.length} done</span>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, cell: (d) => <StatusTag tone={complianceTone(d.status)}>{COMPLIANCE_STATUS_CONFIG[d.status]?.label ?? humanize(d.status)}</StatusTag> },
  ];

  return (
    <div className={className}>
      <ObligationTable
        noun="deadlines"
        title="Regulatory deadlines"
        description={`${overdue} overdue · ${met} met · ${deadlines.length} tracked`}
        rows={deadlines}
        columns={columns}
        getRowId={(d) => d.id}
        searchText={(d) => `${d.name} ${d.description} ${REGULATORY_FRAMEWORK_LABELS[d.framework] ?? ''}`}
        statusOf={(d) => d.status}
        statusOptions={STATUS_OPTIONS}
        defaultSort={{ key: 'deadline', direction: 'asc' }}
        onRowClick={setEditing}
        rowActions={(d) => [{ label: 'Update progress', icon: <ListChecks />, onSelect: () => setEditing(d) }]}
        rowActionsLabel={(d) => `Actions for ${d.name}`}
        isLoading={isLoadingDeadlines}
        error={error}
        onRetry={() => void fetchRegulatoryDeadlines()}
        emptyIcon={<CalendarClock />}
        emptyTitle="No deadlines tracked"
        emptyDescription="Regulatory deadlines appear once compliance tracking is initialised on the server."
      />
      <DeadlineProgressModal deadline={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function DeadlineProgressModal({ deadline, onClose }: { deadline: RegulatoryDeadline | null; onClose: () => void }) {
  const updateDeadlineProgress = useComplianceTrackerStore((s) => s.updateDeadlineProgress);
  const [done, setDone] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    if (!deadline) return;
    setDone(deadline.completedRequirements);
    setFormError(undefined);
  }, [deadline]);

  const toggle = (req: string) => setDone((cur) => (cur.includes(req) ? cur.filter((r) => r !== req) : [...cur, req]));

  const handleSubmit = async () => {
    if (!deadline) return;
    setSaving(true);
    setFormError(undefined);
    try {
      await updateDeadlineProgress(deadline.id, done);
      toast.success('Deadline updated', { description: `${deadline.name}: ${done.length} of ${deadline.requirements.length} requirements met` });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={Boolean(deadline)}
      onClose={onClose}
      title={deadline ? `Update ${deadline.name}` : 'Update progress'}
      description={deadline ? `${deadline.description} Due ${formatDate(deadline.deadline)}.` : undefined}
      submitLabel="Save changes"
      submittingLabel="Saving…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-ink-primary">Requirements met</legend>
        {deadline?.requirements.length ? (
          deadline.requirements.map((req) => (
            <Checkbox key={req} label={req} checked={done.includes(req)} onChange={() => toggle(req)} />
          ))
        ) : (
          <p className="text-sm text-ink-tertiary">This deadline lists no requirements.</p>
        )}
      </fieldset>
    </FormModal>
  );
}
