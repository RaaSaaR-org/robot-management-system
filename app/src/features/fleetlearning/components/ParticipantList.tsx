/**
 * @file ParticipantList.tsx
 * @description Table of the robots taking part in a federated round
 * @feature fleetlearning
 */

import { Bot } from 'lucide-react';
import { DataTable, EmptyState, StatusTag, type DataTableColumn } from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { PARTICIPANT_STATUS_LABELS, type FederatedParticipant } from '../types/fleetlearning.types';

export interface ParticipantListProps {
  participants: FederatedParticipant[];
  isLoading?: boolean;
  /** Maps a robot id to its name. */
  robotName?: (robotId: string) => string;
  className?: string;
}

function lastUpdate(p: FederatedParticipant): string | undefined {
  return p.uploadedAt ?? p.trainingCompletedAt ?? p.trainingStartedAt ?? p.modelReceivedAt;
}

export function ParticipantList({ participants, isLoading, robotName, className }: ParticipantListProps) {
  const columns: DataTableColumn<FederatedParticipant>[] = [
    {
      key: 'robotId', header: 'Robot', sortable: true,
      cell: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-primary">{robotName?.(p.robotId) ?? p.robotId}</div>
          {p.failureReason && <div className="truncate text-[13px] text-signal-stopped">{p.failureReason}</div>}
        </div>
      ),
    },
    {
      key: 'status', header: 'Status', sortable: true,
      cell: (p) => <StatusTag status={p.status} dot>{PARTICIPANT_STATUS_LABELS[p.status]}</StatusTag>,
    },
    {
      key: 'localSamples', header: 'Samples', align: 'right', sortable: true, hideBelow: 'sm',
      cell: (p) => (p.localSamples !== undefined ? p.localSamples.toLocaleString(UI_DATE_LOCALE) : null),
    },
    {
      key: 'localLoss', header: 'Local loss', align: 'right', sortable: true, hideBelow: 'md',
      cell: (p) => (p.localLoss !== undefined ? p.localLoss.toFixed(4) : null),
    },
    {
      key: 'updated', header: 'Updated', align: 'right', hideBelow: 'sm', sortable: true,
      sortValue: (p) => (lastUpdate(p) ? new Date(lastUpdate(p)!) : null),
      cell: (p) => {
        const at = lastUpdate(p);
        return at ? <span className="text-ink-secondary">{formatTimeAgo(at)}</span> : null;
      },
    },
  ];

  return (
    <DataTable
      className={className}
      caption="Participants"
      columns={columns}
      rows={participants}
      getRowId={(p) => p.id}
      isLoading={isLoading}
      empty={<EmptyState icon={<Bot />} title="No participants yet" description="Robots are selected when the round starts." />}
    />
  );
}
