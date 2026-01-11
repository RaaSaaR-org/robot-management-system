/**
 * @file OversightDashboard.tsx
 * @description Main dashboard for human oversight per EU AI Act Art. 14
 * @feature oversight
 */

import { useEffect, useState } from 'react';
import { RefreshCw, Shield, AlertTriangle, CheckCircle, Clock, Bot } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';

// Feature imports
import { SafetyStatusDashboard } from '@/features/safety/components/SafetyStatusDashboard';
import { FleetEmergencyStopButton } from '@/features/safety/components/FleetEmergencyStopButton';

// Local components
import { BiasPreventionBanner } from './BiasPreventionBanner';
import { VerificationReminder } from './VerificationReminder';
import { ManualControlPanel } from './ManualControlPanel';
import { AnomalyList } from './AnomalyList';
import { CapabilitiesSummary } from './CapabilitiesSummary';
import { LimitationsDisplay } from './LimitationsDisplay';
import { OversightTimeline } from './OversightTimeline';
import { AnomalyIndicator } from './AnomalyIndicator';

// Hooks
import { useOversight } from '../hooks/useOversight';
import { useManualControl } from '../hooks/useManualControl';
import { useAnomalies } from '../hooks/useAnomalies';
import { useVerifications } from '../hooks/useVerifications';
import { useRobotCapabilities } from '../hooks/useRobotCapabilities';

