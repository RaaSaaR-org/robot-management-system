/**
 * @file IncidentsPage.tsx
 * @description Main page for incident management
 * @feature incidents
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs } from '@/shared/components/ui/Tabs';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { IncidentList } from '../components/IncidentList';
import { IncidentFilters } from '../components/IncidentFilters';
import { SeverityBadge } from '../components/SeverityBadge';
import { useIncidents, useIncidentDashboard } from '../hooks/useIncidents';
import type { Incident, IncidentSeverity } from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  variant?: 'default' | 'warning' | 'error';
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function StatCard({ title, value, subtitle, variant = 'default' }: StatCardProps) {
  const bgColor = variant === 'error'
    ? 'bg-red-500/10 border-red-500/30'
    : variant === 'warning'
    ? 'bg-yellow-500/10 border-yellow-500/30'
    : 'bg-theme-elevated border-theme-base';

  const textColor = variant === 'error'
    ? 'text-red-500'
    : variant === 'warning'
    ? 'text-yellow-500'
    : 'text-theme-primary';

  return (
    <div className={`p-4 rounded-lg border ${bgColor}`}>
      <p className="text-xs text-theme-tertiary uppercase tracking-wide mb-1">{title}</p>
      <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
      {subtitle && <p className="text-xs text-theme-secondary mt-1">{subtitle}</p>}
    </div>
  );
}

function DashboardContent() {
  const { stats, isLoading, fetchStats } = useIncidentDashboard();

  if (isLoading && !stats) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-theme-secondary">Failed to load dashboard</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={fetchStats}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Total Incidents" value={stats.totalIncidents} />
        <StatCard
          title="Open Incidents"
          value={stats.openIncidents}
          variant={stats.openIncidents > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Overdue Notifications"
          value={stats.overdueNotifications}
          variant={stats.overdueNotifications > 0 ? 'error' : 'default'}
        />
        <StatCard
          title="Pending Notifications"
          value={stats.pendingNotifications}
          subtitle={stats.pendingNotifications > 0 ? 'Awaiting action' : undefined}
        />
      </div>

      {/* Severity Breakdown */}
      <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
        <h3 className="font-medium text-theme-primary mb-4">By Severity</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(Object.entries(stats.incidentsBySeverity) as [IncidentSeverity, number][]).map(
            ([severity, count]) => (
              <div key={severity} className="flex items-center justify-between p-3 bg-theme-base rounded-lg">
                <SeverityBadge severity={severity} showDot={false} />
                <span className="text-lg font-bold text-theme-primary">{count}</span>
              </div>
            )
          )}
        </div>
      </div>

      {/* Average Resolution Time */}
      {stats.averageResolutionTimeHours !== null && (
        <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
          <h3 className="font-medium text-theme-primary mb-2">Average Resolution Time</h3>
          <p className="text-2xl font-bold text-cobalt">
            {stats.averageResolutionTimeHours < 24
              ? `${stats.averageResolutionTimeHours} hours`
              : `${Math.round(stats.averageResolutionTimeHours / 24)} days`}
          </p>
        </div>
      )}

      {/* Recent Incidents */}
      {stats.recentIncidents.length > 0 && (
        <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
          <h3 className="font-medium text-theme-primary mb-4">Recent Incidents</h3>
          <div className="space-y-2">
            {stats.recentIncidents.slice(0, 5).map((incident) => (
              <div
                key={incident.id}
                className="flex items-center justify-between p-2 bg-theme-base rounded"
              >
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={incident.severity} size="sm" />
                  <span className="text-sm text-theme-primary truncate max-w-[200px]">
                    {incident.title}
                  </span>
                </div>
                <span className="text-xs text-theme-tertiary font-mono">
                  {incident.incidentNumber}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AllIncidentsContent() {
  const navigate = useNavigate();
  const { filters, setFilters } = useIncidents(false);

  const handleIncidentClick = (incident: Incident) => {
    navigate(`/incidents/${incident.id}`);
  };

  return (
    <div className="space-y-4">
      <IncidentFilters filters={filters} onFiltersChange={setFilters} />
      <IncidentList
        maxHeight="calc(100vh - 400px)"
        onIncidentClick={handleIncidentClick}
      />
    </div>
  );
}

function OpenIncidentsContent() {
  const navigate = useNavigate();

  const handleIncidentClick = (incident: Incident) => {
    navigate(`/incidents/${incident.id}`);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-theme-secondary">
        Incidents that require attention (not yet closed).
      </p>
      <IncidentList
        maxHeight="calc(100vh - 350px)"
        showOnlyOpen
        onIncidentClick={handleIncidentClick}
      />
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Main page for incident management and regulatory reporting.
 */
export function IncidentsPage() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const navigate = useNavigate();
  const { fetchIncidents } = useIncidents(false);

  // Initial fetch when component mounts
  useEffect(() => {
    fetchIncidents(1);
  }, [fetchIncidents]);

  const tabs = useMemo(
    () => [
      {
        id: 'dashboard',
        label: 'Dashboard',
        content: <DashboardContent />,
      },
      {
        id: 'open',
        label: 'Open Incidents',
        content: <OpenIncidentsContent />,
      },
      {
        id: 'all',
        label: 'All Incidents',
        content: <AllIncidentsContent />,
      },
    ],
    []
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 px-6 py-4 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-theme-primary">Incident Management</h1>
            <p className="text-theme-secondary mt-1">
              Track and report incidents per EU AI Act, GDPR, NIS2 & CRA requirements
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => navigate('/incidents/new')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Report Incident
          </Button>
        </div>
      </header>

      {/* Info Box */}
      <div className="flex-shrink-0 px-6 pt-4">
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4">
          <h3 className="font-semibold text-blue-300 mb-2">Regulatory Compliance</h3>
          <p className="text-blue-200/80 text-sm">
            This system tracks incidents and manages notification deadlines for multiple regulations:
          </p>
          <ul className="text-blue-200/80 text-sm mt-2 space-y-1 ml-4 list-disc">
            <li><strong className="text-blue-300">EU AI Act Art. 73</strong>: Serious incident reporting (2/10/15 days)</li>
            <li><strong className="text-blue-300">GDPR Art. 33-34</strong>: Data breach notification (72 hours)</li>
            <li><strong className="text-blue-300">NIS2 Art. 23</strong>: Cyber incident reporting (24h early warning, 72h notification)</li>
            <li><strong className="text-blue-300">CRA Art. 14</strong>: Vulnerability disclosure (24 hours)</li>
          </ul>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-6">
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          className="h-full"
        />
      </div>
    </div>
  );
}
