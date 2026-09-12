/**
 * @file GapAnalysisPanel.tsx
 * @description Gap analysis view: open and closed compliance gaps with
 *              framework, severity and status filters, a detail modal and
 *              a "Close gap" form.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import {
  Button, FormField, FormModal, Input, KeyValueList, Modal, Select, StatusTag, errorMessage, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import {
  GAP_SEVERITY_CONFIG, REGULATORY_FRAMEWORK_LABELS, type ComplianceGap, type GapSeverity, type RegulatoryFramework,
} from '../types';
import { ObligationTable } from './ObligationTable';
import { complianceTone, formatDate, formatDays, humanize } from './complianceFormat';

export interface GapAnalysisPanelProps {
  className?: string;
}

type Gap = ComplianceGap & { daysUntilDue: number | null; status: 'open' | 'in_progress' | 'closed' };

const FRAMEWORK_OPTIONS = (Object.keys(REGULATORY_FRAMEWORK_LABELS) as RegulatoryFramework[]).map((f) => ({
  value: f, label: REGULATORY_FRAMEWORK_LABELS[f],
}));
const SEVERITY_OPTIONS = (Object.keys(GAP_SEVERITY_CONFIG) as GapSeverity[]).map((s) => ({ value: s, label: GAP_SEVERITY_CONFIG[s].label }));
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

export function GapAnalysisPanel({ className }: GapAnalysisPanelProps) {
  const { gaps, gapFilters, isLoadingGaps, error, fetchGaps, fetchGapSummary, setGapFilters } = useComplianceTrackerStore();
  const [detail, setDetail] = useState<Gap | null>(null);
  const [closing, setClosing] = useState<Gap | null>(null);

  useEffect(() => {
    void fetchGaps();
    void fetchGapSummary();
  }, [fetchGaps, fetchGapSummary]);

  const rows = gaps as Gap[];
  const critical = rows.filter((g) => g.severity === 'critical' && g.status !== 'closed').length;
  const open = rows.filter((g) => g.status !== 'closed').length;
  const hasServerFilters = Boolean(gapFilters.framework || gapFilters.severity || (gapFilters.status && gapFilters.status !== 'open'));

  const columns: DataTableColumn<Gap>[] = [
    {
      key: 'requirement', header: 'Requirement', sortable: true,
      cell: (g) => (
        <div className="min-w-0">
          <div className="text-sm text-ink-primary">{g.requirement}</div>
          <div className="text-[13px] text-ink-tertiary">{g.articleReference}</div>
        </div>
      ),
    },
    { key: 'framework', header: 'Framework', sortable: true, hideBelow: 'md', cell: (g) => REGULATORY_FRAMEWORK_LABELS[g.framework] ?? g.framework },
    {
      key: 'severity', header: 'Severity', sortable: true,
      sortValue: (g) => ['low', 'medium', 'high', 'critical'].indexOf(g.severity),
      cell: (g) => <StatusTag tone={GAP_SEVERITY_CONFIG[g.severity]?.tone ?? 'neutral'}>{GAP_SEVERITY_CONFIG[g.severity]?.label ?? g.severity}</StatusTag>,
    },
    { key: 'status', header: 'Status', sortable: true, cell: (g) => <StatusTag tone={complianceTone(g.status)}>{humanize(g.status)}</StatusTag> },
    {
      key: 'dueDate', header: 'Due', sortable: true, hideBelow: 'sm', sortValue: (g) => (g.dueDate ? new Date(g.dueDate) : null),
      cell: (g) => (g.dueDate ? <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(g.dueDate)} · {formatDays(g.daysUntilDue)}</span> : null),
    },
  ];

  return (
    <div className={className}>
      <ObligationTable
        noun="gaps"
        title="Compliance gaps"
        description={`${open} open · ${critical} critical`}
        rows={rows}
        columns={columns}
        getRowId={(g) => g.id}
        searchText={(g) => `${g.requirement} ${g.articleReference} ${g.description}`}
        extraFilters={
          <>
            <Select aria-label="Framework" fullWidth={false} className="w-48" placeholder="All frameworks" options={FRAMEWORK_OPTIONS}
              value={gapFilters.framework ?? ''} onChange={(e) => setGapFilters({ framework: (e.target.value || undefined) as RegulatoryFramework | undefined })} />
            <Select aria-label="Severity" fullWidth={false} className="w-40" placeholder="All severities" options={SEVERITY_OPTIONS}
              value={gapFilters.severity ?? ''} onChange={(e) => setGapFilters({ severity: (e.target.value || undefined) as GapSeverity | undefined })} />
            <Select aria-label="Status" fullWidth={false} className="w-32" options={STATUS_OPTIONS}
              value={gapFilters.status ?? 'open'} onChange={(e) => setGapFilters({ status: e.target.value as 'open' | 'closed' | 'all' })} />
          </>
        }
        hasExtraFilters={hasServerFilters}
        onClearExtraFilters={() => setGapFilters({ framework: undefined, severity: undefined, status: undefined })}
        defaultSort={{ key: 'severity', direction: 'desc' }}
        onRowClick={setDetail}
        rowActions={(g) => [{ label: 'Close gap', icon: <CheckCircle2 />, disabled: g.status === 'closed', onSelect: () => setClosing(g) }]}
        rowActionsLabel={(g) => `Actions for ${g.requirement}`}
        isLoading={isLoadingGaps}
        error={error}
        onRetry={() => void fetchGaps()}
        emptyIcon={<ClipboardCheck />}
        emptyTitle="No open gaps"
        emptyDescription="Gaps are requirements a framework asks for that the fleet does not meet yet. None are recorded."
      />

      <Modal
        isOpen={Boolean(detail)}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail?.requirement}
        description={detail ? `${REGULATORY_FRAMEWORK_LABELS[detail.framework] ?? detail.framework} · ${detail.articleReference}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            {detail && detail.status !== 'closed' && (
              <Button onClick={() => { setClosing(detail); setDetail(null); }}>Close gap</Button>
            )}
          </>
        }
      >
        {detail && (
          <div className="flex flex-col gap-4">
            <p className="max-w-[70ch] text-sm text-ink-secondary">{detail.description}</p>
            <KeyValueList
              items={[
                { label: 'Severity', value: GAP_SEVERITY_CONFIG[detail.severity]?.label },
                { label: 'Status', value: humanize(detail.status) },
                { label: 'Current state', value: detail.currentState },
                { label: 'Target state', value: detail.targetState },
                { label: 'Remediation', value: detail.remediation },
                { label: 'Effort', value: humanize(detail.estimatedEffort) },
                { label: 'Assigned to', value: detail.assignedTo },
                { label: 'Due', value: detail.dueDate ? formatDate(detail.dueDate) : undefined },
              ]}
            />
          </div>
        )}
      </Modal>

      <CloseGapModal gap={closing} onClose={() => setClosing(null)} />
    </div>
  );
}

function CloseGapModal({ gap, onClose }: { gap: Gap | null; onClose: () => void }) {
  const closeGap = useComplianceTrackerStore((s) => s.closeGap);
  const [closedBy, setClosedBy] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!gap) return;
    setClosedBy('');
    setFieldError(undefined);
    setFormError(undefined);
  }, [gap]);

  const handleSubmit = async () => {
    if (!gap) return;
    if (!closedBy.trim()) {
      setFieldError('Name the person who verified the fix.');
      return;
    }
    setSaving(true);
    try {
      await closeGap(gap.id, closedBy.trim());
      toast.success('Gap closed', { description: gap.requirement });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={Boolean(gap)}
      onClose={onClose}
      title={gap ? `Close ${gap.requirement}?` : 'Close gap'}
      description="Closing records that the requirement is now met. It counts toward the framework's score."
      submitLabel="Close gap"
      submittingLabel="Closing…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Closed by" required error={fieldError} hint="Who verified that the gap is fixed. Recorded in the activity log.">
        <Input value={closedBy} onChange={(e) => setClosedBy(e.target.value)} placeholder="e.g. Compliance officer" />
      </FormField>
    </FormModal>
  );
}
