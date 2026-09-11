/**
 * @file CommandsTab.tsx
 * @description Command panels of the Activity tab: a natural-language command
 *              bar with quick Charge / Home acts, and the command history table.
 * @feature robots
 */

import { BatteryCharging, Home, Terminal } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  StatusTag,
  type DataTableColumn,
} from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils/format';
import { CommandBar } from '@/features/command';
import { isRobotAvailable, COMMAND_TYPE_LABELS } from '../../types/robots.types';
import type { RobotCommand } from '../../types/robots.types';
import type { CommandsTabProps } from './types';

const ICON = 'h-4 w-4';

const COLUMNS: DataTableColumn<RobotCommand>[] = [
  {
    key: 'type',
    header: 'Command',
    sortable: true,
    sortValue: (c) => COMMAND_TYPE_LABELS[c.type] || c.type,
    cell: (c) => <span className="text-ink-primary">{COMMAND_TYPE_LABELS[c.type] || c.type}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    sortable: true,
    cell: (c) => <StatusTag status={c.status} />,
  },
  {
    key: 'createdAt',
    header: 'Sent',
    align: 'right',
    sortable: true,
    hideBelow: 'sm',
    sortValue: (c) => new Date(c.createdAt),
    cell: (c) => <span className="text-ink-tertiary">{formatTimeAgo(c.createdAt)}</span>,
  },
];

export function CommandsTab({
  robot,
  robotId,
  commandHistory,
  isCommandLoading,
  canExecuteCommands,
  onSendToCharge,
  onReturnHome,
}: CommandsTabProps) {
  const available = isRobotAvailable(robot);

  return (
    <>
      <Panel>
        <Panel.Header
          title="Send a command"
          description={`Tell ${robot.name} what to do in plain words, or use a quick act.`}
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canExecuteCommands}
                isLoading={isCommandLoading}
                onClick={() => void onSendToCharge()}
                leftIcon={<BatteryCharging className={ICON} strokeWidth={1.75} />}
              >
                Send to charge
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!canExecuteCommands}
                isLoading={isCommandLoading}
                onClick={() => void onReturnHome()}
                leftIcon={<Home className={ICON} strokeWidth={1.75} />}
              >
                Return home
              </Button>
            </>
          }
        />
        <Panel.Body className="flex flex-col gap-3">
          <CommandBar robotId={robotId} robotName={robot.name} />
          {!available && (
            <p className="text-xs text-ink-tertiary">
              {robot.name} must be online to receive commands.
            </p>
          )}
        </Panel.Body>
      </Panel>

      <Panel>
        <Panel.Header title="Command history" />
        <DataTable
          caption="Command history"
          columns={COLUMNS}
          rows={commandHistory}
          getRowId={(c) => c.id}
          defaultSort={{ key: 'createdAt', direction: 'desc' }}
          empty={
            <EmptyState
              size="sm"
              icon={<Terminal />}
              title="No commands yet"
              description="Commands sent to this robot show up here with their result."
            />
          }
        />
      </Panel>
    </>
  );
}
