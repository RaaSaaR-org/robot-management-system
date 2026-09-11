/**
 * @file AlertList.tsx
 * @description Active alerts as a DataTable: severity, alert, robot, raised;
 *              inline Acknowledge, row menu with Open robot and Dismiss (confirmed).
 * @feature alerts
 */

import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, Check, CheckCircle2, Search, Trash2 } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  confirm,
  toast,
  type DataTableColumn,
  type RowActionItem,
} from '@/shared/components/ui';
import { formatDateTime, formatTimeAgo } from '@/shared/utils/format';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { useAlerts } from '../hooks/useAlerts';
import { useAlertsStore } from '../store/alertsStore';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import type { Alert, AlertSeverity } from '../types/alerts.types';
import { ALERT_SEVERITY_PRIORITY, ALERT_SOURCE_LABELS } from '../types/alerts.types';
import { findingLinkPath, parseFindingLink, stripFindingLink } from '@/features/patrol/utils/patrolFormat';

export interface AlertListProps {
  /** Whether to show acknowledged alerts */
  showAcknowledged?: boolean;
  /** Free-text filter over title, message and robot */
  query?: string;
  /** Severity filter ('' = all) */
  severity?: AlertSeverity | '';
  /** Clears the host's filters (filtered-empty state) */
  onClearFilters?: () => void;
  /** Additional class names */
  className?: string;
}

