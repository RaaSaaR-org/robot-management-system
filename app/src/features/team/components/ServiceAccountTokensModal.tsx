/**
 * @file ServiceAccountTokensModal.tsx
 * @description Modal for managing API tokens of a service account (TASK-165).
 * Lists existing tokens, allows creating new ones, rotating, and revoking.
 * @feature team
 */

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Input } from '@/shared/components/ui/Input';
import { serviceAccountsApi } from '../api/serviceAccountsApi';
import type {
  ServiceAccount,
  ApiTokenSummary,
} from '../types/serviceAccount.types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

interface ServiceAccountTokensModalProps {
  isOpen: boolean;
  account: ServiceAccount | null;
  onClose: () => void;
  onTokenCreated: (plaintext: string, accountName: string) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(UI_DATE_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export function ServiceAccountTokensModal({
  isOpen,
  account,
  onClose,
  onTokenCreated,
}: ServiceAccountTokensModalProps) {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create token form
  const [newName, setNewName] = useState('');
  const [expiryDays, setExpiryDays] = useState(90);
  const [creating, setCreating] = useState(false);

  const fetchTokens = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const list = await serviceAccountsApi.listTokens(account.id);
      setTokens(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (isOpen && account) {
      setError(null);
      setNewName('');
      setExpiryDays(90);
      setCreating(false);
      void fetchTokens();
    }
  }, [isOpen, account, fetchTokens]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account || !newName.trim()) return;

    setCreating(true);
    setError(null);
    try {
      const result = await serviceAccountsApi.createToken(account.id, {
        name: newName.trim(),
        expiresInDays: expiryDays,
      });
      setTokens((prev) => [result.token, ...prev]);
      setNewName('');
      onTokenCreated(result.plaintext, account.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    if (!account) return;
    try {
      const updated = await serviceAccountsApi.revokeToken(account.id, tokenId);
      setTokens((prev) => prev.map((t) => (t.id === tokenId ? updated : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token');
    }
  };

  const handleRotate = async (tokenId: string) => {
    if (!account) return;
    try {
      const result = await serviceAccountsApi.rotateToken(account.id, tokenId);
      setTokens((prev) => [
        result.newToken,
        ...prev.map((t) =>
          t.id === tokenId
            ? { ...t, expiresAt: result.oldTokenExpiresAt }
            : t
        ),
      ]);
      onTokenCreated(result.plaintext, account.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate token');
    }
  };

  if (!account) return null;

  const activeTokens = tokens.filter((t) => !t.revokedAt && !isExpired(t.expiresAt));
  const inactiveTokens = tokens.filter((t) => t.revokedAt || isExpired(t.expiresAt));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Tokens — ${account.name}`}
      size="lg"
      footer={
        <div className="flex justify-end w-full">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Create token form */}
        <form onSubmit={handleCreate} className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="New token"
              placeholder="e.g. production, staging"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
              fullWidth
            />
          </div>
          <div className="w-28">
            <Input
              label="Expires (days)"
              type="number"
              min={1}
              max={365}
              value={String(expiryDays)}
              onChange={(e) => setExpiryDays(Number(e.target.value))}
              disabled={creating}
              fullWidth
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            isLoading={creating}
            loadingText="…"
            disabled={!newName.trim()}
          >
            Create
          </Button>
        </form>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-brand px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-theme-tertiary">Loading tokens…</div>
        ) : tokens.length === 0 ? (
          <div className="text-sm text-theme-tertiary text-center py-4">
            No tokens yet. Create one above.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Active tokens */}
            {activeTokens.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-theme-tertiary mb-2">
                  Active ({activeTokens.length})
                </h4>
                <div className="space-y-1">
                  {activeTokens.map((t) => (
                    <TokenRow
                      key={t.id}
                      token={t}
                      onRevoke={handleRevoke}
                      onRotate={handleRotate}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Inactive tokens */}
            {inactiveTokens.length > 0 && (
              <div>
                <h4 className="text-xs uppercase tracking-wider text-theme-tertiary mb-2">
                  Revoked / Expired ({inactiveTokens.length})
                </h4>
                <div className="space-y-1 opacity-60">
                  {inactiveTokens.map((t) => (
                    <TokenRow key={t.id} token={t} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ============================================================================
// TOKEN ROW
// ============================================================================

function TokenRow({
  token,
  onRevoke,
  onRotate,
}: {
  token: ApiTokenSummary;
  onRevoke?: (id: string) => Promise<void>;
  onRotate?: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const expired = isExpired(token.expiresAt);
  const revoked = !!token.revokedAt;
  const active = !expired && !revoked;

  const handleRevoke = async () => {
    if (!onRevoke) return;
    setBusy(true);
    try {
      await onRevoke(token.id);
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async () => {
    if (!onRotate) return;
    setBusy(true);
    try {
      await onRotate(token.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-brand border border-theme bg-theme-card text-sm">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-theme-primary truncate">
            {token.name}
          </span>
          <code className="text-xs text-theme-tertiary font-mono">
            {token.prefix}…
          </code>
        </div>
        <div className="text-xs text-theme-tertiary mt-0.5">
          {revoked && <span className="text-red-400">Revoked {formatDate(token.revokedAt)}</span>}
          {!revoked && expired && <span className="text-amber-400">Expired {formatDate(token.expiresAt)}</span>}
          {active && (
            <>
              Expires {formatDate(token.expiresAt)}
              {token.lastUsedAt && <> · Last used {formatDate(token.lastUsedAt)}</>}
            </>
          )}
        </div>
      </div>

      {active && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleRotate}
            disabled={busy}
            className="text-xs text-theme-tertiary hover:text-theme-primary border border-theme hover:border-brand rounded-brand px-2 py-1 transition-colors disabled:opacity-50"
          >
            Rotate
          </button>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={busy}
            className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500 rounded-brand px-2 py-1 transition-colors disabled:opacity-50"
          >
            Revoke
          </button>
        </div>
      )}
    </div>
  );
}
