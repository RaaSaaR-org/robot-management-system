/**
 * @file ComplianceDashboard.tsx
 * @description Compliance overview: stat row, framework scores, next
 *              deadlines and recent activity, each linking into Obligations.
 * @feature compliance
 */

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, CalendarClock } from 'lucide-react';
import {
  Button, EmptyState, ErrorState, Panel, ProgressBar, SkeletonRows, StatRow, StatTile, StatusTag,
} from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import { COMPLIANCE_STATUS_CONFIG, REGULATORY_FRAMEWORK_LABELS } from '../types';
import { complianceTone, formatDate, formatDays, formatRelative, humanize } from './complianceFormat';

export interface ComplianceDashboardProps {
  className?: string;
}

function scoreTone(score: number) {
  if (score >= 80) return 'live' as const;
  if (score >= 50) return 'gated' as const;
  return 'stopped' as const;
}

function scoreBar(score: number) {
  if (score >= 80) return 'success' as const;
  if (score >= 50) return 'warning' as const;
  return 'error' as const;
}

export function ComplianceDashboard({ className }: ComplianceDashboardProps) {
  const [, setParams] = useSearchParams();
  const {
    dashboardStats, deadlines, recentActivity, isLoadingDashboard, isLoadingDeadlines, isLoadingActivity, error,
    fetchDashboardStats, fetchRegulatoryDeadlines, fetchRecentActivity, clearError,
  } = useComplianceTrackerStore();

  useEffect(() => {
    void fetchDashboardStats();
    void fetchRegulatoryDeadlines();
    void fetchRecentActivity(10);
  }, [fetchDashboardStats, fetchRegulatoryDeadlines, fetchRecentActivity]);

  const viewAll = (view: string) =>
    setParams(
      (p) => {
        p.set('tab', 'obligations');
        if (view === 'deadlines') p.delete('view');
        else p.set('view', view);
        return p;
      },
      { replace: true },
    );

  const retry = () => {
    clearError();
    void fetchDashboardStats();
  };

  if (error && !dashboardStats && !isLoadingDashboard) {
    return (
      <Panel className={className}>
        <ErrorState title="Couldn't load the compliance overview" message={error} onRetry={retry} />
      </Panel>
    );
  }

  const loading = isLoadingDashboard && !dashboardStats;
  const alerts = dashboardStats?.alerts;
  const frameworks = dashboardStats?.frameworkScores ?? [];
  const openItems = frameworks.reduce((n, f) => n + f.openItems, 0);
  const nextDeadlines = [...deadlines]
    .filter((d) => d.status !== 'compliant')
    .sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline)
    .slice(0, 5);
  const overdueDeadlines = deadlines.filter((d) => d.status === 'overdue').length;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <StatRow columns={4}>
        <StatTile
          label="Compliance score"
          value={dashboardStats?.overallScore ?? '—'}
          unit="%"
          tone={dashboardStats ? scoreTone(dashboardStats.overallScore) : 'neutral'}
          hint={`Across ${frameworks.length} frameworks`}
          isLoading={loading}
        />
        <StatTile
          label="Critical gaps"
          value={alerts?.criticalGaps ?? '—'}
          tone={alerts && alerts.criticalGaps > 0 ? 'stopped' : 'neutral'}
          hint={`${openItems} open items in total`}
          isLoading={loading}
        />
        <StatTile
          label="Overdue deadlines"
          value={overdueDeadlines}
          unit={`/ ${deadlines.length}`}
          tone={overdueDeadlines > 0 ? 'stopped' : 'neutral'}
          hint={`${alerts?.upcomingDeadlines ?? 0} due in the next 90 days`}
          isLoading={loading || (isLoadingDeadlines && deadlines.length === 0)}
        />
        <StatTile
          label="Overdue inspections"
          value={alerts?.overdueInspections ?? '—'}
          tone={alerts && alerts.overdueInspections > 0 ? 'gated' : 'neutral'}
          hint={`${alerts?.expiringDocuments ?? 0} documents expiring · ${alerts?.overdueTraining ?? 0} trainings overdue`}
          isLoading={loading}
        />
      </StatRow>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <Panel.Header
            title="Frameworks"
            description="Share of each framework's tracked requirements that are met."
            actions={<Button variant="ghost" size="sm" onClick={() => viewAll('gaps')}>View gaps</Button>}
          />
          <Panel.Body>
            {loading ? (
              <SkeletonRows rows={6} columns={3} dense />
            ) : frameworks.length === 0 ? (
              <EmptyState size="sm" title="No frameworks tracked" description="Frameworks appear once compliance tracking is initialised on the server." />
            ) : (
              <ul className="flex flex-col divide-y divide-line-subtle">
                {frameworks.map((fw) => {
                  const name = REGULATORY_FRAMEWORK_LABELS[fw.framework] ?? fw.framework;
                  const cfg = COMPLIANCE_STATUS_CONFIG[fw.status];
                  return (
                    <li
                      key={fw.framework}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[13rem_minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink-primary" title={name}>{name}</div>
                        <div className="text-[13px] text-ink-tertiary">{fw.openItems} open of {fw.totalItems}</div>
                      </div>
                      <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                        <ProgressBar value={fw.score} size="sm" variant={scoreBar(fw.score)} />
                      </div>
                      <StatusTag tone={cfg?.tone ?? 'neutral'}>{cfg?.label ?? humanize(fw.status)}</StatusTag>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel.Body>
        </Panel>

        <Panel>
          <Panel.Header
            title="Next deadlines"
            actions={<Button variant="ghost" size="sm" onClick={() => viewAll('deadlines')}>View all</Button>}
          />
          <Panel.Body>
            {isLoadingDeadlines && deadlines.length === 0 ? (
              <SkeletonRows rows={4} columns={2} dense />
            ) : nextDeadlines.length === 0 ? (
              <EmptyState size="sm" icon={<CalendarClock />} title="Nothing due" description="Every tracked deadline is met." />
            ) : (
              <ul className="flex flex-col divide-y divide-line-subtle">
                {nextDeadlines.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-sm text-ink-primary">{d.name}</div>
                      <div className="text-[13px] text-ink-tertiary">{formatDate(d.deadline)} · {formatDays(d.daysUntilDeadline)}</div>
                    </div>
                    <StatusTag tone={complianceTone(d.status)}>{COMPLIANCE_STATUS_CONFIG[d.status]?.label ?? humanize(d.status)}</StatusTag>
                  </li>
                ))}
              </ul>
            )}
          </Panel.Body>
        </Panel>
      </div>

      <Panel>
        <Panel.Header title="Recent activity" description="Gaps closed, documents renewed, trainings and inspections recorded." />
        <Panel.Body>
          {isLoadingActivity && recentActivity.length === 0 ? (
            <SkeletonRows rows={3} columns={2} dense />
          ) : recentActivity.length === 0 ? (
            <EmptyState size="sm" icon={<Activity />} title="No activity yet" description="Changes to gaps, documents, trainings and inspections show up here." />
          ) : (
            <ul className="flex flex-col divide-y divide-line-subtle">
              {recentActivity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-sm text-ink-primary">{a.description}</div>
                    <div className="text-[13px] text-ink-tertiary">
                      {humanize(a.type)}
                      {a.framework ? ` · ${REGULATORY_FRAMEWORK_LABELS[a.framework] ?? a.framework}` : ''}
                      {a.userName ? ` · ${a.userName}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-[13px] text-ink-tertiary" title={formatDate(a.timestamp)}>
                    {formatRelative(a.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel.Body>
      </Panel>
    </div>
  );
}
