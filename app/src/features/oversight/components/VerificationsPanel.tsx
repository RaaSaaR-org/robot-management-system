/**
 * @file VerificationsPanel.tsx
 * @description Verifications that are due: complete (confirmed) or defer, with toasts
 * @feature oversight
 */

import { CalendarClock, Check, Clock } from 'lucide-react';
import { DataTable, EmptyState, Panel, StatusTag, confirm, toast, type DataTableColumn } from '@/shared/components/ui';
import type { CompleteVerificationInput, DueVerification } from '../types';
import { errorMessage, formatInterval } from './oversightFormat';

export interface VerificationsPanelProps {
  due: DueVerification[];
  isLoading: boolean;
  robotName: (id: string | null) => string;
  onComplete: (input: CompleteVerificationInput) => Promise<void>;
  className?: string;
}

function overdueLabel(minutes: number): string {
  if (minutes <= 0) return 'Due now';
  if (minutes < 60) return `${minutes}m overdue`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h overdue`;
  return `${Math.floor(minutes / 1440)}d overdue`;
}

export function VerificationsPanel({ due, isLoading, robotName, onComplete, className }: VerificationsPanelProps) {
  const scopeName = (v: DueVerification) =>
    v.schedule.robotScope === 'robot' ? robotName(v.schedule.scopeId) : v.schedule.robotScope === 'zone' ? `Zone ${v.schedule.scopeId ?? ''}` : 'All robots';

  const complete = async (v: DueVerification) => {
    const ok = await confirm({
      title: `Record that you checked ${scopeName(v)}'s outputs?`,
      description: `"${v.schedule.name}" is logged as completed by you and the next check is due ${formatInterval(v.schedule.intervalMinutes).toLowerCase()}.`,
      confirmLabel: 'Complete verification',
    });
    if (!ok) return;
    try {
      await onComplete({ scheduleId: v.schedule.id, status: 'completed', robotId: v.schedule.scopeId ?? undefined });
      toast.success('Verification completed', { description: v.schedule.name });
    } catch (err) {
      toast.error("Couldn't complete verification", { description: errorMessage(err) });
    }
  };

  const defer = async (v: DueVerification) => {
    try {
      await onComplete({ scheduleId: v.schedule.id, status: 'deferred' });
      toast.success('Verification deferred', { description: v.schedule.name });
    } catch (err) {
      toast.error("Couldn't defer verification", { description: errorMessage(err) });
    }
  };

  const columns: DataTableColumn<DueVerification>[] = [
    {
      key: 'name',
      header: 'Verification',
      cell: (v) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink-primary">{v.schedule.name}</div>
          <div className="truncate text-[13px] text-ink-tertiary">
            {scopeName(v)} · {formatInterval(v.schedule.intervalMinutes)}
          </div>
        </div>
      ),
    },
    {
      key: 'due',
      header: 'Due',
      align: 'right',
      sortable: true,
      sortValue: (v) => -v.overdueSinceMinutes,
      cell: (v) => <StatusTag tone={v.overdueSinceMinutes > 0 ? 'stopped' : 'gated'}>{overdueLabel(v.overdueSinceMinutes)}</StatusTag>,
    },
  ];

  return (
    <Panel padding="none" className={className}>
      <Panel.Header title="Verifications due" description="Scheduled checks where a person confirms the robots' outputs." />
      <DataTable
        caption="Verifications due"
        dense
        columns={columns}
        rows={due}
        getRowId={(v) => v.schedule.id}
        defaultSort={{ key: 'due', direction: 'asc' }}
        rowActions={(v) => [
          { label: 'Complete', icon: <Check className="h-4 w-4" />, onSelect: () => void complete(v) },
          { label: 'Defer', icon: <Clock className="h-4 w-4" />, onSelect: () => void defer(v) },
        ]}
        rowActionsLabel={(v) => `Actions for ${v.schedule.name}`}
        isLoading={isLoading}
        empty={<EmptyState size="sm" icon={<CalendarClock />} title="Nothing due" description="Scheduled verifications appear here when they are due." />}
      />
    </Panel>
  );
}
