/**
 * @file ChainsTable.tsx
 * @description Skill chains view of the Skills tab: DataTable with Activate / Archive / Delete
 * @feature deployment
 */

import { Archive, Link2, Play, Search, Trash2 } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  LinkButton,
  Panel,
  StatusTag,
  confirm,
  toast,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import { useDeploymentStore } from '../store';
import type { SkillChain } from '../types';
import { errorMessage } from '@/shared/components/ui';

export interface ChainsTableProps {
  chains: SkillChain[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  hasFilters: boolean;
  onClearFilters: () => void;
}

const icon = 'h-4 w-4';

export function ChainsTable({ chains, isLoading, error, onRetry, hasFilters, onClearFilters }: ChainsTableProps) {
  const activateChain = useDeploymentStore((s) => s.activateChain);
  const archiveChain = useDeploymentStore((s) => s.archiveChain);
  const deleteChain = useDeploymentStore((s) => s.deleteSkillChain);

  const act = async (c: SkillChain, kind: 'activate' | 'archive') => {
    const ok = await confirm(
      kind === 'activate'
        ? { title: `Activate ${c.name}?`, description: 'Automations can run the chain once it is active.', confirmLabel: 'Activate' }
        : { title: `Archive ${c.name}?`, description: 'Automations stop using the chain. You can still read it.', confirmLabel: 'Archive' },
    );
    if (!ok) return;
    try {
      await (kind === 'activate' ? activateChain(c.id) : archiveChain(c.id));
      toast.success(kind === 'activate' ? 'Chain activated' : 'Chain archived', { description: c.name });
    } catch (err) {
      toast.error(`Couldn't ${kind} the chain`, { description: errorMessage(err) });
    }
  };

  const askDelete = async (c: SkillChain) => {
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      description: 'The chain and its steps are removed. Automations that use it stop working.',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteChain(c.id);
      toast.success('Chain deleted', { description: c.name });
    } catch (err) {
      toast.error("Couldn't delete the chain", { description: errorMessage(err) });
    }
  };

  const columns: DataTableColumn<SkillChain>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      cell: (c) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-primary">{c.name}</div>
          {c.description && <div className="truncate text-[13px] text-ink-tertiary">{c.description}</div>}
        </div>
      ),
    },
    { key: 'steps', header: 'Steps', align: 'right', sortable: true, sortValue: (c) => c.steps.length, cell: (c) => c.steps.length },
    { key: 'status', header: 'Status', sortable: true, cell: (c) => <StatusTag status={c.status} dot /> },
    { key: 'version', header: 'Version', hideBelow: 'sm', cell: (c) => `v${c.version}` },
  ];

  const rowActions = (c: SkillChain): RowActionItem[] => {
    const items: RowActionItem[] = [];
    if (c.status === 'draft') items.push({ label: 'Activate', icon: <Play className={icon} />, onSelect: () => void act(c, 'activate') });
    if (c.status === 'active') items.push({ label: 'Archive', icon: <Archive className={icon} />, onSelect: () => void act(c, 'archive') });
    // The server refuses to delete an active chain ("Archive it first"), so Delete appears once it is not.
    if (c.status !== 'active')
      items.push({ label: 'Delete', icon: <Trash2 className={icon} />, tone: 'danger', separatorBefore: items.length > 0, onSelect: () => void askDelete(c) });
    return items;
  };

  return (
    <Panel padding="none">
      <DataTable
        caption="Skill chains"
        columns={columns}
        rows={chains}
        getRowId={(c) => c.id}
        defaultSort={{ key: 'name', direction: 'asc' }}
        rowActions={rowActions}
        rowActionsLabel={(c) => `Actions for ${c.name}`}
        isLoading={isLoading}
        error={error}
        errorTitle="Couldn't load skill chains"
        onRetry={onRetry}
        empty={
          hasFilters ? (
            <EmptyState icon={<Search />} title="No chains match" description="Try another name, or clear the filters."
              action={<Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={<Link2 />} title="No skill chains yet"
              description="Chains run several skills in order. Build them in Automations."
              action={<LinkButton to="/processes" variant="secondary">Open automations</LinkButton>} />
          )
        }
      />
    </Panel>
  );
}
