/**
 * @file OrganizationsPage.tsx
 * @description Organizations (tenants): list, create, edit, delete, onboard. The route stays
 * mounted with multi-tenancy off so direct navigation works; a gated notice says what that means.
 * @feature organizations
 */

import { useEffect, useMemo, useState } from 'react';
import { Building2, Pencil, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import {
  Button, DataTable, EmptyState, PageHeader, Panel, SearchInput, Select, StatusTag, Toolbar,
  confirm, toast, type DataTableColumn,
} from '@/shared/components/ui';
import { useFeatures } from '@/shared/hooks';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { useOrganizationsStore } from '../store/organizationsStore';
import { EnvVar, GatedNotice } from '../components/GatedNotice';
import { OnboardingWizard } from '../components/OnboardingWizard';
import { OrganizationFormModal, orgErrorMessage } from '../components/OrganizationFormModal';
import type { Organization } from '../types/organizations.types';

const SAMPLE_ORG = { name: 'Acme Robotics', slug: 'acme' };
const plus = <Plus className="h-4 w-4" strokeWidth={1.75} />;

export function OrganizationsPage() {
  const { multiTenancyEnabled } = useFeatures();
  const list = useOrganizationsStore((s) => s.list);
  const listLoaded = useOrganizationsStore((s) => s.listLoaded);
  const listLoading = useOrganizationsStore((s) => s.listLoading);
  const error = useOrganizationsStore((s) => s.error);
  const fetchList = useOrganizationsStore((s) => s.fetchList);
  const remove = useOrganizationsStore((s) => s.remove);

  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Organization | null>(null);
  const [prefill, setPrefill] = useState<{ name: string; slug: string } | undefined>();
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    if (!listLoaded && !listLoading) void fetchList();
  }, [listLoaded, listLoading, fetchList]);

  const plans = useMemo(
    () => [...new Set(list.map((o) => o.plan).filter((p): p is string => Boolean(p)))].sort(),
    [list],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(
      (o) => (!plan || o.plan === plan) && (!q || o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q)),
    );
  }, [list, query, plan]);

  const openCreate = (sample?: { name: string; slug: string }) => {
    setEditing(null);
    setPrefill(sample);
    setFormOpen(true);
  };
  const openEdit = (o: Organization) => {
    setEditing(o);
    setPrefill(undefined);
    setFormOpen(true);
  };

  const askDelete = async (o: Organization) => {
    const ok = await confirm({
      tone: 'danger',
      title: `Delete ${o.name}?`,
      description: 'Its users lose access. The server refuses while the organization still owns robots or data.',
    });
    if (!ok) return;
    try {
      await remove(o.id);
      toast.success('Organization deleted', { description: o.name });
    } catch (err) {
      toast.error("Couldn't delete organization", { description: orgErrorMessage(err, 'Unknown error') });
    }
  };

  const columns: DataTableColumn<Organization>[] = [
    {
      key: 'name', header: 'Name', sortable: true, sortValue: (o) => o.name.toLowerCase(),
      cell: (o) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink-primary">{o.name}</span>
            {o.isDefault && <StatusTag tone="neutral">Default</StatusTag>}
          </div>
          <code className="font-mono text-xs text-ink-tertiary">{o.slug}</code>
        </div>
      ),
    },
    { key: 'plan', header: 'Plan', sortable: true, sortValue: (o) => o.plan, cell: (o) => (o.plan ? <StatusTag tone="accent">{o.plan}</StatusTag> : null) },
    { key: 'users', header: 'Users', align: 'right', sortable: true, sortValue: (o) => o.counts.users, cell: (o) => o.counts.users },
    { key: 'robots', header: 'Robots', align: 'right', sortable: true, hideBelow: 'sm', sortValue: (o) => o.counts.robots, cell: (o) => o.counts.robots },
    { key: 'datasets', header: 'Datasets', align: 'right', sortable: true, hideBelow: 'md', sortValue: (o) => o.counts.datasets, cell: (o) => o.counts.datasets },
    {
      key: 'createdAt', header: 'Created', align: 'right', sortable: true, hideBelow: 'md',
      sortValue: (o) => new Date(o.createdAt), cell: (o) => new Date(o.createdAt).toLocaleDateString(UI_DATE_LOCALE),
    },
  ];

  const hasFilters = Boolean(query || plan);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Organizations"
        description="Every tenant on this platform, with its users and robots."
        actions={
          <>
            <Button variant="secondary" leftIcon={<UserPlus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setWizardOpen(true)}>
              Onboard customer
            </Button>
            <Button leftIcon={plus} onClick={() => openCreate()}>New organization</Button>
          </>
        }
      />

      {!multiTenancyEnabled && (
        <GatedNotice>
          Organizations are listed, but tenant isolation only applies when the server runs with{' '}
          <EnvVar>MULTI_TENANCY_ENABLED=true</EnvVar>.
        </GatedNotice>
      )}

      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search organizations" />}
        filters={
          plans.length > 0 && (
            <Select aria-label="Plan" fullWidth={false} className="w-40" placeholder="All plans"
              options={plans.map((p) => ({ value: p, label: p }))} value={plan} onChange={(e) => setPlan(e.target.value)} />
          )
        }
      />

      <Panel padding="none">
        <DataTable
          caption="Organizations"
          columns={columns}
          rows={filtered}
          getRowId={(o) => o.id}
          defaultSort={{ key: 'createdAt', direction: 'asc' }}
          onRowClick={openEdit}
          rowActions={(o) => [
            { label: 'Edit', icon: <Pencil />, onSelect: () => openEdit(o) },
            ...(o.isDefault
              ? []
              : [{ label: 'Delete', icon: <Trash2 />, tone: 'danger' as const, separatorBefore: true, onSelect: () => void askDelete(o) }]),
          ]}
          rowActionsLabel={(o) => `Actions for ${o.name}`}
          isLoading={!listLoaded && listLoading}
          error={listLoaded ? null : error}
          errorTitle="Couldn't load organizations"
          onRetry={() => void fetchList()}
          empty={
            hasFilters ? (
              <EmptyState icon={<Search />} title="No organizations match" description="Try another name or plan, or clear the filters."
                action={<Button variant="secondary" onClick={() => { setQuery(''); setPlan(''); }}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={<Building2 />} title="No organizations yet"
                description="An organization is a tenant with its own users, robots and data."
                action={<Button leftIcon={plus} onClick={() => openCreate()}>New organization</Button>}
                secondaryAction={<Button variant="secondary" onClick={() => openCreate(SAMPLE_ORG)}>Load sample</Button>} />
            )
          }
        />
      </Panel>

      <OrganizationFormModal isOpen={formOpen} organization={editing} prefill={prefill} onClose={() => setFormOpen(false)} />
      <OnboardingWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