// Types
import type { VerificationStatus } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface OversightDashboardProps {
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface StatCardProps {
  label: string;
  value: number;
  icon: typeof Shield;
  status?: 'good' | 'warning' | 'error' | 'neutral';
}

function StatCard({ label, value, icon: Icon, status = 'neutral' }: StatCardProps) {
  const statusStyles = {
    good: 'text-green-500',
    warning: 'text-yellow-500',
    error: 'text-red-500',
    neutral: 'text-theme-secondary',
  };

  return (
    <div className="p-4 bg-theme-elevated rounded-lg">
      <div className="flex items-center gap-3">
        <Icon className={cn('h-8 w-8', statusStyles[status])} />
        <div>
          <p className="text-2xl font-bold text-theme-primary">{value}</p>
          <p className="text-sm text-theme-muted">{label}</p>
        </div>
      </div>
    </div>
  );
}

interface RobotSelectorProps {
  robots: Array<{ id: string; name: string; status: string; hasAnomalies: boolean }>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function RobotSelector({ robots, selectedId, onSelect }: RobotSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {robots.map((robot) => (
        <button
          key={robot.id}
          onClick={() => onSelect(selectedId === robot.id ? null : robot.id)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors',
            selectedId === robot.id
              ? 'bg-blue-500 text-white'
              : 'bg-theme-elevated hover:bg-theme-subtle text-theme-secondary'
          )}
        >
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              robot.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
            )}
          />
          {robot.name}
          {robot.hasAnomalies && (
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
          )}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function OversightDashboard({ className }: OversightDashboardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Hooks
  const {
    dashboardStats,
    fleetOverview,
    oversightLogs,
    logsLoading,
    refresh: refreshDashboard,
    fetchLogs,
  } = useOversight({ autoFetch: true, refreshInterval: 30000 });

  const {
    activeSessions,
    isActivating,
    isDeactivating,
    activateManualMode,
    deactivateManualMode,
    refresh: refreshManualControl,
  } = useManualControl({ autoFetch: true });

  const {
    activeAnomalies,
    isLoading: anomaliesLoading,
    criticalCount,
    unacknowledgedCount,
    acknowledgeAnomaly,
    resolveAnomaly,
    refresh: refreshAnomalies,
  } = useAnomalies({ activeOnly: true, autoFetch: true });

  const {
    dueVerifications,
    overdueCount,
    isCompleting,
    completeVerification,
    refresh: refreshVerifications,
  } = useVerifications({ autoFetch: true, refreshInterval: 60000 });

  const {
    robotId: selectedRobotId,
    capabilities: robotCapabilities,
    isLoading: capabilitiesLoading,
    setSelectedRobot,
  } = useRobotCapabilities();

  // Fetch logs on mount
  useEffect(() => {
    fetchLogs({ limit: 20 });
  }, [fetchLogs]);

  // Handle refresh all
  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    await Promise.all([
      refreshDashboard(),
      refreshManualControl(),
      refreshAnomalies(),
      refreshVerifications(),
    ]);
    setIsRefreshing(false);
  };

  // Handle verification completion
  const handleCompleteVerification = async (
    scheduleId: string,
    status: VerificationStatus,
    notes?: string
  ) => {
    await completeVerification({ scheduleId, status, notes });
  };

  // Determine bias prevention banner variant
  const biasVariant =
    criticalCount > 0
      ? 'critical'
      : unacknowledgedCount > 0 || (dashboardStats?.verificationComplianceRate ?? 100) < 80
        ? 'warning'
        : 'reminder';

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Human Oversight</h1>
          <p className="text-theme-muted">
            EU AI Act Article 14 - Control & Intervention Center
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FleetEmergencyStopButton />
          <Button
            variant="secondary"
            onClick={handleRefreshAll}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Active Anomalies"
          value={dashboardStats?.activeAnomalies ?? 0}
          icon={AlertTriangle}
          status={criticalCount > 0 ? 'error' : activeAnomalies.length > 0 ? 'warning' : 'good'}
        />
        <StatCard
          label="Manual Sessions"
          value={activeSessions.length}
          icon={Bot}
          status={activeSessions.length > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Overdue Checks"
          value={overdueCount}
          icon={Clock}
          status={overdueCount > 0 ? 'error' : 'good'}
        />
        <StatCard
          label="Compliance Rate"
          value={Math.round(dashboardStats?.verificationComplianceRate ?? 100)}
          icon={CheckCircle}
          status={
            (dashboardStats?.verificationComplianceRate ?? 100) >= 90
              ? 'good'
              : (dashboardStats?.verificationComplianceRate ?? 100) >= 70
                ? 'warning'
                : 'error'
          }
        />
      </div>

      {/* Bias Prevention Banner */}
      <BiasPreventionBanner variant={biasVariant} />

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: Safety & Manual Control */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Safety Status (Compact) */}
          <div className="bg-theme-surface rounded-lg p-4 border border-theme-subtle">
            <SafetyStatusDashboard compact />
          </div>

          {/* Manual Control Panel */}
          <div className="bg-theme-surface rounded-lg p-4 border border-theme-subtle">
            <ManualControlPanel
              activeSessions={activeSessions}
              robots={fleetOverview?.robots ?? []}
              onActivate={activateManualMode}
              onDeactivate={deactivateManualMode}
              isActivating={isActivating}
              isDeactivating={isDeactivating}
            />
          </div>

          {/* Anomaly List */}
          <div className="bg-theme-surface rounded-lg p-4 border border-theme-subtle">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-theme-muted" />
                <h3 className="font-semibold text-theme-primary">Anomalies</h3>
              </div>
              {criticalCount > 0 && (
                <AnomalyIndicator severity="critical" count={criticalCount} pulse />
              )}
            </div>
            <AnomalyList
              anomalies={activeAnomalies}
              isLoading={anomaliesLoading}
              onAcknowledge={acknowledgeAnomaly}
              onResolve={resolveAnomaly}
            />
          </div>
        </div>

        {/* Center Column: Verifications & Timeline */}
        <div className="col-span-12 lg:col-span-5 space-y-6">
          {/* Verification Reminder */}
          {dueVerifications.length > 0 && (
            <div className="bg-theme-surface rounded-lg p-4 border border-theme-subtle">
              <VerificationReminder
                dueVerifications={dueVerifications}
                onComplete={handleCompleteVerification}
                isCompleting={isCompleting}
              />
            </div>
          )}

          {/* Oversight Timeline */}
          <div className="bg-theme-surface rounded-lg p-4 border border-theme-subtle">
            <OversightTimeline
              logs={oversightLogs}
              isLoading={logsLoading}
              maxItems={10}
            />
          </div>
        </div>

        {/* Right Column: Capabilities */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          {/* Robot Selector */}
          <div className="bg-theme-surface rounded-lg p-4 border border-theme-subtle">
            <h3 className="font-semibold text-theme-primary mb-3">Select Robot</h3>
            <RobotSelector
              robots={fleetOverview?.robots ?? []}
              selectedId={selectedRobotId}
              onSelect={setSelectedRobot}
            />
          </div>

          {/* Capabilities Summary */}
          <div className="bg-theme-surface rounded-lg p-4 border border-theme-subtle">
            <CapabilitiesSummary
              capabilities={robotCapabilities}
              isLoading={capabilitiesLoading}
            />
          </div>

          {/* Limitations Display */}
          {robotCapabilities && (
            <div className="bg-theme-surface rounded-lg p-4 border border-theme-subtle">
              <LimitationsDisplay
                limitations={robotCapabilities.limitations}
                warnings={robotCapabilities.warnings}
                errors={robotCapabilities.errors}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
