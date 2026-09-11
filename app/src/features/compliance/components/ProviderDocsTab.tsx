/**
 * @file ProviderDocsTab.tsx
 * @description Technical docs view: provider documentation filtered by
 *              provider and regulation, opened in a modal, added and deleted.
 * @feature compliance
 */

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Plus, Search, Trash2 } from 'lucide-react';
import {
  Button, DataTable, EmptyState, KeyValueList, Modal, Panel, Select, StatusTag, Toolbar, confirm, toast,
  type DataTableColumn,
} from '@/shared/components/ui';
import { useComplianceStore } from '../store';
import { complianceApi } from '../api';
import { DocumentTypeCategories, DocumentTypeLabels, type DocumentType, type ProviderDocumentation } from '../types';
import { ProviderDocFormModal } from './ProviderDocFormModal';
import { errorMessage, formatDate } from './complianceFormat';

export interface ProviderDocsTabProps {
  className?: string;
}

type Category = keyof typeof DocumentTypeCategories;

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General', ai_act: 'AI Act', machinery: 'Machinery', cybersecurity: 'Cybersecurity', conformity: 'Conformity',
};

const typeLabel = (t: string) => DocumentTypeLabels[t as DocumentType] ?? t;
const isValid = (d: ProviderDocumentation) => !d.validTo || new Date(d.validTo) >= new Date();

export function ProviderDocsTab({ className }: ProviderDocsTabProps) {
  const { providers, providerDocs, isLoadingProviders, error, fetchProviders, fetchAllDocumentation } = useComplianceStore();
  const [provider, setProvider] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<ProviderDocumentation | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const reload = () => { void fetchProviders(); void fetchAllDocumentation(); };
  useEffect(reload, [fetchProviders, fetchAllDocumentation]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => providerDocs.filter((d) =>
    (!provider || d.providerName === provider) &&
    (!category || (DocumentTypeCategories[category as Category] as readonly string[]).includes(d.documentType))),
  [providerDocs, provider, category]);

  const askDelete = async (d: ProviderDocumentation) => {
    const ok = await confirm({
      title: `Delete ${typeLabel(d.documentType)}?`,
      description: `${d.providerName} ${d.modelVersion} loses this document from its technical file.`,
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await complianceApi.deleteDocumentation(d.id);
      toast.success('Document deleted', { description: typeLabel(d.documentType) });
      setSelected(null);
      reload();
    } catch (err) {
      toast.error("Couldn't delete document", { description: errorMessage(err) });
    }
  };

  const columns: DataTableColumn<ProviderDocumentation>[] = [
    { key: 'documentType', header: 'Document', sortable: true, sortValue: (d) => typeLabel(d.documentType), cell: (d) => (
      <div className="min-w-[10rem]">
        <div className="text-sm text-ink-primary">{typeLabel(d.documentType)}</div>
        <div className="text-[13px] text-ink-tertiary">{d.providerName}</div>
      </div>
    ) },
    { key: 'modelVersion', header: 'Version', sortable: true, hideBelow: 'sm', cell: (d) => <span className="font-mono text-[13px] text-ink-secondary">{d.modelVersion}</span> },
    { key: 'validity', header: 'Status', sortValue: (d) => (isValid(d) ? 1 : 0), cell: (d) => <StatusTag tone={isValid(d) ? 'live' : 'stopped'}>{isValid(d) ? 'Valid' : 'Expired'}</StatusTag> },
    { key: 'validFrom', header: 'Valid', align: 'right', sortable: true, hideBelow: 'md', sortValue: (d) => new Date(d.validFrom),
      cell: (d) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(d.validFrom)}{d.validTo ? ` – ${formatDate(d.validTo)}` : ' onward'}</span> },
  ];

  const hasFilters = Boolean(provider || category);
  const newButton = <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setFormOpen(true)}>New document</Button>;

  return (
    <div className={className ? `flex flex-col gap-4 ${className}` : 'flex flex-col gap-4'}>
      <Toolbar
        filters={
          <>
            <Select aria-label="Provider" fullWidth={false} className="w-44" placeholder="All providers"
              options={providers.map((p) => ({ value: p.providerName, label: `${p.providerName} (${p.documentCount})` }))}
              value={provider} onChange={(e) => setProvider(e.target.value)} />
            <Select aria-label="Regulation" fullWidth={false} className="w-44" placeholder="All regulations"
              options={Object.keys(DocumentTypeCategories).map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c }))}
              value={category} onChange={(e) => setCategory(e.target.value)} />
          </>
        }
        actions={newButton}
      />
      <Panel padding="none">
        <DataTable
          caption="Technical documentation"
          columns={columns}
          rows={rows}
          getRowId={(d) => d.id}
          defaultSort={{ key: 'documentType', direction: 'asc' }}
          onRowClick={setSelected}
          rowActions={(d) => [{ label: 'Delete', icon: <Trash2 />, tone: 'danger', onSelect: () => void askDelete(d) }]}
          rowActionsLabel={(d) => `Actions for ${typeLabel(d.documentType)}`}
          isLoading={isLoadingProviders && providerDocs.length === 0}
          error={providerDocs.length === 0 ? error : null}
          errorTitle="Couldn't load technical documentation"
          onRetry={reload}
          empty={hasFilters ? (
            <EmptyState icon={<Search />} title="No documents match" description="Try another provider or regulation."
              action={<Button variant="secondary" onClick={() => { setProvider(''); setCategory(''); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<FileText />} title="No documents yet" description="Add model cards, risk files and declarations of conformity." action={newButton} />
          )}
        />
      </Panel>

      <Modal
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        size="lg"
        title={selected ? typeLabel(selected.documentType) : 'Document'}
        description={selected ? `${selected.providerName} · ${selected.modelVersion}` : undefined}
        footer={selected && (
          <>
            <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void askDelete(selected)}>Delete</Button>
            <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
          </>
        )}
      >
        {selected && (
          <div className="flex flex-col gap-4">
            <KeyValueList columns={3} items={[
              { label: 'Valid from', value: formatDate(selected.validFrom) },
              { label: 'Valid to', value: selected.validTo ? formatDate(selected.validTo) : 'Open-ended' },
              { label: 'Updated', value: formatDate(selected.updatedAt) },
            ]} />
            {selected.documentUrl && (
              <a href={selected.documentUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline">
                Open source document <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
              </a>
            )}
            <div className="max-h-96 overflow-auto rounded-control border border-line-subtle bg-inset p-4 text-sm leading-relaxed text-ink-secondary whitespace-pre-wrap">
              {selected.content}
            </div>
          </div>
        )}
      </Modal>
      <ProviderDocFormModal isOpen={formOpen} onClose={() => setFormOpen(false)} onCreated={reload} />
    </div>
  );
}
