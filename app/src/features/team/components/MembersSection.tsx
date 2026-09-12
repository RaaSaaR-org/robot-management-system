/**
 * @file MembersSection.tsx
 * @description Team > Members: search, role filter, DataTable; change role, deactivate / reactivate
 * @feature team
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Search, UserCheck, UserCog, UserX, Users } from 'lucide-react';
import {
  Button, DataTable, EmptyState, Panel, SearchInput, Select, StatusTag, Toolbar, confirm, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { useTeamStore } from '../store/teamStore';
import type { TeamMember } from '../types/team.types';
import { ChangeRoleModal } from './ChangeRoleModal';
import { teamErrorMessage } from './teamErrors';

const ROLE_FILTER = [
  { value: 'super-admin', label: 'Super-admin' },
  { value: 'owner', label: 'Owner' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];

export function MembersSection({ addAction }: { addAction: ReactNode }) {
  const members = useTeamStore((s) => s.members);
  const loaded = useTeamStore((s) => s.loaded);
  const loading = useTeamStore((s) => s.loading);
  const error = useTeamStore((s) => s.error);
  const fetchMembers = useTeamStore((s) => s.fetch);
  const setActive = useTeamStore((s) => s.setActive);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [roleFor, setRoleFor] = useState<TeamMember | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => (!role || m.role === role) && (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)));
  }, [members, query, role]);

  const toggleActive = async (m: TeamMember) => {
    const deactivate = m.isActive;
    const ok = await confirm(
      deactivate
        ? { tone: 'danger', title: `Deactivate ${m.name}?`, description: 'They can no longer sign in. Their data stays.', confirmLabel: 'Deactivate' }
        : { title: `Reactivate ${m.name}?`, description: 'They can sign in again with their current password.', confirmLabel: 'Reactivate' },
    );
    if (!ok) return;
    try {
      await setActive(m.id, !deactivate);
      toast.success(deactivate ? 'Teammate deactivated' : 'Teammate reactivated', { description: m.name });
    } catch (err) {
      toast.error(deactivate ? "Couldn't deactivate teammate" : "Couldn't reactivate teammate", { description: teamErrorMessage(err, 'Unknown error') });
    }
  };

  const columns: DataTableColumn<TeamMember>[] = [
    { key: 'name', header: 'Name', sortable: true, sortValue: (m) => m.name.toLowerCase(), cell: (m) => (
      <div className="min-w-0"><div className="truncate font-medium text-ink-primary">{m.name}</div>
        <div className="truncate text-[13px] text-ink-tertiary">{m.email}</div></div>) },
    { key: 'role', header: 'Role', sortable: true, cell: (m) => <StatusTag tone={m.role === 'super-admin' ? 'accent' : 'neutral'}>{m.role}</StatusTag> },
    { key: 'isActive', header: 'Status', sortable: true, sortValue: (m) => m.isActive, cell: (m) =>
      m.isActive ? <StatusTag tone="live" dot>Active</StatusTag> : <StatusTag tone="neutral" dot>Deactivated</StatusTag> },
    { key: 'lastLoginAt', header: 'Last sign-in', align: 'right', sortable: true, hideBelow: 'md',
      sortValue: (m) => (m.lastLoginAt ? new Date(m.lastLoginAt) : null),
      cell: (m) => (m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString(UI_DATE_LOCALE) : 'Never') },
  ];

  const hasFilters = Boolean(query || role);

  return (
    <>
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search people" />}
        filters={<Select aria-label="Role" fullWidth={false} className="w-40" placeholder="All roles" options={ROLE_FILTER} value={role} onChange={(e) => setRole(e.target.value)} />}
      />
      <Panel padding="none">
        <DataTable
          caption="Team members" columns={columns} rows={filtered} getRowId={(m) => m.id}
          defaultSort={{ key: 'name', direction: 'asc' }}
          rowActions={(m) => m.role === 'super-admin' ? [] : [
            ...(m.isActive ? [{ label: 'Change role', icon: <UserCog />, onSelect: () => setRoleFor(m) }] : []),
            m.isActive
              ? { label: 'Deactivate', icon: <UserX />, tone: 'danger' as const, separatorBefore: true, onSelect: () => void toggleActive(m) }
              : { label: 'Reactivate', icon: <UserCheck />, onSelect: () => void toggleActive(m) },
          ]}
          rowActionsLabel={(m) => `Actions for ${m.name}`}
          isLoading={!loaded && loading} error={loaded ? null : error} errorTitle="Couldn't load the team" onRetry={() => void fetchMembers()}
          empty={hasFilters ? (
            <EmptyState icon={<Search />} title="No teammates match" description="Try another name or role, or clear the filters."
              action={<Button variant="secondary" onClick={() => { setQuery(''); setRole(''); }}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<Users />} title="No teammates yet" description="Teammates sign in to this organization with their own account." action={addAction} />
          )}
        />
      </Panel>
      <ChangeRoleModal member={roleFor} onClose={() => setRoleFor(null)} />
    </>
  );
}
