/**
 * @file ApprovalQueue.tsx
 * @description Table of approval requests with row actions (escalate, cancel)
 * @feature approvals
 */

import { ArrowUpCircle, CheckCircle2, Eye, Search, XCircle } from 'lucide-react';
import {
  Button, DataTable, EmptyState,
  Panel, StatusTag, confirm,
  errorMessage, toast,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useApprovalsStore } from '../store';
import type { ApprovalRequest } from '../types';
import { formatRelative, humanize, isOpen, priorityTone, slaInfo, statusTone } from './approvalFormat';

export interface ApprovalQueueProps {
  rows: ApprovalRequest[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (request: ApprovalRequest) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
}

const icon = 'h-4 w-4';
const PRIORITY_ORDER = ['low', 'normal', 'high', 'critical', 'urgent'];

export function ApprovalQueue({ rows, isLoading, error, onRetry, onOpen, hasFilters, onClearFilters }: ApprovalQueueProps) {
  const escalate = useApprovalsStore((s) => s.escalateApprovalRequest);
  const cancel = useApprovalsStore((s) => s.cancelApprovalRequest);
  const user = useAuthStore((s) => s.user);
  const actor = user?.email ?? user?.id ?? 'unknown-reviewer';

  const askEscalate = async (r: ApprovalRequest) => {
    const ok = await confirm({
      title: `Escalate ${r.requestNumber}?`,
      description: 'The request moves up to the next approver level and they are notified. The SLA clock keeps running.',
      confirmLabel: 'Escalate',
    });
    if (!ok) return;
    try {
      await escalate(r.id, actor, 'Escalated manually from the approval queue');
      toast.success('Request escalated', { description: r.requestNumber });
    } catch (err) {
      toast.error("Couldn't escalate request", { description: errorMessage(err) });
    }
  };

  const askCancel = async (r: ApprovalRequest) => {
    const ok = await confirm({
      title: `Cancel ${r.requestNumber}?`,
      description: 'Nobody can decide on it any more and the blocked change does not happen. The request stays in the audit trail.',
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep request',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await cancel(r.id, actor, 'Cancelled from the approval queue');
      toast.success('Request cancelled', { description: r.requestNumber });
    } catch (err) {
      toast.error("Couldn't cancel request", { description: errorMessage(err) });
    }
  };

  const rowActions = (r: ApprovalRequest): RowActionItem[] => {
    const open: RowActionItem = { label: 'Open', icon: <Eye className={icon} />, onSelect: () => onOpen(r) };
    if (!isOpen(r.status)) return [open];
    return [
      open,
      { label: 'Escalate', icon: <ArrowUpCircle className={icon} />, onSelect: () => void askEscalate(r) },
      { label: 'Cancel request', icon: <XCircle className={icon} />, tone: 'danger', separatorBefore: true, onSelect: () => void askCancel(r) },
    ];
  };

  const columns: DataTableColumn<ApprovalRequest>[] = [
    {
      key: 'createdAt',
      header: 'Requested',
      sortable: true,
      sortValue: (r) => new Date(r.createdAt),
      cell: (r) => (
        <span className="whitespace-nowrap text-[13px] text-ink-tertiary" title={new Date(r.createdAt).toLocaleString()}>
          {formatRelative(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'request',
      header: 'Request',
      cell: (r) => (
        <div className="min-w-0 max-w-[28rem]">
          <div className="truncate text-sm font-medium text-ink-primary">{humanize(r.entityType)}</div>
          <div className="truncate text-[13px] text-ink-tertiary" title={r.requestReason}>
            {r.requestNumber} · {r.requestReason}
          </div>
        </div>
      ),
    },
    {
      key: 'entityId',
      header: 'Entity',
      hideBelow: 'md',
      cell: (r) => (
        <code className="font-mono text-[13px] text-ink-secondary" title={r.entityId}>
          {r.entityId}
        </code>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      hideBelow: 'sm',
      sortValue: (r) => PRIORITY_ORDER.indexOf(r.priority),
      cell: (r) => <StatusTag tone={priorityTone(r.priority)}>{humanize(r.priority)}</StatusTag>,
    },
    {
      key: 'sla',
      header: 'SLA',
      sortable: true,
      sortValue: (r) => (isOpen(r.status) ? new Date(r.slaDeadline) : null),
      cell: (r) => {
        const sla = slaInfo(r);
        return <StatusTag tone={sla.tone}>{sla.label}</StatusTag>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      hideBelow: 'sm',
      cell: (r) => <StatusTag tone={statusTone(r.status)}>{humanize(r.status)}</StatusTag>,
    },
  ];

  return (
    <Panel padding="none">
      <DataTable
        caption="Approval requests"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        defaultSort={{ key: 'sla', direction: 'asc' }}
        onRowClick={onOpen}
        rowActions={rowActions}
        rowActionsLabel={(r) => `Actions for ${r.requestNumber}`}
        isLoading={isLoading}
        error={error}
        errorTitle="Couldn't load approval requests"
        onRetry={onRetry}
        empty={
          hasFilters ? (
            <EmptyState
              icon={<Search />}
              title="No requests match"
              description="Try another search, or clear the filters."
              action={<Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={<CheckCircle2 />}
              title="No requests waiting"
              description="Automated decisions that need a human appear here."
            />
          )
        }
      />
    </Panel>
  );
}
