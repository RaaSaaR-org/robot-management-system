/**
 * @file AuditLogSection.tsx
 * @description Audit trail tab: the log (filters, pager, entry modal), hash
 *              chain integrity, metrics and retention, switched through ?view=.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, RefreshCw, Search } from 'lucide-react';
import {
  Button, EmptyState, Modal, Panel, SegmentedControl, Select, Toolbar, toast,
} from '@/shared/components/ui';
import { useComplianceStore } from '../store';
import type { ComplianceEventType, ComplianceLog, ComplianceSeverity } from '../types';
import { ComplianceLogList } from './ComplianceLogList';
import { ComplianceLogViewer } from './ComplianceLogViewer';
import { IntegrityStatus } from './IntegrityStatus';
import { AuditMetricsPanel } from './AuditMetricsPanel';
import { RetentionSettings } from './RetentionSettings';
import { LegalHoldManager } from './LegalHoldManager';
import { Pager } from './Pager';
import { EVENT_TYPE_OPTIONS, SEVERITIES, eventTypeLabel, humanize } from './complianceFormat';

const VIEWS = [
  { value: 'log', label: 'Log' },
  { value: 'integrity', label: 'Integrity' },
  { value: 'metrics', label: 'Metrics' },
  { value: 'retention', label: 'Retention' },
] as const;

type View = (typeof VIEWS)[number]['value'];

const SEVERITY_OPTIONS = SEVERITIES.map((s) => ({ value: s, label: humanize(s) }));

export interface AuditLogSectionProps {
  onViewDecision?: (decisionId: string) => void;
}

function LogView({ onViewDecision }: AuditLogSectionProps) {
  const { logs, isLoading, error, page, totalPages, total, filters, fetchLogs, setPage, setFilters, clearFilters } =
    useComplianceStore();
  const [selected, setSelected] = useState<ComplianceLog | null>(null);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  const hasFilters = Boolean(filters.eventType || filters.severity || filters.robotId);

  return (
    <>
      <Toolbar
        filters={
          <>
            <Select
              aria-label="Event type"
              fullWidth={false}
              className="w-44"
              placeholder="All event types"
              options={EVENT_TYPE_OPTIONS}
              value={filters.eventType ?? ''}
              onChange={(e) => setFilters({ eventType: (e.target.value || undefined) as ComplianceEventType | undefined })}
            />
            <Select
              aria-label="Severity"
              fullWidth={false}
              className="w-40"
              placeholder="All severities"
              options={SEVERITY_OPTIONS}
              value={filters.severity ?? ''}
              onChange={(e) => setFilters({ severity: (e.target.value || undefined) as ComplianceSeverity | undefined })}
            />
          </>
        }
        actions={
          <Button variant="ghost" iconOnly aria-label="Refresh" isLoading={isLoading && logs.length > 0} onClick={() => void fetchLogs()}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        }
      />
      <Panel padding="none">
        <ComplianceLogList
          logs={logs}
          onSelect={setSelected}
          isLoading={isLoading}
          error={logs.length === 0 ? error : null}
          onRetry={() => void fetchLogs()}
          empty={
            hasFilters ? (
              <EmptyState icon={<Search />} title="No entries match" description="Try another event type or severity, or clear the filters."
                action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={<FileText />} title="No audit entries yet"
                description="Entries appear when robots execute commands, trigger safety actions or an AI model decides." />
            )
          }
        />
      </Panel>
      <Pager page={page} totalPages={totalPages} total={total} onPageChange={setPage} disabled={isLoading} />

      <Modal
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        size="lg"
        title={selected?.payload.description || (selected ? eventTypeLabel(selected.eventType) : 'Audit entry')}
        footer={<Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected && (
          <ComplianceLogViewer
            log={selected}
            onViewDecision={onViewDecision ? (id) => { setSelected(null); onViewDecision(id); } : undefined}
          />
        )}
      </Modal>
    </>
  );
}

function IntegrityView() {
  const { integrityResult, isVerifying, verifyIntegrity } = useComplianceStore();
  const verify = async () => {
    await verifyIntegrity();
    const { integrityResult: r, error } = useComplianceStore.getState();
    if (error || !r) toast.error("Couldn't verify the hash chain", { description: error ?? undefined });
    else if (r.isValid) toast.success('Hash chain intact', { description: `${r.verifiedLogs.toLocaleString()} entries verified` });
    else toast.warning('Hash chain broken', { description: `${r.brokenLinks.length.toLocaleString()} broken links found` });
  };
  return <IntegrityStatus result={integrityResult} isVerifying={isVerifying} onVerify={() => void verify()} />;
}

/** The audit trail tab of /compliance. */
export function AuditLogSection({ onViewDecision }: AuditLogSectionProps) {
  const [params, setParams] = useSearchParams();
  const view: View = VIEWS.some((v) => v.value === params.get('view')) ? (params.get('view') as View) : VIEWS[0].value;
  const setView = (v: View) =>
    setParams(
      (p) => {
        if (v === VIEWS[0].value) p.delete('view');
        else p.set('view', v);
        return p;
      },
      { replace: true },
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-full overflow-x-auto">
        <SegmentedControl label="Audit trail view" size="sm" options={[...VIEWS]} value={view} onChange={setView} />
      </div>
      {view === 'log' && <LogView onViewDecision={onViewDecision} />}
      {view === 'integrity' && <IntegrityView />}
      {view === 'metrics' && <AuditMetricsPanel />}
      {view === 'retention' && (
        <>
          <RetentionSettings />
          <LegalHoldManager />
        </>
      )}
    </div>
  );
}
