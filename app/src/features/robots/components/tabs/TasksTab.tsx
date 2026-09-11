/**
 * @file TasksTab.tsx
 * @description Tasks panel of the Activity tab: the processes assigned to the
 *              robot as a table; a row opens the process.
 * @feature robots
 */

import { useNavigate } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  LinkButton,
  Panel,
  StatusTag,
  type DataTableColumn,
} from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils/format';
import type { Process } from '@/features/processes/types';
import type { TasksTabProps } from './types';

const COLUMNS: DataTableColumn<Process>[] = [
  {
    key: 'name',
    header: 'Task',
    sortable: true,
    cell: (t) => <span className="text-ink-primary">{t.name}</span>,
  },
  { key: 'status', header: 'Status', sortable: true, cell: (t) => <StatusTag status={t.status} /> },
  {
    key: 'progress',
    header: 'Progress',
    align: 'right',
    sortable: true,
    hideBelow: 'sm',
    cell: (t) => <span className="tabular-nums">{Math.round(t.progress ?? 0)}%</span>,
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    align: 'right',
    sortable: true,
    hideBelow: 'md',
    sortValue: (t) => (t.updatedAt ? new Date(t.updatedAt) : null),
    cell: (t) => (
      <span className="text-ink-tertiary">{t.updatedAt ? formatTimeAgo(t.updatedAt) : '—'}</span>
    ),
  },
];

export function TasksTab({ robotId, tasks }: TasksTabProps) {
  const navigate = useNavigate();
  const allTasks = `/processes?robotId=${robotId}`;

  return (
    <Panel>
      <Panel.Header
        title="Tasks"
        actions={
          <LinkButton to={allTasks} variant="ghost" size="sm">
            View all
          </LinkButton>
        }
      />
      <DataTable
        caption="Tasks assigned to this robot"
        columns={COLUMNS}
        rows={tasks}
        getRowId={(t) => t.id}
        onRowClick={(t) => navigate(`/processes/${t.id}`)}
        empty={
          <EmptyState
            size="sm"
            icon={<ListChecks />}
            title="No tasks yet"
            description="Tasks assigned to this robot show up here."
            action={
              <LinkButton to={allTasks} variant="secondary" size="sm">
                Go to tasks
              </LinkButton>
            }
          />
        }
      />
    </Panel>
  );
}
