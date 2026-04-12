/**
 * @file TeamPage.tsx
 * @description Team management page — lists members and service accounts of
 * the current tenant. Lets the owner add/change-role/deactivate members and
 * manage service accounts + API tokens.
 * @feature team
 */

import { useEffect, useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { useFeatures } from '@/shared/hooks';
import { useTeamStore } from '../store/teamStore';
import { useServiceAccountsStore } from '../store/serviceAccountsStore';
import { TeamMemberRow } from '../components/TeamMemberRow';
import { AddTeamMemberModal } from '../components/AddTeamMemberModal';
import { CredentialsHandoffModal } from '../components/CredentialsHandoffModal';
import { ServiceAccountRow } from '../components/ServiceAccountRow';
import { CreateServiceAccountModal } from '../components/CreateServiceAccountModal';
import { ServiceAccountTokensModal } from '../components/ServiceAccountTokensModal';
import type { TeamMember, AddTeamMemberResult } from '../types/team.types';
import type { ServiceAccount } from '../types/serviceAccount.types';

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

export function TeamPage() {
  const { multiTenancyEnabled } = useFeatures();

  // Team members
  const members = useTeamStore((s) => s.members);
  const membersLoaded = useTeamStore((s) => s.loaded);
  const membersLoading = useTeamStore((s) => s.loading);
  const membersError = useTeamStore((s) => s.error);
  const fetchMembers = useTeamStore((s) => s.fetch);
  const changeRole = useTeamStore((s) => s.changeRole);
  const setActive = useTeamStore((s) => s.setActive);

  // Service accounts
  const accounts = useServiceAccountsStore((s) => s.accounts);
  const accountsLoaded = useServiceAccountsStore((s) => s.loaded);
  const accountsLoading = useServiceAccountsStore((s) => s.loading);
  const accountsError = useServiceAccountsStore((s) => s.error);
  const fetchAccounts = useServiceAccountsStore((s) => s.fetch);
  const removeAccount = useServiceAccountsStore((s) => s.remove);

  // Modal state
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [credsMember, setCredsMember] = useState<TeamMember | null>(null);
  const [credsPassword, setCredsPassword] = useState<string | null>(null);
  const [credsLabel, setCredsLabel] = useState<string | undefined>(undefined);
  const [credsCopyLabel, setCredsCopyLabel] = useState<string | undefined>(undefined);
  const [credsWarning, setCredsWarning] = useState<string | undefined>(undefined);
  const [credsHelper, setCredsHelper] = useState<string | undefined>(undefined);

  const [addSaOpen, setAddSaOpen] = useState(false);
  const [tokensAccount, setTokensAccount] = useState<ServiceAccount | null>(null);

  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!membersLoaded && !membersLoading) void fetchMembers();
  }, [membersLoaded, membersLoading, fetchMembers]);

  useEffect(() => {
    if (!accountsLoaded && !accountsLoading) void fetchAccounts();
  }, [accountsLoaded, accountsLoading, fetchAccounts]);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.kind === 'error' ? 5000 : 2500;
    const t = window.setTimeout(() => setToast(null), ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Member add flow
  const handleMemberAdded = (result: AddTeamMemberResult) => {
    setCredsLabel(undefined);
    setCredsCopyLabel(undefined);
    setCredsWarning(undefined);
    setCredsHelper(undefined);
    setCredsMember(result.member);
    setCredsPassword(result.tempPassword);
  };

  const handleCloseCreds = () => {
    setCredsMember(null);
    setCredsPassword(null);
    setToast({ kind: 'success', message: credsLabel === 'API Token' ? 'Token copied' : 'Teammate added' });
  };

  // Service account token created/rotated
  const handleTokenCreated = (plaintext: string, accountName: string) => {
    setCredsLabel('API Token');
    setCredsCopyLabel('Copy token');
    setCredsWarning('This token will not be shown again.');
    setCredsHelper('Use this token in the Authorization header: Bearer ndsa_...');
    setCredsMember({ id: '', email: accountName, name: accountName, role: 'member', isActive: true, lastLoginAt: null, createdAt: '' });
    setCredsPassword(plaintext);
  };

  // Service account created
  const handleSaCreated = () => {
    setToast({ kind: 'success', message: 'Service account created' });
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

      {/* ================================================================== */}
      {/* TEAM MEMBERS */}
      {/* ================================================================== */}
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
          onClick={() => setAddMemberOpen(true)}
          leftIcon={<PlusIcon />}
        >
          Add teammate
        </Button>
      </div>

      {membersLoaded && (
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

      {membersError && (
        <div className="mb-6 rounded-brand border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {membersError}
        </div>
      )}

      {!membersLoaded && membersLoading ? (
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
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Name</th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Email</th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Role</th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Last login</th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Actions</th>
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

      {/* ================================================================== */}
      {/* SERVICE ACCOUNTS */}
      {/* ================================================================== */}
      <div className="mt-10 flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-theme-primary">Service Accounts</h2>
          <p className="text-sm text-theme-secondary mt-1">
            Bot users for AI agents, CI/CD pipelines, and integrations.
            Each service account can have multiple API tokens.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setAddSaOpen(true)}
          leftIcon={<PlusIcon />}
        >
          Add service account
        </Button>
      </div>

      {accountsError && (
        <div className="mb-6 rounded-brand border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {accountsError}
        </div>
      )}

      {!accountsLoaded && accountsLoading ? (
        <div className="text-sm text-theme-tertiary">Loading service accounts…</div>
      ) : accounts.length === 0 ? (
        <div className="rounded-brand border border-theme bg-theme-card px-4 py-8 text-center text-sm text-theme-tertiary">
          No service accounts yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-brand border border-theme bg-theme-card">
          <table className="w-full text-left">
            <thead className="bg-theme-elevated border-b border-theme">
              <tr>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Name</th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Role</th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Tokens</th>
                <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Last used</th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-theme-tertiary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <ServiceAccountRow
                  key={a.id}
                  account={a}
                  onManageTokens={setTokensAccount}
                  onDelete={removeAccount}
                  onError={(message) => setToast({ kind: 'error', message })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ================================================================== */}
      {/* TOAST */}
      {/* ================================================================== */}
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

      {/* ================================================================== */}
      {/* MODALS */}
      {/* ================================================================== */}
      <AddTeamMemberModal
        isOpen={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        onAdded={handleMemberAdded}
      />

      <CredentialsHandoffModal
        isOpen={credsMember !== null}
        member={credsMember}
        tempPassword={credsPassword}
        onClose={handleCloseCreds}
        credentialLabel={credsLabel}
        copyLabel={credsCopyLabel}
        warningText={credsWarning}
        helperText={credsHelper}
      />

      <CreateServiceAccountModal
        isOpen={addSaOpen}
        onClose={() => setAddSaOpen(false)}
        onCreated={handleSaCreated}
      />

      <ServiceAccountTokensModal
        isOpen={tokensAccount !== null}
        account={tokensAccount}
        onClose={() => setTokensAccount(null)}
        onTokenCreated={handleTokenCreated}
      />
    </div>
  );
}
