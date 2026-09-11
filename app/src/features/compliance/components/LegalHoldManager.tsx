/**
 * @file LegalHoldManager.tsx
 * @description Legal holds: entries preserved against retention cleanup.
 *              Create through a FormModal, release through a confirm dialog.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { Gavel, Plus, Unlock } from 'lucide-react';
import {
  Button, DataTable, EmptyState, Panel, StatusTag, Switch, confirm, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { useComplianceStore } from '../store';
import type { LegalHold } from '../types';
import { LegalHoldFormModal } from './LegalHoldFormModal';
import { errorMessage, formatDate } from './complianceFormat';

export interface LegalHoldManagerProps {
  className?: string;
}

/** Legal hold list with create and release. */
export function LegalHoldManager({ className }: LegalHoldManagerProps) {
  const { legalHolds, isLoadingLegalHolds, error, fetchLegalHolds, releaseLegalHold } = useComplianceStore();
  const [activeOnly, setActiveOnly] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    void fetchLegalHolds(activeOnly);
  }, [fetchLegalHolds, activeOnly]);

  const rows = activeOnly ? legalHolds.filter((h) => h.isActive) : legalHolds;

  const askRelease = async (h: LegalHold) => {
    const ok = await confirm({
      title: `Release ${h.name}?`,
      description: `${h.logIds.length.toLocaleString()} preserved entries become subject to their retention period again, and cleanup may delete them.`,
      confirmLabel: 'Release hold',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await releaseLegalHold(h.id);
      toast.success('Legal hold released', { description: h.name });
      void fetchLegalHolds(activeOnly);
    } catch (err) {
      toast.error("Couldn't release the legal hold", { description: errorMessage(err) });
    }
  };

  const columns: DataTableColumn<LegalHold>[] = [
    { key: 'name', header: 'Hold', sortable: true, cell: (h) => (
      <div className="min-w-0">
        <div className="text-sm text-ink-primary">{h.name}</div>
        <div className="line-clamp-1 text-[13px] text-ink-tertiary" title={h.reason}>{h.reason}</div>
      </div>
    ) },
    { key: 'isActive', header: 'Status', sortable: true, cell: (h) => <StatusTag tone={h.isActive ? 'gated' : 'neutral'}>{h.isActive ? 'Active' : 'Released'}</StatusTag> },
    { key: 'logIds', header: 'Entries', align: 'right', sortable: true, hideBelow: 'sm', sortValue: (h) => h.logIds.length, cell: (h) => h.logIds.length.toLocaleString() },
    { key: 'createdBy', header: 'Placed by', sortable: true, hideBelow: 'md' },
    { key: 'startDate', header: 'Since', align: 'right', sortable: true, hideBelow: 'md', sortValue: (h) => new Date(h.startDate),
      cell: (h) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(h.startDate)}{h.endDate ? ` – ${formatDate(h.endDate)}` : ''}</span> },
  ];

  const newButton = (
    <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setFormOpen(true)}>New legal hold</Button>
  );

  return (
    <Panel padding="none" className={className}>
      <Panel.Header
        title="Legal holds"
        description="Preserve entries during an investigation or legal proceeding, whatever their retention."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Switch size="sm" label="Active only" checked={activeOnly} onCheckedChange={setActiveOnly} />
            {newButton}
          </div>
        }
      />
      <DataTable
        caption="Legal holds"
        columns={columns}
        rows={rows}
        getRowId={(h) => h.id}
        defaultSort={{ key: 'startDate', direction: 'desc' }}
        rowActions={(h) => (h.isActive ? [{ label: 'Release hold', icon: <Unlock />, tone: 'danger', onSelect: () => void askRelease(h) }] : [])}
        rowActionsLabel={(h) => `Actions for ${h.name}`}
        isLoading={isLoadingLegalHolds}
        error={rows.length === 0 && !isLoadingLegalHolds ? error : null}
        errorTitle="Couldn't load legal holds"
        onRetry={() => void fetchLegalHolds(activeOnly)}
        empty={
          <EmptyState
            size="sm"
            icon={<Gavel />}
            title={activeOnly ? 'No active legal holds' : 'No legal holds yet'}
            description="Every entry follows its retention policy."
            action={newButton}
          />
        }
      />
      <LegalHoldFormModal isOpen={formOpen} onClose={() => { setFormOpen(false); void fetchLegalHolds(activeOnly); }} />
    </Panel>
  );
}
