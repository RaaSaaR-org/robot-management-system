/**
 * @file RopaTab.tsx
 * @description Records of processing activities (GDPR Art. 30) as a section:
 *              search, legal-basis filter, table with edit/delete, create form
 *              and a generated report.
 * @feature compliance
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import {
  Button, DataTable, EmptyState, FormField, Input, KeyValueList, Modal, Panel, SearchInput, Select, Toolbar,
  confirm, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { useComplianceStore } from '../store';
import type { RopaEntry } from '../types';
import { LEGAL_BASIS_OPTIONS, RopaFormModal, legalBasisLabel } from './RopaFormModal';
import { errorMessage, formatDateTime, formatRelative } from './complianceFormat';

export interface RopaTabProps {
  className?: string;
}

function ReportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { ropaReport, isLoadingRopa, generateRopaReport } = useComplianceStore();
  const [org, setOrg] = useState('');

  const generate = async () => {
    await generateRopaReport(org.trim() || undefined);
    const { error } = useComplianceStore.getState();
    if (error) toast.error("Couldn't generate the report", { description: error });
  };

  const downloadReport = () => {
    if (!ropaReport) return;
    const blob = new Blob([JSON.stringify(ropaReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ropa-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report downloaded');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="RoPA report"
      description="The full record of processing activities, as a supervisory authority can request it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {ropaReport && (
            <Button variant="secondary" leftIcon={<Download className="h-4 w-4" strokeWidth={1.75} />} onClick={downloadReport}>Download JSON</Button>
          )}
          <Button isLoading={isLoadingRopa} onClick={() => void generate()}>{ropaReport ? 'Generate again' : 'Generate report'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormField label="Organization name" aside="Optional">
          <Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Shown on the report" />
        </FormField>
        {ropaReport && (
          <>
            <KeyValueList
              columns={3}
              items={[
                { label: 'Organization', value: ropaReport.organizationName },
                { label: 'Activities', value: ropaReport.totalProcessingActivities.toLocaleString() },
                { label: 'Generated', value: formatDateTime(ropaReport.generatedAt) },
              ]}
            />
            <ul className="flex flex-col divide-y divide-line-subtle rounded-control border border-line-subtle">
              {ropaReport.entries.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="text-sm text-ink-primary">{e.processingActivity}</span>
                  <span className="text-[13px] text-ink-tertiary">{legalBasisLabel(e.legalBasis)} · {e.retentionPeriod}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

/** RoPA section, hosted in the Data privacy tab. */
export function RopaTab({ className }: RopaTabProps) {
  const { ropaEntries, isLoadingRopa, error, fetchRopaEntries, deleteRopaEntry } = useComplianceStore();
  const [query, setQuery] = useState('');
  const [basis, setBasis] = useState('');
  const [editing, setEditing] = useState<RopaEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    void fetchRopaEntries();
  }, [fetchRopaEntries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ropaEntries.filter((e) =>
      (!basis || e.legalBasis === basis) &&
      (!q || `${e.processingActivity} ${e.purpose} ${e.dataCategories.join(' ')}`.toLowerCase().includes(q)));
  }, [ropaEntries, query, basis]);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (e: RopaEntry) => { setEditing(e); setFormOpen(true); };

  const askDelete = async (e: RopaEntry) => {
    const ok = await confirm({
      title: `Delete ${e.processingActivity}?`,
      description: 'The record leaves the RoPA and the next report. If the processing still happens, the record of processing is incomplete.',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteRopaEntry(e.id);
      toast.success('RoPA entry deleted', { description: e.processingActivity });
    } catch (err) {
      toast.error("Couldn't delete RoPA entry", { description: errorMessage(err) });
    }
  };

  const columns: DataTableColumn<RopaEntry>[] = [
    { key: 'processingActivity', header: 'Processing activity', sortable: true, cell: (e) => (
      <div className="min-w-[12rem]">
        <div className="text-sm text-ink-primary">{e.processingActivity}</div>
        <div className="line-clamp-1 text-[13px] text-ink-tertiary" title={e.purpose}>{e.purpose}</div>
      </div>
    ) },
    { key: 'legalBasis', header: 'Legal basis', sortable: true, hideBelow: 'sm', cell: (e) => <span className="whitespace-nowrap text-ink-secondary">{legalBasisLabel(e.legalBasis)}</span> },
    { key: 'dataCategories', header: 'Data', hideBelow: 'lg', sortValue: (e) => e.dataCategories.length,
      cell: (e) => <span className="line-clamp-1 text-[13px] text-ink-tertiary" title={e.dataCategories.join(', ')}>{e.dataCategories.join(', ')}</span> },
    { key: 'retentionPeriod', header: 'Retention', hideBelow: 'md', cell: (e) => <span className="line-clamp-1 text-[13px] text-ink-secondary">{e.retentionPeriod}</span> },
    { key: 'updatedAt', header: 'Updated', align: 'right', sortable: true, hideBelow: 'md', sortValue: (e) => new Date(e.updatedAt),
      cell: (e) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatRelative(e.updatedAt)}</span> },
  ];

  const hasFilters = Boolean(query || basis);
  const newButton = <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={openCreate}>New RoPA entry</Button>;

  return (
    <div className={className ? `flex flex-col gap-4 ${className}` : 'flex flex-col gap-4'}>
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search processing activities" />}
        filters={
          <Select aria-label="Legal basis" fullWidth={false} className="w-48" placeholder="All legal bases"
            options={LEGAL_BASIS_OPTIONS.map((o) => ({ value: o.value, label: legalBasisLabel(o.value) }))}
            value={basis} onChange={(e) => setBasis(e.target.value)} />
        }
        actions={
          <>
            <Button variant="secondary" leftIcon={<FileText className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setReportOpen(true)}>Generate report</Button>
            {newButton}
          </>
        }
      />
      <Panel padding="none">
        <DataTable
          caption="Records of processing activities"
          columns={columns}
          rows={filtered}
          getRowId={(e) => e.id}
          defaultSort={{ key: 'processingActivity', direction: 'asc' }}
          onRowClick={openEdit}
          rowActions={(e) => [
            { label: 'Edit', icon: <Pencil />, onSelect: () => openEdit(e) },
            { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => void askDelete(e) },
          ]}
          rowActionsLabel={(e) => `Actions for ${e.processingActivity}`}
          isLoading={isLoadingRopa && ropaEntries.length === 0}
          error={ropaEntries.length === 0 ? error : null}
          errorTitle="Couldn't load the RoPA"
          onRetry={() => void fetchRopaEntries()}
          empty={
            hasFilters ? (
              <EmptyState icon={<Search />} title="No entries match" description="Try another search or legal basis, or clear the filters."
                action={<Button variant="secondary" onClick={() => { setQuery(''); setBasis(''); }}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={<FileText />} title="No RoPA entries yet" description="Record each activity that processes personal data." action={newButton} />
            )
          }
        />
      </Panel>
      <RopaFormModal isOpen={formOpen} entry={editing} onClose={() => setFormOpen(false)} />
      <ReportModal isOpen={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