/** Relative for the last day, absolute beyond. */
export function formatAlertTime(isoString: string): string {
  const diffHours = (Date.now() - new Date(isoString).getTime()) / 3600000;
  if (diffHours < 24) return formatTimeAgo(isoString);
  return formatDateTime(isoString, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Title and prose of an alert, with the patrol finding link split out (TASK-212). */
export function alertText(alert: Alert) {
  const title = alert.title?.trim() || ALERT_SOURCE_LABELS[alert.source] || 'Alert';
  const findingLink =
    alert.source === 'robot' ? parseFindingLink(alert.message) ?? parseFindingLink(alert.title) : null;
  const findingPath = findingLink ? findingLinkPath(findingLink) : null;
  const message = parseFindingLink(alert.message) ? stripFindingLink(alert.message) : alert.message;
  // A skipped run has no finding; a tour run (TASK-213) is a visit.
  const linkLabel = findingLink?.findingId
    ? 'Open finding →'
    : findingLink?.kind === 'tour'
      ? 'Open visit →'
      : 'Open run →';
  return { title, message, findingPath, linkLabel };
}

/** Robot name as a link while the robot exists; the raw id, unlinked, once it is gone. */
export function RobotRef({ sourceId, robotName }: { sourceId: string; robotName?: string }) {
  if (!robotName) return <span className="text-[13px] tabular-nums text-ink-tertiary">{sourceId}</span>;
  return (
    <Link to={`/robots/${sourceId}`} className="text-[13px] text-ink-secondary hover:text-primary hover:underline">
      {robotName}
    </Link>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Active alerts table. The host owns the toolbar and passes `query`/`severity`.
 *
 * @example
 * <Panel padding="none"><AlertList showAcknowledged={false} query={q} severity={s} /></Panel>
 */
export function AlertList({
  showAcknowledged = true,
  query = '',
  severity = '',
  onClearFilters,
  className,
}: AlertListProps) {
  const navigate = useNavigate();
  const { alerts, unacknowledgedAlerts, acknowledgeAlertAsync, dismissAlert, fetchAlerts, isLoading, error } =
    useAlerts();
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((state) => state.fetchRobots);

  // Nothing else on /alerts loads the robot list; without it every robot
  // falls back to its raw id and loses its link.
  useEffect(() => {
    if (robots.length === 0) void fetchRobots();
  }, [robots.length, fetchRobots]);

  const robotName = (a: Alert) =>
    a.source === 'robot' && a.sourceId ? robots.find((r) => r.id === a.sourceId)?.name : undefined;

  const source = showAcknowledged ? alerts : unacknowledgedAlerts;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((a) => {
      if (severity && a.severity !== severity) return false;
      if (!q) return true;
      const name = robots.find((r) => r.id === a.sourceId)?.name ?? '';
      return [a.title, a.message, a.sourceId ?? '', name].some((s) => s.toLowerCase().includes(q));
    });
  }, [source, query, severity, robots]);

  // The store rolls a failed act back and records why; surface that as a toast.
  const acknowledge = async (a: Alert) => {
    await acknowledgeAlertAsync(a.id);
    const failure = useAlertsStore.getState().error;
    if (failure) toast.error("Couldn't acknowledge alert", { description: failure });
    else toast.success('Alert acknowledged', { description: alertText(a).title });
  };

  const askDismiss = async (a: Alert) => {
    const ok = await confirm({
      title: 'Dismiss this alert?',
      description: 'It is removed without being recorded as handled.',
      tone: 'danger',
      confirmLabel: 'Dismiss',
    });
    if (!ok) return;
    try {
      await dismissAlert(a.id);
    } catch (err) {
      toast.error("Couldn't dismiss alert", { description: errorMessage(err) });
      return;
    }
    const failure = useAlertsStore.getState().error;
    if (failure) toast.error("Couldn't dismiss alert", { description: failure });
    else toast.success('Alert dismissed', { description: alertText(a).title });
  };

  const actionsFor = (a: Alert): RowActionItem[] => {
    const items: RowActionItem[] = [];
    if (!a.acknowledged) items.push({ label: 'Acknowledge', icon: <Check />, onSelect: () => void acknowledge(a) });
    if (a.source === 'robot' && a.sourceId) {
      const id = a.sourceId;
      items.push({ label: 'Open robot', icon: <Bot />, onSelect: () => navigate(`/robots/${id}`) });
    }
    const canDismiss = a.dismissable && (a.acknowledged || a.severity !== 'critical');
    if (canDismiss) {
      items.push({
        label: 'Dismiss',
        icon: <Trash2 />,
        tone: 'danger',
        separatorBefore: items.length > 0,
        onSelect: () => void askDismiss(a),
      });
    }
    return items;
  };

  const columns: DataTableColumn<Alert>[] = [
    {
      key: 'severity',
      header: 'Severity',
      width: 120,
      hideBelow: 'sm',
      sortable: true,
      sortValue: (a) => ALERT_SEVERITY_PRIORITY[a.severity],
      cell: (a) => <AlertSeverityBadge severity={a.severity} />,
    },
    {
      key: 'title',
      header: 'Alert',
      cell: (a) => {
        const { title, message, findingPath, linkLabel } = alertText(a);
        return (
          <div className="min-w-0 max-w-[60ch]">
            {/* Phones hide the Severity column; the tag rides in the cell instead. */}
            <AlertSeverityBadge severity={a.severity} className="mb-1 sm:hidden" />
            <div className="break-words text-sm font-medium text-ink-primary">{title}</div>
            {message && <p className="line-clamp-2 break-words text-[13px] text-ink-tertiary">{message}</p>}
            {findingPath && (
              <Link
                to={findingPath}
                className="text-[13px] text-primary hover:underline"
                data-testid="alert-open-finding"
              >
                {linkLabel}
              </Link>
            )}
          </div>
        );
      },
    },
    {
      key: 'robot',
      header: 'Robot',
      hideBelow: 'md',
      cell: (a) =>
        a.source === 'robot' && a.sourceId ? (
          <RobotRef sourceId={a.sourceId} robotName={robotName(a)} />
        ) : (
          <span className="text-[13px] text-ink-tertiary">{ALERT_SOURCE_LABELS[a.source]}</span>
        ),
    },
    {
      key: 'timestamp',
      header: 'Raised',
      hideBelow: 'sm',
      sortable: true,
      sortValue: (a) => new Date(a.timestamp),
      cell: (a) => (
        <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-tertiary">
          {formatAlertTime(a.timestamp)}
        </span>
      ),
    },
    {
      key: 'act',
      header: <span className="sr-only">Acknowledge</span>,
      align: 'right',
      cell: (a) =>
        a.acknowledged ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Acknowledge"
            leftIcon={<Check className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => void acknowledge(a)}
          >
            <span className="hidden sm:inline">Acknowledge</span>
          </Button>
        ),
    },
  ];

  const hasFilters = Boolean(query.trim() || severity);

  return (
    <DataTable
      className={className}
      caption="Active alerts"
      columns={columns}
      rows={rows}
      getRowId={(a) => a.id}
      defaultSort={{ key: 'timestamp', direction: 'desc' }}
      rowActions={actionsFor}
      rowActionsLabel={(a) => `Actions for ${alertText(a).title}`}
      isLoading={isLoading}
      error={source.length === 0 ? error : null}
      errorTitle="Couldn't load alerts"
      onRetry={() => void fetchAlerts()}
      empty={
        hasFilters ? (
          <EmptyState
            icon={<Search />}
            title="No alerts match"
            description="Try another search, or clear the filters."
            action={
              onClearFilters && (
                <Button variant="secondary" onClick={onClearFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <EmptyState
            icon={<CheckCircle2 />}
            title="No active alerts"
            description="Everything the fleet raised has been handled."
          />
        )
      }
    />
  );
}
