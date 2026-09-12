/**
 * @file TeamPage.tsx
 * @description Team: members and service accounts of the current organization, as ?tab= sections.
 * The header's primary switches with the tab.
 * @feature team
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, UserPlus } from 'lucide-react';
import { Button, PageHeader, Tabs, toast } from '@/shared/components/ui';
import { useFeatures } from '@/shared/hooks';
import { EnvVar, GatedNotice } from '@/features/organizations/components/GatedNotice';
import { useTeamStore } from '../store/teamStore';
import { useServiceAccountsStore } from '../store/serviceAccountsStore';
import { AddTeammateModal } from '../components/AddTeammateModal';
import { CredentialsHandoffModal } from '../components/CredentialsHandoffModal';
import { MembersSection } from '../components/MembersSection';
import { ServiceAccountFormModal } from '../components/ServiceAccountFormModal';
import { ServiceAccountsSection } from '../components/ServiceAccountsSection';
import { ServiceAccountTokensModal } from '../components/ServiceAccountTokensModal';
import type { TeamMember } from '../types/team.types';
import type { ServiceAccount } from '../types/serviceAccount.types';

type Handoff = { member: TeamMember; secret: string; kind: 'password' | 'token' };

export function TeamPage() {
  const { multiTenancyEnabled } = useFeatures();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'service-accounts' ? 'service-accounts' : 'members';

  const members = useTeamStore((s) => s.members);
  const membersLoaded = useTeamStore((s) => s.loaded);
  const membersLoading = useTeamStore((s) => s.loading);
  const fetchMembers = useTeamStore((s) => s.fetch);
  const accounts = useServiceAccountsStore((s) => s.accounts);
  const accountsLoaded = useServiceAccountsStore((s) => s.loaded);
  const accountsLoading = useServiceAccountsStore((s) => s.loading);
  const fetchAccounts = useServiceAccountsStore((s) => s.fetch);

  const [addOpen, setAddOpen] = useState(false);
  const [saOpen, setSaOpen] = useState(false);
  const [tokensFor, setTokensFor] = useState<ServiceAccount | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  useEffect(() => {
    if (!membersLoaded && !membersLoading) void fetchMembers();
  }, [membersLoaded, membersLoading, fetchMembers]);
  useEffect(() => {
    if (!accountsLoaded && !accountsLoading) void fetchAccounts();
  }, [accountsLoaded, accountsLoading, fetchAccounts]);

  const setTab = (id: string) =>
    setParams((p) => { if (id === 'members') p.delete('tab'); else p.set('tab', id); return p; }, { replace: true });

  const addTeammate = (
    <Button leftIcon={<UserPlus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setAddOpen(true)}>Add teammate</Button>
  );
  const newServiceAccount = (
    <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setSaOpen(true)}>New service account</Button>
  );

  const closeHandoff = () => {
    if (handoff?.kind === 'password') toast.success('Teammate added', { description: handoff.member.name });
    setHandoff(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Team"
        description="People and service accounts that can reach this organization."
        actions={tab === 'members' ? addTeammate : newServiceAccount}
      />

      {!multiTenancyEnabled && (
        <GatedNotice>
          Members are listed, but per-organization access only applies when the server runs with{' '}
          <EnvVar>MULTI_TENANCY_ENABLED=true</EnvVar>.
        </GatedNotice>
      )}

      <Tabs
        label="Team sections"
        activeTab={tab}
        onTabChange={setTab}
        tabs={[
          { id: 'members', label: 'Members', count: membersLoaded ? members.length : undefined },
          { id: 'service-accounts', label: 'Service accounts', count: accountsLoaded ? accounts.filter((a) => a.isActive).length : undefined },
        ]}
      />

      {tab === 'members' ? (
        <MembersSection addAction={addTeammate} />
      ) : (
        <ServiceAccountsSection createAction={newServiceAccount} onManageTokens={setTokensFor} />
      )}

      <AddTeammateModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(r) => setHandoff({ member: r.member, secret: r.tempPassword, kind: 'password' })}
      />
      <ServiceAccountFormModal isOpen={saOpen} onClose={() => setSaOpen(false)} />
      <ServiceAccountTokensModal
        isOpen={tokensFor !== null && handoff === null}
        account={tokensFor}
        onClose={() => setTokensFor(null)}
        onTokenCreated={(plaintext, name) =>
          setHandoff({
            kind: 'token',
            secret: plaintext,
            member: { id: '', email: name, name, role: 'member', isActive: true, lastLoginAt: null, createdAt: '' },
          })
        }
      />
      <CredentialsHandoffModal
        isOpen={handoff !== null}
        member={handoff?.member ?? null}
        tempPassword={handoff?.secret ?? null}
        onClose={closeHandoff}
        {...(handoff?.kind === 'token'
          ? {
              title: 'Copy the new token',
              credentialLabel: 'API token',
              copyLabel: 'Copy token',
              warningText: 'This token is not shown again. Store it in your secret manager now.',
              helperText: 'Send it in the Authorization header as a Bearer token.',
            }
          : {})}
      />
    </div>
  );
}
