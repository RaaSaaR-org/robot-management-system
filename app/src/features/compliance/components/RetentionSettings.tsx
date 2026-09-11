/**
 * @file RetentionSettings.tsx
 * @description Retention view: how long each event type is kept, what expires
 *              soon, an edit form per event type and a confirmed manual cleanup.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  Button, DataTable, FormField, FormModal, Input, Panel, StatRow, StatTile, confirm, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { useComplianceStore } from '../store';
import type { ComplianceEventType } from '../types';
import { EVENT_TYPE_LABELS, errorMessage } from './complianceFormat';

export interface RetentionSettingsProps {
  className?: string;
}

const EVENT_TYPE_DESCRIPTIONS: Record<ComplianceEventType, string> = {
  ai_decision: 'AI model decisions — the EU AI Act asks for 10 years',
  safety_action: 'Emergency stops and safety triggers',
  command_execution: 'Robot commands and their execution',
  system_event: 'Startup, shutdown and system errors',
  access_audit: 'Who read or exported the log',
};

const EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS) as ComplianceEventType[];
const DEFAULT_DAYS = 365;

interface Row { eventType: ComplianceEventType; days: number; custom: boolean }

function formatRetention(days: number): string {
  if (days >= 365 && days % 365 === 0) {
    const years = days / 365;
    return `${years} year${years > 1 ? 's' : ''}`;
  }
  return `${days.toLocaleString()} days`;
}

/** Retention policies per event type plus the manual cleanup act. */
export function RetentionSettings({ className }: RetentionSettingsProps) {
  const {
    retentionPolicies, retentionStats, isLoadingRetention, isCleaningUp, error,
    fetchRetentionPolicies, fetchRetentionStats, setRetentionPolicy, triggerCleanup,
  } = useComplianceStore();
  const [editing, setEditing] = useState<Row | null>(null);
  const [days, setDays] = useState('');
  const [daysError, setDaysError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchRetentionPolicies();
    void fetchRetentionStats();
  }, [fetchRetentionPolicies, fetchRetentionStats]);

  const rows: Row[] = EVENT_TYPES.map((eventType) => {
    const p = retentionPolicies.find((x) => x.eventType === eventType);
    return { eventType, days: p?.retentionDays ?? DEFAULT_DAYS, custom: Boolean(p) };
  });

  const openEdit = (r: Row) => {
    setEditing(r);
    setDays(String(r.days));
    setDaysError(undefined);
    setFormError(undefined);
  };

  const save = async () => {
    if (!editing) return;
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 36500) { setDaysError('Enter a whole number of days between 1 and 36,500.'); return; }
    setSaving(true);
    setFormError(undefined);
    let err: string | null = null;
    try {
      await setRetentionPolicy(editing.eventType, n);
      err = useComplianceStore.getState().error;
    } catch (e) {
      err = errorMessage(e);
    } finally {
      setSaving(false);
    }
    if (err) { setFormError(err); return; }
    toast.success('Retention updated', { description: `${EVENT_TYPE_LABELS[editing.eventType]}: ${formatRetention(n)}` });
    setEditing(null);
    void fetchRetentionStats();
  };

  const runCleanup = async () => {
    const ok = await confirm({
      title: 'Run retention cleanup now?',
      description: 'Entries older than their retention period are deleted permanently. Entries under a legal hold are kept. This cannot be undone.',
      confirmLabel: 'Run cleanup',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const r = await triggerCleanup();
      toast.success('Cleanup finished', { description: `${r.logsDeleted.toLocaleString()} deleted · ${r.logsSkipped.toLocaleString()} kept under legal hold` });
      void fetchRetentionStats();
    } catch (err) {
      toast.error("Couldn't run the cleanup", { description: errorMessage(err) });
    }
  };

  const columns: DataTableColumn<Row>[] = [
    { key: 'eventType', header: 'Event type', sortable: true, cell: (r) => (
      <div className="min-w-0">
        <div className="text-sm text-ink-primary">{EVENT_TYPE_LABELS[r.eventType]}</div>
        <div className="text-[13px] text-ink-tertiary">{EVENT_TYPE_DESCRIPTIONS[r.eventType]}</div>
      </div>
    ) },
    { key: 'days', header: 'Kept for', align: 'right', sortable: true, cell: (r) => (
      <span className="whitespace-nowrap text-ink-secondary">{formatRetention(r.days)}{!r.custom && <span className="text-ink-tertiary"> · default</span>}</span>
    ) },
  ];

  return (
    <div className={className ? `flex flex-col gap-4 ${className}` : 'flex flex-col gap-4'}>
      {retentionStats && (
        <StatRow columns={4}>
          <StatTile label="Entries" value={retentionStats.totalLogs.toLocaleString()} hint="In the audit log" />
          <StatTile label="Expire in 30 days" value={retentionStats.expiringWithin30Days.toLocaleString()} tone={retentionStats.expiringWithin30Days ? 'gated' : undefined} hint="Deleted by the next cleanups" />
          <StatTile label="Expire in 90 days" value={retentionStats.expiringWithin90Days.toLocaleString()} hint="Including the 30-day ones" />
          <StatTile label="Under legal hold" value={retentionStats.underLegalHold.toLocaleString()} hint="Never deleted while held" />
        </StatRow>
      )}

      <Panel padding="none">
        <Panel.Header
          title="Retention policies"
          description="How long each event type is kept before cleanup deletes it."
          actions={
            <Button variant="secondary" leftIcon={<Trash2 className="h-4 w-4" strokeWidth={1.75} />} isLoading={isCleaningUp} onClick={() => void runCleanup()}>
              Run cleanup
            </Button>
          }
        />
        <DataTable
          caption="Retention policies"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.eventType}
          isLoading={isLoadingRetention && retentionPolicies.length === 0}
          error={retentionPolicies.length === 0 && !isLoadingRetention ? error : null}
          errorTitle="Couldn't load retention policies"
          onRetry={() => void fetchRetentionPolicies()}
          onRowClick={openEdit}
          rowActions={(r) => [{ label: 'Edit retention', icon: <Pencil />, onSelect: () => openEdit(r) }]}
          rowActionsLabel={(r) => `Actions for ${EVENT_TYPE_LABELS[r.eventType]}`}
        />
      </Panel>

      <FormModal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${EVENT_TYPE_LABELS[editing.eventType].toLowerCase()} retention` : 'Edit retention'}
        description="Cleanup deletes entries older than this. Entries under a legal hold are kept."
        submitLabel="Save changes"
        submittingLabel="Saving…"
        isSubmitting={saving}
        error={formError}
        onSubmit={save}
        noValidate
      >
        <FormField label="Keep for (days)" required error={daysError} hint="3,650 days = 10 years, the EU AI Act record-keeping period.">
          <Input type="number" min={1} max={36500} value={days} onChange={(e) => setDays(e.target.value)} />
        </FormField>
      </FormModal>
    </div>
  );
}
