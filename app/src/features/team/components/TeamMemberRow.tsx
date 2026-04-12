/**
 * @file TeamMemberRow.tsx
 * @description Single row in the team list — avatar, name, email, inline
 * role editor, last-login, and active/deactivated toggle.
 * @feature team
 */

import { useState } from 'react';

import type { TeamMember, AssignableRole } from '../types/team.types';

interface TeamMemberRowProps {
  member: TeamMember;
  onChangeRole: (id: string, role: AssignableRole) => Promise<void>;
  onSetActive: (id: string, isActive: boolean) => Promise<void>;
  /**
   * Called when a mutation fails (e.g. last-owner guard, network error).
   * The page surfaces the message as a toast — the row itself has no
   * room to render a readable error inline.
   */
  onError?: (message: string) => void;
}

const ASSIGNABLE_ROLES: AssignableRole[] = ['owner', 'member', 'viewer'];

function formatLastLogin(iso: string | null): string {
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

function extractMessage(err: unknown, fallback: string): string {
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string' &&
    (err as { message: string }).message
  ) {
    return (err as { message: string }).message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function TeamMemberRow({
  member,
  onChangeRole,
  onSetActive,
  onError,
}: TeamMemberRowProps) {
  const [busy, setBusy] = useState(false);

  const handleRoleChange = async (value: string) => {
    if (value === member.role) return;
    setBusy(true);
    try {
      await onChangeRole(member.id, value as AssignableRole);
    } catch (err) {
      onError?.(extractMessage(err, 'Failed to change role'));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async () => {
    setBusy(true);
    try {
      await onSetActive(member.id, !member.isActive);
    } catch (err) {
      onError?.(extractMessage(err, 'Failed to update member'));
    } finally {
      setBusy(false);
    }
  };

  const initial = member.name.trim().charAt(0).toUpperCase() || '?';
  const isSuperAdmin = member.role === 'super-admin';

  return (
    <div
      className={`rounded-brand border border-theme bg-theme-card px-4 py-3 flex items-center gap-4 transition-opacity ${
        member.isActive ? '' : 'opacity-50'
      }`}
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand font-semibold shrink-0">
        {initial}
      </div>

      {/* Identity */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-sm font-semibold text-theme-primary truncate">
            {member.name}
          </div>
          {!member.isActive && (
            <span className="text-xs uppercase tracking-wider text-theme-tertiary border border-theme rounded px-1.5 py-0.5">
              Deactivated
            </span>
          )}
        </div>
        <div className="text-xs text-theme-tertiary truncate">{member.email}</div>
      </div>

      {/* Role */}
      <div className="shrink-0">
        {isSuperAdmin ? (
          <div className="text-xs font-semibold text-brand uppercase tracking-wider">
            super-admin
          </div>
        ) : (
          <select
            value={member.role}
            onChange={(e) => handleRoleChange(e.target.value)}
            disabled={busy || !member.isActive}
            className="bg-theme-card border border-theme rounded-brand px-2 py-1 text-sm text-theme-primary focus:outline-none focus:border-brand disabled:opacity-50"
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Last login */}
      <div className="shrink-0 text-xs text-theme-tertiary tabular-nums w-24 text-right">
        {formatLastLogin(member.lastLoginAt)}
      </div>

      {/* Action */}
      {!isSuperAdmin && (
        <button
          type="button"
          onClick={handleToggleActive}
          disabled={busy}
          className="shrink-0 text-xs text-theme-tertiary hover:text-theme-primary border border-theme hover:border-brand rounded-brand px-2 py-1 transition-colors disabled:opacity-50"
        >
          {member.isActive ? 'Deactivate' : 'Reactivate'}
        </button>
      )}
    </div>
  );
}
