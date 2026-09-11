/**
 * @file ServiceAccountTokensModal.tsx
 * @description Manage a service account's API tokens (TASK-165): new token, rotate, revoke (confirm)
 * @feature team
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  Button, DataTable, EmptyState, FormField, Input, Modal, Panel, StatusTag, confirm, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { serviceAccountsApi } from '../api/serviceAccountsApi';
import type { ApiTokenSummary, ServiceAccount } from '../types/serviceAccount.types';
import { teamErrorMessage } from './teamErrors';

interface ServiceAccountTokensModalProps {
  isOpen: boolean;
  account: ServiceAccount | null;
  onClose: () => void;
  onTokenCreated: (plaintext: string, accountName: string) => void;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(UI_DATE_LOCALE, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
const tokenState = (t: ApiTokenSummary) =>
  t.revokedAt ? 'revoked' : t.expiresAt && new Date(t.expiresAt) < new Date() ? 'expired' : 'active';

export function ServiceAccountTokensModal({ isOpen, account, onClose, onTokenCreated }: ServiceAccountTokensModalProps) {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [expiryDays, setExpiryDays] = useState('90');
  const [creating, setCreating] = useState(false);

  const fetchTokens = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      setTokens(await serviceAccountsApi.listTokens(account.id));
    } catch (err) {
      setError(teamErrorMessage(err, 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (isOpen && account) {
      setTokens([]); setNewName(''); setExpiryDays('90');
      void fetchTokens();
    }
  }, [isOpen, account, fetchTokens]);

  if (!account) return null;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const days = Math.min(365, Math.max(1, Number(expiryDays) || 90));
      const result = await serviceAccountsApi.createToken(account.id, { name: newName.trim(), expiresInDays: days });
      setTokens((prev) => [result.token, ...prev]);
      setNewName('');
      onTokenCreated(result.plaintext, account.name);
    } catch (err) {
      toast.error("Couldn't create token", { description: teamErrorMessage(err, 'Unknown error') });
    } finally {
      setCreating(false);
    }
  };

  const rotate = async (t: ApiTokenSummary) => {
    const ok = await confirm({ title: `Rotate ${t.name}?`, description: 'A new token replaces it. The old one keeps working for a short grace period.', confirmLabel: 'Rotate' });
    if (!ok) return;
    try {
      const r = await serviceAccountsApi.rotateToken(account.id, t.id);
      setTokens((prev) => [r.newToken, ...prev.map((x) => (x.id === t.id ? { ...x, expiresAt: r.oldTokenExpiresAt } : x))]);
      onTokenCreated(r.plaintext, account.name);
    } catch (err) {
      toast.error("Couldn't rotate token", { description: teamErrorMessage(err, 'Unknown error') });
    }
  };

  const revoke = async (t: ApiTokenSummary) => {
    const ok = await confirm({ tone: 'danger', title: `Revoke ${t.name}?`, description: 'Anything using this token stops working immediately.', confirmLabel: 'Revoke' });
    if (!ok) return;
    try {
      const updated = await serviceAccountsApi.revokeToken(account.id, t.id);
      setTokens((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
      toast.success('Token revoked', { description: t.name });
    } catch (err) {
      toast.error("Couldn't revoke token", { description: teamErrorMessage(err, 'Unknown error') });
    }
  };

  const columns: DataTableColumn<ApiTokenSummary>[] = [
    { key: 'name', header: 'Token', cell: (t) => (
      <div className="min-w-0"><div className="truncate font-medium text-ink-primary">{t.name}</div>
        <code className="font-mono text-xs text-ink-tertiary">{t.prefix}…</code></div>) },
    { key: 'state', header: 'Status', cell: (t) => <StatusTag status={tokenState(t)} /> },
    { key: 'expiresAt', header: 'Expires', hideBelow: 'sm', cell: (t) => fmt(t.revokedAt ?? t.expiresAt) },
    { key: 'lastUsedAt', header: 'Last used', hideBelow: 'md', cell: (t) => fmt(t.lastUsedAt) ?? 'Never' },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Tokens of ${account.name}`}
      description="API tokens sign requests as this service account." size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-4">
        <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField label="Token name" className="flex-1">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. production" disabled={creating} />
          </FormField>
          <FormField label="Valid for (days)" className="sm:w-36">
            <Input type="number" min={1} max={365} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} disabled={creating} />
          </FormField>
          <Button type="submit" variant="secondary" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
            isLoading={creating} disabled={!newName.trim()}>New token</Button>
        </form>
        <Panel padding="none">
          <DataTable caption="API tokens" dense columns={columns} rows={tokens} getRowId={(t) => t.id}
            rowActions={(t) => tokenState(t) !== 'active' ? [] : [
              { label: 'Rotate', icon: <RefreshCw />, onSelect: () => void rotate(t) },
              { label: 'Revoke', icon: <Trash2 />, tone: 'danger', separatorBefore: true, onSelect: () => void revoke(t) },
            ]}
            rowActionsLabel={(t) => `Actions for ${t.name}`}
            isLoading={loading} error={error} errorTitle="Couldn't load tokens" onRetry={() => void fetchTokens()}
            empty={<EmptyState size="sm" icon={<KeyRound />} title="No tokens yet" description="Name one above and create it." />} />
        </Panel>
      </div>
    </Modal>
  );
}
