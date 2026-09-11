/**
 * @file SkillsSection.tsx
 * @description The Skills tab of /deployments: Toolbar, skills DataTable (or chains view via
 * ?view=chains), skill details modal, New/Edit skill FormModal and Run on robot
 * @feature deployment
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, BookOpen, CheckCircle2, GraduationCap, Pencil, Play, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  LinkButton,
  Panel,
  SearchInput,
  SegmentedControl,
  Select,
  StatusTag,
  Toolbar,
  confirm,
  toast,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import { useDeploymentStore } from '../store';
import { SkillStatuses, type SkillDefinition } from '../types';
import { ChainsTable } from './ChainsTable';
import { RunSkillModal } from './RunSkillModal';
import { SkillDetailsModal } from './SkillDetailsModal';
import { SkillFormModal } from './SkillFormModal';
import { deployToneFor, errorMessage } from './deploymentHelpers';

export interface SkillsSectionProps {
  /** The page header's "New skill" button opens the form through this. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

type View = 'skills' | 'chains';
const icon = 'h-4 w-4';
const STATUS_OPTIONS = SkillStatuses.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }));

export function SkillsSection({ createOpen, onCreateOpenChange }: SkillsSectionProps) {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'chains' ? 'chains' : 'skills';
  const setView = (v: View) =>
    setParams((p) => { if (v === 'skills') p.delete('view'); else p.set('view', v); return p; }, { replace: true });

  const skills = useDeploymentStore((s) => s.skills);
  const skillsLoading = useDeploymentStore((s) => s.skillsLoading);
  const skillsError = useDeploymentStore((s) => s.skillsError);
  const chains = useDeploymentStore((s) => s.skillChains);
  const chainsLoading = useDeploymentStore((s) => s.skillChainsLoading);
  const chainsError = useDeploymentStore((s) => s.skillChainsError);
  const fetchSkills = useDeploymentStore((s) => s.fetchSkills);
  const fetchChains = useDeploymentStore((s) => s.fetchSkillChains);
  const publishSkill = useDeploymentStore((s) => s.publishSkill);
  const deprecateSkill = useDeploymentStore((s) => s.deprecateSkill);
  const archiveSkill = useDeploymentStore((s) => s.archiveSkill);
  const deleteSkill = useDeploymentStore((s) => s.deleteSkill);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [capability, setCapability] = useState('');
  const [details, setDetails] = useState<SkillDefinition | null>(null);
  const [editing, setEditing] = useState<SkillDefinition | null>(null);
  const [running, setRunning] = useState<SkillDefinition | null>(null);

  useEffect(() => {
    void fetchSkills();
    void fetchChains();
  }, [fetchSkills, fetchChains]);

  const capabilityOptions = useMemo(
    () => Array.from(new Set(skills.flatMap((s) => s.requiredCapabilities))).sort().map((c) => ({ value: c, label: c })),
    [skills],
  );

  const q = query.trim().toLowerCase();
  const filteredSkills = useMemo(
    () => skills.filter((s) =>
      (!status || s.status === status) &&
      (!capability || s.requiredCapabilities.includes(capability)) &&
      (!q || `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q))),
    [skills, status, capability, q],
  );
  const filteredChains = useMemo(
    () => chains.filter((c) => !q || `${c.name} ${c.description ?? ''}`.toLowerCase().includes(q)),
    [chains, q],
  );

  const hasFilters = Boolean(q || (view === 'skills' && (status || capability)));
  const clearFilters = () => { setQuery(''); setStatus(''); setCapability(''); };
  const openEdit = (s: SkillDefinition) => { setDetails(null); setEditing(s); };
  const openRun = (s: SkillDefinition) => { setDetails(null); setRunning(s); };

  const lifecycle = async (s: SkillDefinition, kind: 'publish' | 'deprecate' | 'archive') => {
    const copy = {
      publish: { title: `Publish ${s.name}?`, description: 'Robots and automations can run it once it is published.', label: 'Publish', done: 'Skill published' },
      deprecate: { title: `Deprecate ${s.name}?`, description: 'It keeps working, but new automations are warned off it.', label: 'Deprecate', done: 'Skill deprecated' },
      archive: { title: `Archive ${s.name}?`, description: 'Robots can no longer run it. Its history is kept.', label: 'Archive', done: 'Skill archived' },
    }[kind];
    if (!(await confirm({ title: copy.title, description: copy.description, confirmLabel: copy.label }))) return;
    try {
      await { publish: publishSkill, deprecate: deprecateSkill, archive: archiveSkill }[kind](s.id);
      toast.success(copy.done, { description: s.name });
    } catch (err) {
      toast.error(`Couldn't ${kind} the skill`, { description: errorMessage(err) });
    }
  };

  const askDelete = async (s: SkillDefinition) => {
    if (!(await confirm({ title: `Delete ${s.name}?`, description: 'The skill is removed. Chains and automations that use it stop working.', tone: 'danger' }))) return;
    try {
      await deleteSkill(s.id);
      toast.success('Skill deleted', { description: s.name });
    } catch (err) {
      toast.error("Couldn't delete the skill", { description: errorMessage(err) });
    }
  };

  const rowActions = (s: SkillDefinition): RowActionItem[] => {
    const items: RowActionItem[] = [
      { label: 'Run on robot', icon: <Play className={icon} />, onSelect: () => openRun(s) },
      { label: 'Edit', icon: <Pencil className={icon} />, onSelect: () => openEdit(s) },
    ];
    if (s.status === 'draft') items.push({ label: 'Publish', icon: <CheckCircle2 className={icon} />, onSelect: () => void lifecycle(s, 'publish') });
    if (s.status === 'published') items.push({ label: 'Deprecate', icon: <TriangleAlert className={icon} />, onSelect: () => void lifecycle(s, 'deprecate') });
    // The server archives only draft or deprecated skills; a published one is deprecated first.
    if (s.status === 'draft' || s.status === 'deprecated')
      items.push({ label: 'Archive', icon: <Archive className={icon} />, onSelect: () => void lifecycle(s, 'archive') });
    // The server refuses to delete a published skill ("Deprecate or archive it instead").
    if (s.status !== 'published')
      items.push({ label: 'Delete', icon: <Trash2 className={icon} />, tone: 'danger', separatorBefore: true, onSelect: () => void askDelete(s) });
    return items;
  };

  const columns: DataTableColumn<SkillDefinition>[] = [
    {
      key: 'name', header: 'Name', sortable: true, sortValue: (s) => s.name.toLowerCase(),
      cell: (s) => (
        <div className="min-w-0 max-w-md">
          <div className="truncate font-medium text-ink-primary">{s.name}</div>
          {s.description && <div className="truncate text-[13px] text-ink-tertiary">{s.description}</div>}
        </div>
      ),
    },
    { key: 'version', header: 'Version', hideBelow: 'sm', cell: (s) => `v${s.version}` },
    { key: 'status', header: 'Status', sortable: true, cell: (s) => <StatusTag status={s.status} tone={deployToneFor(s.status)} dot /> },
    {
      key: 'capabilities', header: 'Capabilities', hideBelow: 'md',
      cell: (s) => s.requiredCapabilities.length === 0 ? undefined : (
        <span className="flex flex-wrap gap-1">
          {s.requiredCapabilities.slice(0, 2).map((c) => <Badge key={c} size="sm">{c}</Badge>)}
          {s.requiredCapabilities.length > 2 && <Badge size="sm">+{s.requiredCapabilities.length - 2}</Badge>}
        </span>
      ),
    },
    { key: 'updatedAt', header: 'Updated', align: 'right', sortable: true, hideBelow: 'md', sortValue: (s) => new Date(s.updatedAt), cell: (s) => formatTimeAgo(s.updatedAt) },
  ];

  return (
    <>
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder={view === 'skills' ? 'Search skills' : 'Search chains'} />}
        filters={view === 'skills' ? (
          <>
            <Select aria-label="Status" fullWidth={false} className="w-40" placeholder="All statuses" options={STATUS_OPTIONS}
              value={status} onChange={(e) => setStatus(e.target.value)} />
            <Select aria-label="Capability" fullWidth={false} className="w-44" placeholder="All capabilities" options={capabilityOptions}
              value={capability} onChange={(e) => setCapability(e.target.value)} />
          </>
        ) : undefined}
        actions={
          <>
            <LinkButton to="/pipeline" variant="ghost" size="sm" leftIcon={<GraduationCap className={icon} strokeWidth={1.75} />}>Skill training</LinkButton>
            <SegmentedControl label="View" options={[{ value: 'skills', label: 'Skills' }, { value: 'chains', label: 'Chains' }]} value={view} onChange={setView} />
          </>
        }
      />

      {view === 'skills' ? (
        <Panel padding="none">
          <DataTable
            caption="Skills"
            columns={columns}
            rows={filteredSkills}
            getRowId={(s) => s.id}
            defaultSort={{ key: 'name', direction: 'asc' }}
            onRowClick={setDetails}
            rowActions={rowActions}
            rowActionsLabel={(s) => `Actions for ${s.name}`}
            isLoading={skillsLoading}
            error={skillsError}
            errorTitle="Couldn't load skills"
            onRetry={() => void fetchSkills()}
            empty={hasFilters ? (
              <EmptyState icon={<Search />} title="No skills match" description="Try another name, or clear the filters."
                action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
            ) : (
              <EmptyState icon={<BookOpen />} title="No skills yet" description="A skill is a behaviour a robot can execute, like picking an apple."
                action={<Button leftIcon={<Plus className={icon} />} onClick={() => onCreateOpenChange(true)}>New skill</Button>} />
            )}
          />
        </Panel>
      ) : (
        <ChainsTable chains={filteredChains} isLoading={chainsLoading} error={chainsError} onRetry={() => void fetchChains()}
          hasFilters={Boolean(q)} onClearFilters={clearFilters} />
      )}

      <SkillDetailsModal skill={details} onClose={() => setDetails(null)} onEdit={openEdit} onRun={openRun} />
      <SkillFormModal
        isOpen={createOpen || editing !== null}
        skill={editing}
        onClose={() => { setEditing(null); onCreateOpenChange(false); }}
      />
      <RunSkillModal isOpen={running !== null} skill={running} onClose={() => setRunning(null)} />
    </>
  );
}
