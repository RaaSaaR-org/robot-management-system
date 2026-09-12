/**
 * @file ModelBrowser.tsx
 * @description Model registry table: search, status / source / skill filters,
 *              row click opens the details, row actions deploy or copy the URI
 * @feature deployment
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Archive, Boxes, Copy, Pencil, Rocket, Search } from 'lucide-react';
import {
  Badge, Button, DataTable, EmptyState, Panel, SearchInput, Select, StatusTag, Toolbar,
  type DataTableColumn, type RowActionItem,
} from '@/shared/components/ui';
import { cn, formatTimeAgo } from '@/shared/utils';
import { useDeploymentStore, selectSkills } from '../store';
import { MODEL_SOURCE_KIND_LABELS, ModelSourceKinds } from '../types';
import type { ModelVersion } from '../types';
import { getModelDisplayName, resolveSkillName, UNLINKED_SKILL_LABEL } from './models/modelDisplay';

export interface ModelBrowserProps {
  modelVersions: ModelVersion[];
  /** Opens the details of a version (row click). */
  onSelectVersion?: (version: ModelVersion) => void;
  /** Deploys a staging version; offered as a row action when given. */
  onDeploy?: (version: ModelVersion) => void;
  /** Copies the artifact URI; offered as a row action when given. */
  onCopyUri?: (version: ModelVersion) => void;
  /** Opens the edit form (name, skill link); offered as a row action when given. */
  onEdit?: (version: ModelVersion) => void;
  /** Archives a staging version; offered last, as the menu's destructive act. */
  onArchive?: (version: ModelVersion) => void;
  isLoading?: boolean;
  /** Primary action of the empty state. */
  emptyAction?: ReactNode;
  /** @deprecated rows are no longer "selected"; kept for API compatibility. */
  selectedVersionId?: string;
  className?: string;
}

const UNLINKED_FILTER = '__unlinked__';

const STATUS_OPTIONS = [
  { value: 'staging', label: 'Staging' },
  { value: 'canary', label: 'Canary' },
  { value: 'production', label: 'Production' },
  { value: 'archived', label: 'Archived' },
];

const SOURCE_OPTIONS = ModelSourceKinds.map((kind) => ({ value: kind, label: MODEL_SOURCE_KIND_LABELS[kind] }));

