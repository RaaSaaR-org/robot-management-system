/**
 * @file AlertsPage.tsx
 * @description Full page for viewing and managing alert history
 * @feature alerts
 * @dependencies @/features/alerts/components, @/features/alerts/hooks
 */

import { useState, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { useAlertHistory, useAlertCounts, useAlerts } from '../hooks/useAlerts';
import { AlertFilters } from '../components/AlertFilters';
import { AlertHistoryPanel } from '../components/AlertHistoryPanel';
import { AlertList } from '../components/AlertList';
import type { AlertSeverity } from '../types/alerts.types';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertsPageProps {
  /** Additional class names */
  className?: string;
}

type TabType = 'active' | 'history';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface CountBadgeProps {
  count: number;
  severity?: AlertSeverity;
}

function CountBadge({ count, severity }: CountBadgeProps) {
  if (count === 0) return null;

  const colorClass =
    severity === 'critical'
      ? 'bg-red-500'
      : severity === 'error'
        ? 'bg-red-400'
        : severity === 'warning'
          ? 'bg-yellow-500'
          : 'bg-blue-500';

  return (
    <span
      className={cn(
        'ml-2 px-2 py-0.5 text-xs font-medium rounded-full',
        colorClass,
        severity === 'warning' ? 'text-gray-900' : 'text-white'
      )}
    >
      {count}
    </span>
  );
}

interface StatsCardProps {
  label: string;
  count: number;
  severity: AlertSeverity;
}

function StatsCard({ label, count, severity }: StatsCardProps) {
  const colorClass =
    severity === 'critical'
      ? 'border-red-500/50 bg-red-500/10'
      : severity === 'error'
        ? 'border-red-400/50 bg-red-400/10'
        : severity === 'warning'
          ? 'border-yellow-500/50 bg-yellow-500/10'
          : 'border-blue-500/50 bg-blue-500/10';

  const textClass =
    severity === 'critical'
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
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [showFilters, setShowFilters] = useState(false);

  const { unacknowledgedCount, fetchAlerts } = useAlerts();
  const { filters, setFilters, pagination } = useAlertHistory(false);
  const { counts, total: totalActive } = useAlertCounts();

  const handleRefresh = useCallback(async () => {
    await fetchAlerts();
  }, [fetchAlerts]);

  return (
    <div className={cn('min-h-screen', className)}>
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-theme-primary">
                Alerts
                {unacknowledgedCount > 0 && (
                  <span className="ml-3 text-sm font-normal text-theme-secondary">
                    ({unacknowledgedCount} active)
                  </span>
                )}
              </h1>
              <p className="mt-1 text-sm text-theme-secondary">
                Monitor and manage system alerts
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleRefresh}>
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <StatsCard label="Critical" count={counts.critical} severity="critical" />
          <StatsCard label="Errors" count={counts.error} severity="error" />
          <StatsCard label="Warnings" count={counts.warning} severity="warning" />
          <StatsCard label="Info" count={counts.info} severity="info" />
        </div>

        {/* Tabs */}
        <div className="border-b border-theme-border mb-6">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('active')}
              className={cn(
                'pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'active'
                  ? 'border-primary-500 text-primary-500'
                  : 'border-transparent text-theme-secondary hover:text-theme-primary'
              )}
            >
              Active Alerts
              <CountBadge count={totalActive} severity="critical" />
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={cn(
                'pb-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'history'
                  ? 'border-primary-500 text-primary-500'
                  : 'border-transparent text-theme-secondary hover:text-theme-primary'
              )}
            >
              History
              {pagination.total > 0 && (
                <span className="ml-2 text-theme-tertiary">({pagination.total})</span>
              )}
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'active' ? (
          <div className="bg-theme-surface rounded-lg border border-theme-border p-6">
            <AlertList maxHeight="600px" showAcknowledged={false} />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Filter Toggle */}
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
              >
                {showFilters ? 'Hide Filters' : 'Show Filters'}
              </Button>
            </div>

            {/* Filters */}
            {showFilters && (
              <div className="bg-theme-surface rounded-lg border border-theme-border p-6">
                <AlertFilters filters={filters} onFiltersChange={setFilters} />
              </div>
            )}

            {/* History Panel */}
            <div className="bg-theme-surface rounded-lg border border-theme-border p-6 relative">
              <AlertHistoryPanel maxHeight="600px" autoFetch={activeTab === 'history'} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
