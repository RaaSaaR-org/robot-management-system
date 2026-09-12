/**
 * @file ServiceAccountsSection.tsx
 * @description Team > Service accounts: search, DataTable; manage tokens, delete (confirm)
 * @feature team
 */

import { useMemo, useState, type ReactNode } from 'react';
import { KeyRound, Search, Trash2 } from 'lucide-react';
import {
  Button, DataTable, EmptyState, Panel, SearchInput, StatusTag, Toolbar, confirm, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { useServiceAccountsStore } from '../store/serviceAccountsStore';
import type { ServiceAccount } from '../types/serviceAccount.types';
import { teamErrorMessage } from './teamErrors';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(UI_DATE_LOCALE) : null);

export function ServiceAccountsSection({
  createAction,
  onManageTokens,
}: {
  createAction: ReactNode;
  onManageTokens: (account: ServiceAccount) => void;
}) {
  const accounts = useServiceAccountsStore((s) => s.accounts);
  const loaded = useServiceAccountsStore((s) => s.loaded);
  const loading = useServiceAccountsStore((s) => s.loading);
  const error = useServiceAccountsStore((s) => s.error);
  const fetchAccounts = useServiceAccountsStore((s) => s.fetch);
  const remove = useServiceAccountsStore((s) => s.remove);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // The server deletes a service account by deactivating it; deleted ones stay hidden.
    return accounts.filter((a) => a.isActive && (!q || a.name.toLowerCase().includes(q)));
  }, [accounts, query]);

  const askDelete = async (a: ServiceAccount) => {
    const ok = await confirm({ tone: 'danger', title: `Delete ${a.name}?`, description: 'Its tokens stop working immediately.' });
    if (!ok) return;
    try {
      await remove(a.id);
      toast.success('Service account deleted', { description: a.name });
    } catch (err) {
      toast.error("Couldn't delete service account", { description: teamErrorMessage(err, 'Unknown error') });
    }
  };

  const columns: DataTableColumn<ServiceAccount>[] = [
    { key: 'name', header: 'Name', sortable: true, sortValue: (a) => a.name.toLowerCase(), cell: (a) => (
      <div className="min-w-0"><div className="truncate font-medium text-ink-primary">{a.name}</div>
        <code className="truncate font-mono text-xs text-ink-tertiary">{a.email}</code></div>) },
    { key: 'role', header: 'Role', sortable: true, cell: (a) => <StatusTag tone="neutral">{a.role}</StatusTag> },
    { key: 'tokenCount', header: 'Tokens', align: 'right', sortable: true },
    { key: 'lastUsedAt', header: 'Last used', align: 'right', sortable: true, hideBelow: 'md',
      sortValue: (a) => (a.lastUsedAt ? new Date(a.lastUsedAt) : null), cell: (a) => fmt(a.lastUsedAt) ?? 'Never' },
    { key: 'createdAt', header: 'Created', align: 'right', sortable: true, hideBelow: 'lg',
      sortValue: (a) => new Date(a.createdAt), cell: (a) => fmt(a.createdAt) },
  ];

  return (
    <>
      <Toolbar search={<SearchInput value={query} onChange={setQuery} placeholder="Search service accounts" />} />
      <Panel padding="none">
        <DataTable
          caption="Service accounts" columns={columns} rows={filtered} getRowId={(a) => a.id}
          defaultSort={{ key: 'name', direction: 'asc' }}
          onRowClick={onManageTokens}
          rowActions={(a) => [
            { label: 'Manage tokens', icon: <KeyRound />, onSelect: () => onManageTokens(a) },
            { label: 'Delete', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => void askDelete(a) },
          ]}
          rowActionsLabel={(a) => `Actions for ${a.name}`}
          isLoading={!loaded && loading} error={loaded ? null : error} errorTitle="Couldn't load service accounts" onRetry={() => void fetchAccounts()}
          empty={query ? (
            <EmptyState icon={<Search />} title="No service accounts match" description="Try another name."
              action={<Button variant="secondary" onClick={() => setQuery('')}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<KeyRound />} title="No service accounts yet"
              description="Bot users for agents, CI pipelines and integrations; they sign in with API tokens." action={createAction} />
          )}
        />
      </Panel>
    </>
  );
}
