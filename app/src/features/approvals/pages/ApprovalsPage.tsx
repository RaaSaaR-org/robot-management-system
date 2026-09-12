/**
 * @file ApprovalsPage.tsx
 * @description Approvals section of the compliance page: the human-in-the-loop decision queue
 * @feature approvals
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, SearchInput, Select, StatRow, StatTile, Toolbar } from '@/shared/components/ui';
import { ApprovalDetailModal, ApprovalQueue } from '../components';
import { OPEN_STATUSES } from '../components/approvalFormat';
import { useApprovalMetrics } from '../hooks';
import { useApprovalsStore } from '../store';
import type { ApprovalPriority, ApprovalRequest, ApprovalStatus } from '../types';

type StatusFilter = 'open' | 'approved' | 'rejected' | 'cancelled' | 'all';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All statuses' },
];

const PRIORITY_OPTIONS: { value: ApprovalPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

function statusesFor(filter: StatusFilter): ApprovalStatus[] | undefined {
  if (filter === 'open') return OPEN_STATUSES;
  if (filter === 'all') return undefined;
  return [filter];
}

export function ApprovalsPage() {
  const rows = useApprovalsStore((s) => s.approvalRequests);
  const isLoading = useApprovalsStore((s) => s.approvalRequestsLoading);
  const error = useApprovalsStore((s) => s.approvalRequestsError);
  const fetchRequests = useApprovalsStore((s) => s.fetchApprovalRequests);
  const { metrics, fetchMetrics } = useApprovalMetrics();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [priority, setPriority] = useState('');
  const [open, setOpen] = useState<ApprovalRequest | null>(null);

  const load = useCallback(async () => {
    // `status` is always passed explicitly so a stale store filter never leaks in.
    await Promise.all([fetchRequests({ status: statusesFor(status), limit: 100 }), fetchMetrics()]);
  }, [fetchRequests, fetchMetrics, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!priority || r.priority === priority) &&
        (!q ||
          r.requestNumber.toLowerCase().includes(q) ||
          r.requestReason.toLowerCase().includes(q) ||
          r.entityId.toLowerCase().includes(q) ||
          r.entityType.toLowerCase().includes(q))
    );
  }, [rows, query, priority]);

  const hasFilters = Boolean(query || priority || status !== 'open');
  const clearFilters = () => {
    setQuery('');
    setPriority('');
    setStatus('open');
  };

  const pending = metrics ? metrics.pendingRequests + metrics.inProgressRequests : 0;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search requests" aria-label="Search requests" />}
        filters={
          <>
            <Select
              aria-label="Status"
              fullWidth={false}
              className="w-40"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            />
            <Select
              aria-label="Priority"
              fullWidth={false}
              className="w-40"
              placeholder="All priorities"
              options={PRIORITY_OPTIONS}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </>
        }
        actions={
          <Button variant="ghost" iconOnly aria-label="Refresh" onClick={() => void load()} disabled={isLoading}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        }
      />

      {metrics && (
        <StatRow columns={4}>
          <StatTile label="Pending" value={pending} tone={pending > 0 ? 'info' : 'neutral'} hint="Waiting for a decision" />
          <StatTile label="Overdue" value={metrics.overdueRequests} tone={metrics.overdueRequests > 0 ? 'stopped' : 'neutral'} hint="Past their SLA deadline" />
          <StatTile label="Nearing SLA" value={metrics.nearingDeadlineRequests} tone={metrics.nearingDeadlineRequests > 0 ? 'gated' : 'neutral'} hint="Deadline within 4 h" />
          <StatTile label="Avg decision time" value={metrics.avgResponseTimeHours.toFixed(1)} unit="h" hint="Across decided requests" />
        </StatRow>
      )}

      <ApprovalQueue
        rows={filtered}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        onOpen={setOpen}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />

      <ApprovalDetailModal
        request={open}
        onClose={() => {
          setOpen(null);
          void load();
        }}
      />
    </div>
  );
}
