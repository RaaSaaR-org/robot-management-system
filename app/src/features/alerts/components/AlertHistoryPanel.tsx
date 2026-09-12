/**
 * @file AlertHistoryPanel.tsx
 * @description Alert history: Toolbar filters, a DataTable of past alerts and a
 *              server-pagination footer, with loading, empty and filtered-empty states.
 * @feature alerts
 */

import { useEffect } from 'react';
import { History, Search } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import {
  Button,
  DataTable,
  EmptyState,
  Panel,
  StatusTag,
  Toolbar,
  type DataTableColumn,
} from '@/shared/components/ui';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { useAlertHistory } from '../hooks/useAlerts';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import { AlertFilters, hasAlertFilters } from './AlertFilters';
import { RobotRef, alertText, formatAlertTime } from './AlertList';
import type { Alert } from '../types/alerts.types';
import { ALERT_SOURCE_LABELS } from '../types/alerts.types';

export interface AlertHistoryPanelProps {
  /** Whether to auto-fetch on mount */
  autoFetch?: boolean;
  /** Additional class names */
  className?: string;
}

/**
 * AlertHistoryPanel - past alerts with filters and pagination.
 *
 * @example
 * <AlertHistoryPanel autoFetch={tab === 'history'} />
 */
export function AlertHistoryPanel({ autoFetch = true, className }: AlertHistoryPanelProps) {
  const { history, pagination, filters, setFilters, isLoading, goToPage } = useAlertHistory(autoFetch);
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((state) => state.fetchRobots);
  const filtered = hasAlertFilters(filters);

  // Resolve robot names here too; nothing else on this tab loads the robot list.
  useEffect(() => {
    if (robots.length === 0) void fetchRobots();
  }, [robots.length, fetchRobots]);

  const columns: DataTableColumn<Alert>[] = [
    {
      key: 'severity',
      header: 'Severity',
      width: 120,
      hideBelow: 'sm',
      cell: (a) => <AlertSeverityBadge severity={a.severity} showDot={false} />,
    },
    {
      key: 'title',
      header: 'Alert',
      cell: (a) => {
        // TASK-212: the finding tag never shows in the prose; history carries no link.
        const { title, message } = alertText(a);
        return (
          <div className="min-w-0 max-w-[60ch]">
            <AlertSeverityBadge severity={a.severity} showDot={false} className="mb-1 sm:hidden" />
            <div className="break-words text-sm font-medium text-ink-primary">{title}</div>
            {message && <p className="line-clamp-2 break-words text-[13px] text-ink-tertiary">{message}</p>}
          </div>
        );
      },
    },
    {
      key: 'robot',
      header: 'Source',
      hideBelow: 'md',
      cell: (a) =>
        a.source === 'robot' && a.sourceId ? (
          <RobotRef sourceId={a.sourceId} robotName={robots.find((r) => r.id === a.sourceId)?.name} />
        ) : (
          <span className="text-[13px] text-ink-tertiary">{ALERT_SOURCE_LABELS[a.source]}</span>
        ),
    },
    {
      key: 'timestamp',
      header: 'Raised',
      hideBelow: 'sm',
      cell: (a) => (
        <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-tertiary">
          {formatAlertTime(a.timestamp)}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      align: 'right',
      cell: (a) =>
        a.acknowledged ? <StatusTag tone="success">Acknowledged</StatusTag> : <StatusTag tone="neutral">Open</StatusTag>,
    },
  ];

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <Toolbar filters={<AlertFilters filters={filters} onFiltersChange={setFilters} />} />
      <Panel padding="none">
        <DataTable
          caption="Alert history"
          columns={columns}
          rows={history}
          getRowId={(a) => a.id}
          isLoading={isLoading}
          // Once there is history the footer always shows, so the total is visible on one page too.
          pagination={
            history.length > 0
              ? {
                  page: pagination.page,
                  totalPages: pagination.totalPages,
                  total: pagination.total,
                  noun: 'alert',
                  showSinglePage: true,
                  onPageChange: goToPage,
                }
              : undefined
          }
          empty={
            filtered ? (
              <EmptyState
                icon={<Search />}
                title="No alerts in this range"
                description="Try another severity, source or date."
                action={
                  <Button variant="secondary" onClick={() => setFilters({})}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<History />}
                title="No alert history yet"
                description="Alerts the fleet raises are kept here once they happen."
              />
            )
          }
        />
      </Panel>
    </div>
  );
}
