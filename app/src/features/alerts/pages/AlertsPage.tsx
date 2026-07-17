/**
 * @file AlertsPage.tsx
 * @description Full page for viewing and managing alert history
 * @feature alerts
 * @dependencies @/features/alerts/components, @/features/alerts/hooks
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { Tabs } from '@/shared/components/ui/Tabs';
import { useAlertHistory, useAlertCounts, useAlerts } from '../hooks/useAlerts';
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

  const textClass = isZero
    ? 'text-theme-secondary'
    : severity === 'critical'
      ? 'text-red-400'
      : severity === 'error'
        ? 'text-red-300'
        : severity === 'warning'
          ? 'text-yellow-400'
          : 'text-blue-400';

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

  const { unacknowledgedCount, fetchAlerts } = useAlerts();
  const { pagination } = useAlertHistory(false);
  const { counts, total: totalActive } = useAlertCounts();

  const handleRefresh = useCallback(async () => {
    await fetchAlerts();
  }, [fetchAlerts]);

  return (
    <div className={cn('min-h-screen', className)}>
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header — the chip counts UNACKNOWLEDGED alerts; the "Active Alerts"
            tab counts all active ones (incl. acknowledged), so label precisely. */}
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

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
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
              label: totalActive > 0 ? `Active Alerts (${totalActive})` : 'Active Alerts',
              content: (
                <div className="bg-theme-surface rounded-lg border border-theme-border p-6">
                  <AlertList maxHeight="600px" showAcknowledged={false} />
                </div>
              ),
            },
            {
              id: 'history',
              label: pagination.total > 0 ? `History (${pagination.total})` : 'History',
              content: (
                <div className="bg-theme-surface rounded-lg border border-theme-border p-6 relative">
                  <AlertHistoryPanel maxHeight="600px" autoFetch={activeTab === 'history'} />
                </div>
              ),
            },
            {
              id: 'incidents',
              label: 'Incidents',
              content: <IncidentsPage />,
            },
          ]}
        />
      </div>
    </div>
  );
}
