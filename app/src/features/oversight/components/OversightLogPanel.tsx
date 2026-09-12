/**
 * @file OversightLogPanel.tsx
 * @description Recent human oversight actions as a dense table
 * @feature oversight
 */

import { ScrollText } from 'lucide-react';
import { DataTable, EmptyState, Panel, StatusTag, type DataTableColumn, type Tone } from '@/shared/components/ui';
import type { OversightActionType, OversightLog } from '../types';
import { humanize } from './oversightFormat';

export interface OversightLogPanelProps {
  logs: OversightLog[];
  isLoading: boolean;
  className?: string;
}

function actionTone(action: OversightActionType): Tone {
  if (action === 'robot_stopped' || action === 'fleet_stopped') return 'danger';
  if (action === 'manual_mode_activated' || action === 'decision_overridden') return 'warning';
  if (action === 'verification_completed' || action === 'anomaly_resolved') return 'success';
  return 'neutral';
}

export function OversightLogPanel({ logs, isLoading, className }: OversightLogPanelProps) {
  const columns: DataTableColumn<OversightLog>[] = [
    {
      key: 'timestamp',
      header: 'Time',
      sortable: true,
      sortValue: (l) => new Date(l.timestamp),
      cell: (l) => <span className="whitespace-nowrap text-[13px] text-ink-tertiary">{new Date(l.timestamp).toLocaleString()}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      cell: (l) => <StatusTag tone={actionTone(l.actionType)}>{humanize(l.actionType)}</StatusTag>,
    },
    {
      key: 'robot',
      header: 'Robot',
      hideBelow: 'sm',
      cell: (l) =>
        l.robotName ? (
          <span className="text-sm text-ink-primary">{l.robotName}</span>
        ) : l.robotId ? (
          <code className="font-mono text-[13px] text-ink-secondary">{l.robotId}</code>
        ) : undefined,
    },
    { key: 'operator', header: 'Operator', hideBelow: 'md', cell: (l) => l.operatorName ?? l.operatorId },
    {
      key: 'reason',
      header: 'Reason',
      hideBelow: 'lg',
      cell: (l) => <span className="block max-w-[28rem] truncate text-[13px] text-ink-secondary" title={l.reason}>{l.reason}</span>,
    },
  ];

  return (
    <Panel padding="none" className={className}>
      <Panel.Header title="Oversight log" description="Every human intervention, newest first." />
      <DataTable
        caption="Oversight log"
        dense
        columns={columns}
        rows={logs}
        getRowId={(l) => l.id}
        defaultSort={{ key: 'timestamp', direction: 'desc' }}
        isLoading={isLoading}
        empty={<EmptyState size="sm" icon={<ScrollText />} title="No oversight actions yet" description="Manual control, acknowledged anomalies and completed verifications are logged here." />}
      />
    </Panel>
  );
}
