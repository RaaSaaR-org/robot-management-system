/**
 * @file TeamPage.tsx
 * @description Team management page — lists members of the current tenant
 * and lets the owner add/change-role/deactivate. Visible only to owners
 * (and super-admins via impersonation — TASK-160).
 * @feature team
 */

import { useEffect, useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { useFeatures } from '@/shared/hooks';
import { useTeamStore } from '../store/teamStore';
import { TeamMemberRow } from '../components/TeamMemberRow';
import { AddTeamMemberModal } from '../components/AddTeamMemberModal';
import { CredentialsHandoffModal } from '../components/CredentialsHandoffModal';
import type {
  TeamMember,
  AddTeamMemberResult,
} from '../types/team.types';

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

export function TeamPage() {
  const { multiTenancyEnabled } = useFeatures();

  const members = useTeamStore((s) => s.members);
  const loaded = useTeamStore((s) => s.loaded);
  const loading = useTeamStore((s) => s.loading);
  const error = useTeamStore((s) => s.error);
  const fetch = useTeamStore((s) => s.fetch);
  const changeRole = useTeamStore((s) => s.changeRole);
  const setActive = useTeamStore((s) => s.setActive);

  const [addOpen, setAddOpen] = useState(false);
  const [credsMember, setCredsMember] = useState<TeamMember | null>(null);
  const [credsPassword, setCredsPassword] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!loaded && !loading) {
      void fetch();
    }
  }, [loaded, loading, fetch]);

  useEffect(() => {
    if (!toast) return;
    // Error toasts persist longer so users have time to read them.
    const ms = toast.kind === 'error' ? 5000 : 2500;
    const t = window.setTimeout(() => setToast(null), ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleAdded = (result: AddTeamMemberResult) => {
    setCredsMember(result.member);
    setCredsPassword(result.tempPassword);
  };

  const handleCloseCreds = () => {
    // Wipe the plaintext password from React state when the modal closes —
    // matches the "not shown again" contract from the task spec.
    setCredsMember(null);
    setCredsPassword(null);
    setToast({ kind: 'success', message: 'Teammate added' });
  };

  const activeCount = members.filter((m) => m.isActive).length;
  const inactiveCount = members.length - activeCount;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      {!multiTenancyEnabled && (
        <div className="mb-6 rounded-brand border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <strong className="font-semibold">Multi-tenancy is disabled.</strong>{' '}
          Set <code className="font-mono">MULTI_TENANCY_ENABLED=true</code> in{' '}
          <code className="font-mono">server/.env</code> and restart to use the
          Team page.
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-theme-primary">Team</h1>
          <p className="text-sm text-theme-secondary mt-1">
            Manage members of your organization. Add new teammates with a
            temporary password — they'll set their own on first login.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setAddOpen(true)}
          leftIcon={<PlusIcon />}
        >
          Add teammate
        </Button>
      </div>

      {loaded && (
        <div className="mb-6 flex items-center gap-6 text-sm text-theme-tertiary">
          <span>
            <span className="text-theme-primary font-semibold tabular-nums">
              {activeCount}
            </span>{' '}
            active
          </span>
          {inactiveCount > 0 && (
            <span>
              <span className="text-theme-primary font-semibold tabular-nums">
                {inactiveCount}
              </span>{' '}
              deactivated
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-brand border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loaded && loading ? (
        <div className="text-sm text-theme-tertiary">Loading team…</div>
      ) : members.length === 0 ? (
        <div className="rounded-brand border border-theme bg-theme-card px-4 py-8 text-center text-sm text-theme-tertiary">
          No team members yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-brand border border-theme bg-theme-card">
          <table className="w-full text-left">
            <thead className="bg-theme-elevated border-b border-theme">
              <tr>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">
                  Name
                </th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">
                  Email
                </th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">
                  Role
                </th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">
                  Last login
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-theme-tertiary">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <TeamMemberRow
                  key={m.id}
                  member={m}
                  onChangeRole={changeRole}
                  onSetActive={setActive}
                  onError={(message) => setToast({ kind: 'error', message })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-brand px-4 py-3 text-sm shadow-xl animate-in fade-in slide-in-from-bottom-2 ${
            toast.kind === 'error'
              ? 'border border-red-500/40 bg-red-500/10 text-red-200'
              : 'border border-theme bg-theme-card text-theme-primary'
          }`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          {toast.message}
        </div>
      )}

      <AddTeamMemberModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={handleAdded}
      />

      <CredentialsHandoffModal
        isOpen={credsMember !== null}
        member={credsMember}
        tempPassword={credsPassword}
        onClose={handleCloseCreds}
      />
    </div>
  );
}
