/**
 * @file ApprovalQueue.tsx
 * @description Queue view of pending approval requests
 * @feature approvals
 */

import { useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, Search } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ApprovalCard } from './ApprovalCard';
import { usePendingApprovals } from '../hooks';
import type { ApproverRole, ApprovalStatus, ApprovalPriority } from '../types';

interface ApprovalQueueProps {
  role?: ApproverRole;
  userId?: string;
  onSelectApproval?: (id: string) => void;
  className?: string;
}

export function ApprovalQueue({
  role,
  userId,
  onSelectApproval,
  className,
}: ApprovalQueueProps) {
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<ApprovalPriority | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const {
    pendingApprovals,
    isLoading,
    pendingCount,
    overdueCount,
    criticalCount,
    refresh,
  } = usePendingApprovals({
    role,
    userId,
    autoFetch: true,
    refreshInterval: 60000, // Refresh every minute
  });

  // Filter approvals
  const filteredApprovals = pendingApprovals.filter((approval) => {
    if (statusFilter !== 'all' && approval.status !== statusFilter) {
      return false;
    }
    if (priorityFilter !== 'all' && approval.priority !== priorityFilter) {
      return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        approval.requestNumber.toLowerCase().includes(query) ||
        approval.requestReason.toLowerCase().includes(query) ||
        approval.entityType.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Sort by urgency and deadline
  const sortedApprovals = [...filteredApprovals].sort((a, b) => {
    // Critical first
    if (a.urgencyLevel === 'critical' && b.urgencyLevel !== 'critical') return -1;
    if (b.urgencyLevel === 'critical' && a.urgencyLevel !== 'critical') return 1;
    // Then by deadline
    return new Date(a.slaDeadline).getTime() - new Date(b.slaDeadline).getTime();
  });

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header Stats */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <span className="font-semibold text-blue-900 dark:text-blue-200">{pendingCount}</span>
            <span className="text-sm text-blue-700 dark:text-blue-400">Pending</span>
          </div>

          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <span className="font-semibold text-red-900 dark:text-red-200">{overdueCount}</span>
              <span className="text-sm text-red-700 dark:text-red-400">Overdue</span>
            </div>
          )}

          {criticalCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              <span className="font-semibold text-orange-900 dark:text-orange-200">{criticalCount}</span>
              <span className="text-sm text-orange-700 dark:text-orange-400">Critical</span>
            </div>
          )}
        </div>

        <button
          onClick={refresh}
          disabled={isLoading}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm text-theme-secondary hover:text-theme-primary',
            'border border-theme-subtle rounded-lg hover:bg-theme-elevated transition-colors',
            isLoading && 'opacity-50 cursor-not-allowed'
          )}
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search approvals..."
            className="w-full pl-10 pr-4 py-2 bg-theme-surface text-theme-primary border border-theme-subtle rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-theme-muted"
          />
        </div>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ApprovalStatus | 'all')}
          className="px-3 py-2 bg-theme-surface text-theme-primary border border-theme-subtle rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="escalated">Escalated</option>
        </select>

        {/* Priority Filter */}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as ApprovalPriority | 'all')}
          className="px-3 py-2 bg-theme-surface text-theme-primary border border-theme-subtle rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Priority</option>
          <option value="urgent">Urgent</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Queue */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {isLoading && pendingApprovals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-theme-secondary">
            <RefreshCw className="h-8 w-8 animate-spin mb-4" />
            <p>Loading approvals...</p>
          </div>
        ) : sortedApprovals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-theme-secondary">
            <CheckCircle className="h-12 w-12 mb-4 text-green-500" />
            <p className="text-lg font-medium text-theme-primary">All caught up!</p>
            <p className="text-sm">No pending approvals matching your filters</p>
          </div>
        ) : (
          sortedApprovals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onClick={() => onSelectApproval?.(approval.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
