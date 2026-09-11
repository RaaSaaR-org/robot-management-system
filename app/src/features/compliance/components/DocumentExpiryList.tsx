/**
 * @file DocumentExpiryList.tsx
 * @description Documents view: provider documents that expire within 90
 *              days or already have.
 * @feature compliance
 */

import { useEffect } from 'react';
import { FileClock } from 'lucide-react';
import { StatusTag, type DataTableColumn } from '@/shared/components/ui';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { DocumentTypeLabels, type DocumentType } from '../types';
import { ObligationTable } from './ObligationTable';
import { complianceTone, formatDate, formatDays, humanize } from './complianceFormat';

export interface DocumentExpiryListProps {
  className?: string;
}

type Row = ReturnType<typeof useComplianceTrackerStore.getState>['expiringDocuments'][number];

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Valid' },
  { value: 'expiring_soon', label: 'Expiring soon' },
  { value: 'expired', label: 'Expired' },
];

export function DocumentExpiryList({ className }: DocumentExpiryListProps) {
  const { expiringDocuments, isLoadingDocuments, error, fetchExpiringDocuments } = useComplianceTrackerStore();

  useEffect(() => {
    void fetchExpiringDocuments(90);
  }, [fetchExpiringDocuments]);

  const expired = expiringDocuments.filter((d) => d.status === 'expired').length;

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'documentType', header: 'Document', sortable: true,
      cell: (d) => (
        <div className="min-w-0">
          <div className="text-sm text-ink-primary">{DocumentTypeLabels[d.documentType as DocumentType] ?? humanize(d.documentType)}</div>
          <div className="text-[13px] text-ink-tertiary">{d.providerName}</div>
        </div>
      ),
    },
    { key: 'modelVersion', header: 'Version', hideBelow: 'sm', cell: (d) => <code className="font-mono text-[13px] text-ink-secondary">{d.modelVersion}</code> },
    {
      key: 'validTo', header: 'Expires', sortable: true, sortValue: (d) => (d.validTo ? new Date(d.validTo) : null),
      cell: (d) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{formatDate(d.validTo)} · {formatDays(d.daysUntilExpiry)}</span>,
    },
    { key: 'status', header: 'Status', sortable: true, cell: (d) => <StatusTag tone={complianceTone(d.status)}>{humanize(d.status)}</StatusTag> },
  ];

  return (
    <div className={className}>
      <ObligationTable
        noun="documents"
        title="Expiring documents"
        description={`${expired} expired · ${expiringDocuments.length - expired} expiring within 90 days`}
        rows={expiringDocuments}
        columns={columns}
        getRowId={(d) => d.id}
        searchText={(d) => `${d.providerName} ${d.modelVersion} ${d.documentType}`}
        statusOf={(d) => d.status}
        statusOptions={STATUS_OPTIONS}
        defaultSort={{ key: 'validTo', direction: 'asc' }}
        isLoading={isLoadingDocuments}
        error={error}
        onRetry={() => void fetchExpiringDocuments(90)}
        emptyIcon={<FileClock />}
        emptyTitle="Nothing expires soon"
        emptyDescription="Provider documents with a validity end date show up here 90 days before they expire. Add them under Technical docs."
      />
    </div>
  );
}
