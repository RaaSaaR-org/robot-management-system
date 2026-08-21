/**
 * @file AlertsPage.tsx
 * @description Full page for viewing and managing alert history
 * @feature alerts
 * @dependencies @/features/alerts/components, @/features/alerts/hooks
 */

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { Tabs } from '@/shared/components/ui/Tabs';
import { useAlertHistory, useAlerts } from '../hooks/useAlerts';
import { AlertList } from '../components/AlertList';
import { AlertHistoryPanel } from '../components/AlertHistoryPanel';
import { IncidentsPage } from '@/features/incidents/pages/IncidentsPage';
import type { AlertSeverity } from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertsPageProps {
  /** Additional class names */
  className?: string;
}

type TabType = 'active' | 'history' | 'incidents';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface StatsCardProps {
  label: string;
  count: number;
  severity: AlertSeverity;
}

function StatsCard({ label, count, severity }: StatsCardProps) {
  const isZero = count === 0;

  const colorClass = isZero
    ? 'border-theme bg-theme-elevated'
    : severity === 'critical'
      ? 'border-red-500/50 bg-red-500/10'
      : severity === 'error'
        ? 'border-red-400/50 bg-red-400/10'
        : severity === 'warning'
          ? 'border-yellow-500/50 bg-yellow-500/10'
          : 'border-blue-500/50 bg-blue-500/10';

  // Light/dark pair per severity, as the patrol feature does it (patrolUi.tsx
  // KPI_VALUE_TONE): the dark-only 400/300 tints these used to carry washed the
  // count out to near-invisible on the light background. Warning follows
  // patrol's amber — the yellow ramp has no light sibling that passes AA.
  const textClass = isZero
    ? 'text-theme-secondary'
    : severity === 'critical'
      ? 'text-red-700 dark:text-red-400'
      : severity === 'error'
        ? 'text-red-600 dark:text-red-300'
        : severity === 'warning'
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-blue-700 dark:text-blue-400';

  return (
    <div className={cn('p-4 rounded-lg border', colorClass)}>
      <p className="text-sm text-theme-secondary">{label}</p>
      <p className={cn('text-2xl font-bold', textClass)}>{count}</p>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * AlertsPage - Full page for viewing and managing alerts
 *
 * Features:
 * - Active alerts tab showing current unacknowledged alerts
 * - History tab with filtering and pagination
 * - Alert counts by severity
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <Routes>
 *       <Route path="/alerts" element={<AlertsPage />} />
 *     </Routes>
 *   );
 * }
 * ```
 */
export function AlertsPage({ className }: AlertsPageProps) {
  // Tab state synced via ?tab= so /incidents → /alerts?tab=incidents
  // redirect lands on the right tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabType =
    tabParam === 'history' || tabParam === 'incidents' ? tabParam : 'active';
  const setActiveTab = (id: TabType) => {
    const next = new URLSearchParams(searchParams);
    if (id === 'active') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  const { unacknowledgedAlerts, unacknowledgedCount, fetchAlerts } = useAlerts();
  const { pagination } = useAlertHistory(false);

  // Single source of truth: the header badge, the severity tiles and the
  // Active tab count are ALL derived from the same fetched active-alerts
  // array (no separate counts poll, so they can never disagree).
  const counts = useMemo(() => {
    const bySeverity: Record<AlertSeverity, number> = {
      critical: 0,
      error: 0,
      warning: 0,
      info: 0,
    };
    for (const alert of unacknowledgedAlerts) {
      bySeverity[alert.severity] += 1;
    }
    return bySeverity;
  }, [unacknowledgedAlerts]);

  const handleRefresh = useCallback(async () => {
    await fetchAlerts();
  }, [fetchAlerts]);

  return (
    <div className={cn('min-h-screen', className)}>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <PageHeader
          className="mb-8"
          title="Alerts"
          meta={
            unacknowledgedCount > 0 && (
              <span className="text-sm font-normal text-theme-secondary">
                ({unacknowledgedCount} unacknowledged)
              </span>
            )
          }
          subtitle="Monitor and manage system alerts"
          actions={
            <Button variant="secondary" size="sm" onClick={handleRefresh}>
              Refresh
            </Button>
          }
        />

        {/* Stats Cards — 2-up on narrow screens so tiles never clip their labels */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 mb-8">
          <StatsCard label="Critical" count={counts.critical} severity="critical" />
          <StatsCard label="Errors" count={counts.error} severity="error" />
          <StatsCard label="Warnings" count={counts.warning} severity="warning" />
          <StatsCard label="Info" count={counts.info} severity="info" />
        </div>

        <Tabs
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TabType)}
          tabs={[
            {
              id: 'active',
              // Counts the same unacknowledged set the list below renders
              label:
                unacknowledgedCount > 0
                  ? `Active Alerts (${unacknowledgedCount})`
                  : 'Active Alerts',
              // No card/scroll container: the list flows with the page so
              // mobile gets a single page scrollbar instead of a nested one.
              content: <AlertList className="pt-2" showAcknowledged={false} />,
            },
            {
              id: 'history',
              label: pagination.total > 0 ? `History (${pagination.total})` : 'History',
              content: (
                <div className="bg-theme-surface rounded-lg border border-theme-border p-4 sm:p-6 relative">
                  <AlertHistoryPanel autoFetch={activeTab === 'history'} />
                </div>
              ),
            },
            {
              id: 'incidents',
              label: 'Incidents',
              content: <IncidentsPage embedded />,
            },
          ]}
        />
      </div>
    </div>
  );
}
