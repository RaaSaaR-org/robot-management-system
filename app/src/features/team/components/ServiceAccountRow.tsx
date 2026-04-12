/**
 * @file ServiceAccountRow.tsx
 * @description Table row for a service account in the Team page (TASK-165).
 * @feature team
 */

import { useState } from 'react';
import type { ServiceAccount } from '../types/serviceAccount.types';

interface ServiceAccountRowProps {
  account: ServiceAccount;
  onManageTokens: (account: ServiceAccount) => void;
  onDelete: (id: string) => Promise<void>;
  onError?: (message: string) => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

export function ServiceAccountRow({
  account,
  onManageTokens,
  onDelete,
  onError,
}: ServiceAccountRowProps) {
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    setBusy(true);
    try {
      await onDelete(account.id);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to delete service account';
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr
      className={`border-b border-theme last:border-b-0 transition-colors hover:bg-theme-hover ${
        account.isActive ? '' : 'opacity-60'
      }`}
    >
      {/* Name + bot icon */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-accent-500/20 border border-accent-500/30 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-theme-primary truncate">
              {account.name}
            </div>
            <div className="text-xs text-theme-tertiary truncate">
              {account.email}
            </div>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          {account.role}
        </span>
      </td>

      {/* Tokens */}
      <td className="px-4 py-3 text-sm text-theme-secondary tabular-nums">
        {account.tokenCount} active
      </td>

      {/* Last used */}
      <td className="px-4 py-3 text-sm text-theme-tertiary tabular-nums whitespace-nowrap">
        {formatRelative(account.lastUsedAt)}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onManageTokens(account)}
            disabled={busy}
            className="text-xs text-theme-tertiary hover:text-theme-primary border border-theme hover:border-brand rounded-brand px-2 py-1 transition-colors disabled:opacity-50"
          >
            Tokens
          </button>
          {account.isActive && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500 rounded-brand px-2 py-1 transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