export function ModelBrowser({
  modelVersions, onSelectVersion, onDeploy, onCopyUri, onEdit, onArchive, isLoading = false, emptyAction, className,
}: ModelBrowserProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [skill, setSkill] = useState('');

  // `GET /api/models/versions` returns the skill id but not the relation, so
  // names are resolved from the skills ModelsPage loads into the store.
  const skills = useDeploymentStore(selectSkills);
  const skillNamesById = useMemo(() => new Map(skills.map((s) => [s.id, s.name])), [skills]);
  const byId = useMemo(() => new Map(modelVersions.map((v) => [v.id, v])), [modelVersions]);

  const skillOptions = useMemo(() => {
    const names = new Map<string, string>();
    modelVersions.forEach((v) => {
      const name = resolveSkillName(v, skillNamesById);
      if (name) names.set(v.skillId, name);
    });
    const linked = Array.from(names, ([value, label]) => ({ value, label }));
    linked.sort((a, b) => a.label.localeCompare(b.label));
    return [...linked, { value: UNLINKED_FILTER, label: UNLINKED_SKILL_LABEL }];
  }, [modelVersions, skillNamesById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return modelVersions.filter((v) => {
      if (status && v.deploymentStatus !== status) return false;
      if (source && v.sourceKind !== source) return false;
      if (skill === UNLINKED_FILTER && v.skillId) return false;
      if (skill && skill !== UNLINKED_FILTER && v.skillId !== skill) return false;
      if (!q) return true;
      const text = [getModelDisplayName(v), v.version, resolveSkillName(v, skillNamesById) ?? ''].join(' ');
      return text.toLowerCase().includes(q);
    });
  }, [modelVersions, query, status, source, skill, skillNamesById]);

  const hasFilters = Boolean(query || status || source || skill);
  const clearFilters = () => {
    setQuery('');
    setStatus('');
    setSource('');
    setSkill('');
  };

  const parentName = (v: ModelVersion): string | null => {
    if (!v.parentModelVersionId) return null;
    const parent = v.parent ?? byId.get(v.parentModelVersionId);
    return parent ? getModelDisplayName(parent) : `Model ${v.parentModelVersionId.slice(0, 8)}`;
  };

  const columns: DataTableColumn<ModelVersion>[] = [
    {
      key: 'name', header: 'Name', sortable: true,
      sortValue: (v) => getModelDisplayName(v).toLowerCase(),
      cell: (v) => (
        <div className="min-w-0 max-w-[16rem] sm:max-w-sm">
          <div className="truncate font-medium text-ink-primary">{getModelDisplayName(v)}</div>
          <div className="truncate text-[13px] text-ink-tertiary">v{v.version}</div>
        </div>
      ),
    },
    {
      key: 'skill', header: 'Skill', sortable: true, hideBelow: 'md',
      // Unlinked versions sort last: the table puts empty values at the end.
      sortValue: (v) => resolveSkillName(v, skillNamesById)?.toLowerCase() ?? null,
      cell: (v) => {
        const name = resolveSkillName(v, skillNamesById);
        return name
          ? <span className="text-ink-primary">{name}</span>
          : <span className="text-ink-tertiary">{UNLINKED_SKILL_LABEL}</span>;
      },
    },
    {
      key: 'source', header: 'Source', sortable: true, hideBelow: 'sm',
      sortValue: (v) => v.sourceKind ?? null,
      cell: (v) => (v.sourceKind
        ? <Badge variant="neutral" size="sm">{MODEL_SOURCE_KIND_LABELS[v.sourceKind]}</Badge>
        : null),
    },
    {
      key: 'status', header: 'Status', sortable: true, sortValue: (v) => v.deploymentStatus,
      cell: (v) => <StatusTag status={v.deploymentStatus} dot />,
    },
    {
      key: 'parent', header: 'Derived from', hideBelow: 'lg',
      cell: (v) => {
        const name = parentName(v);
        return name ? <span className="text-ink-secondary">{name}</span> : null;
      },
    },
    {
      key: 'createdAt', header: 'Created', align: 'right', sortable: true, hideBelow: 'md',
      sortValue: (v) => new Date(v.createdAt),
      cell: (v) => <span className="text-ink-secondary">{formatTimeAgo(v.createdAt)}</span>,
    },
  ];

  // Order: Edit, the other verbs, then the destructive act last (a model version has no delete;
  // archiving a staging version is how it leaves the deploy list).
  const rowActions = onDeploy || onCopyUri || onEdit || onArchive
    ? (v: ModelVersion): RowActionItem[] => {
        const items: RowActionItem[] = [];
        if (onEdit) items.push({ label: 'Edit', icon: <Pencil />, onSelect: () => onEdit(v) });
        if (onDeploy && v.deploymentStatus === 'staging') {
          items.push({ label: 'Deploy', icon: <Rocket />, onSelect: () => onDeploy(v) });
        }
        if (onCopyUri) items.push({ label: 'Copy artifact URI', icon: <Copy />, onSelect: () => onCopyUri(v) });
        if (onArchive && v.deploymentStatus === 'staging') {
          items.push({ label: 'Archive', icon: <Archive />, tone: 'danger', separatorBefore: true, onSelect: () => onArchive(v) });
        }
        return items;
      }
    : undefined;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search models" />}
        filters={
          <>
            <Select aria-label="Status" fullWidth={false} className="w-40" placeholder="All statuses"
              options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
            <Select aria-label="Source" fullWidth={false} className="w-40" placeholder="All sources"
              options={SOURCE_OPTIONS} value={source} onChange={(e) => setSource(e.target.value)} />
            <Select aria-label="Skill" fullWidth={false} className="w-48" placeholder="All skills"
              options={skillOptions} value={skill} onChange={(e) => setSkill(e.target.value)} />
          </>
        }
      />

      <Panel padding="none">
        <DataTable
          caption="Model versions"
          columns={columns}
          rows={filtered}
          getRowId={(v) => v.id}
          defaultSort={{ key: 'skill', direction: 'asc' }}
          onRowClick={onSelectVersion}
          rowActions={rowActions}
          rowActionsLabel={(v) => `Actions for ${getModelDisplayName(v)}`}
          isLoading={isLoading}
          empty={hasFilters ? (
            <EmptyState icon={<Search />} title="No models match" description="Try another name, or clear the filters."
              action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<Boxes />} title="No models yet"
              description="Models arrive from training runs, or register one trained elsewhere."
              action={emptyAction} />
          )}
        />
      </Panel>
    </div>
  );
}
