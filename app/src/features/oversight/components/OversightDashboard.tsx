/**
 * @file OversightDashboard.tsx
 * @description Oversight section: robot filter, stat row, anomalies, manual control, verifications, capabilities, log
 * @feature oversight
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, RefreshCw } from 'lucide-react';
import { Button, Select, StatRow, StatTile, Toolbar } from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useOversight } from '../hooks/useOversight';
import { useManualControl } from '../hooks/useManualControl';
import { useAnomalies } from '../hooks/useAnomalies';
import { useVerifications } from '../hooks/useVerifications';
import { useRobotCapabilities } from '../hooks/useRobotCapabilities';
import { AnomaliesPanel } from './AnomaliesPanel';
import { ManualControlPanel } from './ManualControlPanel';
import { VerificationsPanel } from './VerificationsPanel';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { OversightLogPanel } from './OversightLogPanel';
import { VerificationFormModal } from './VerificationFormModal';

export interface OversightDashboardProps {
  className?: string;
}

export function OversightDashboard({ className }: OversightDashboardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const operatorId = user?.email ?? user?.id;

  const { dashboardStats, fleetOverview, oversightLogs, logsLoading, refresh: refreshDashboard, fetchLogs } =
    useOversight({ autoFetch: true, refreshInterval: 30000 });
  const { activeSessions, isDeactivating, activateManualMode, deactivateManualMode, refresh: refreshManual } =
    useManualControl({ autoFetch: true });
  const { activeAnomalies, isLoading: anomaliesLoading, criticalCount, highCount, unacknowledgedCount, acknowledgeAnomaly, resolveAnomaly, refresh: refreshAnomalies } =
    useAnomalies({ activeOnly: true, autoFetch: true });
  const { dueVerifications, isLoading: verificationsLoading, overdueCount, createSchedule, completeVerification, refresh: refreshVerifications } =
    useVerifications({ autoFetch: true, refreshInterval: 60000 });
  const { robotId, capabilities, isLoading: capabilitiesLoading, setSelectedRobot, fetchCapabilities } = useRobotCapabilities();

  const robots = useMemo(() => fleetOverview?.robots ?? [], [fleetOverview]);
  const robot = robots.find((r) => r.id === robotId) ?? null;
  const robotName = useCallback((id: string | null) => robots.find((r) => r.id === id)?.name ?? id ?? 'All robots', [robots]);

  useEffect(() => {
    void fetchLogs({ limit: 20 });
  }, [fetchLogs]);

  const refreshAll = async () => {
    setRefreshing(true);
    await Promise.all([
      refreshDashboard(),
      refreshManual(),
      refreshAnomalies(),
      refreshVerifications(),
      fetchLogs({ limit: 20 }),
      robotId ? fetchCapabilities(robotId) : Promise.resolve(),
    ]);
    setRefreshing(false);
  };

  // Every act changes the log and the stats; refresh them after it.
  const afterAct = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    const result = await fn(...args);
    void refreshDashboard();
    void fetchLogs({ limit: 20 });
    if (robotId) void fetchCapabilities(robotId);
    return result;
  };

  const anomalies = robotId ? activeAnomalies.filter((a) => a.robotId === robotId) : activeAnomalies;
  const logs = robotId ? oversightLogs.filter((l) => l.robotId === robotId) : oversightLogs;
  const sessions = activeSessions.filter((s) => s.isActive).length;
  const activeCount = dashboardStats?.activeAnomalies ?? activeAnomalies.length;
  const dueCount = dueVerifications.length;

  return (
    <div className={className ? `flex flex-col gap-4 ${className}` : 'flex flex-col gap-4'}>
      <Toolbar
        filters={
          <Select
            aria-label="Robot"
            fullWidth={false}
            className="w-60 max-w-full"
            placeholder="All robots"
            options={robots.map((r) => ({ value: r.id, label: `${r.name}${r.status === 'online' ? '' : ` (${r.status})`}` }))}
            value={robotId ?? ''}
            onChange={(e) => setSelectedRobot(e.target.value || null)}
          />
        }
        actions={
          <>
            <Button variant="ghost" iconOnly aria-label="Refresh" onClick={() => void refreshAll()} disabled={refreshing}>
              <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
            </Button>
            <Button leftIcon={<CalendarPlus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setScheduleOpen(true)}>
              Schedule verification
            </Button>
          </>
        }
      />

      <StatRow columns={4}>
        <StatTile label="Manual sessions" value={sessions} tone={sessions > 0 ? 'gated' : 'neutral'} hint="Robots driven by a person now" />
        <StatTile label="Active anomalies" value={activeCount} tone={criticalCount + highCount > 0 ? 'stopped' : activeCount > 0 ? 'gated' : 'neutral'} hint={`${criticalCount + highCount} critical or high`} />
        <StatTile label="Unacknowledged" value={unacknowledgedCount} tone={unacknowledgedCount > 0 ? 'gated' : 'neutral'} hint="Anomalies nobody has looked at" />
        <StatTile label="Verifications due" value={dueCount} tone={overdueCount > 0 ? 'stopped' : dueCount > 0 ? 'gated' : 'neutral'} hint={overdueCount > 0 ? `${overdueCount} overdue` : 'None overdue'} />
      </StatRow>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <AnomaliesPanel
          className="xl:col-span-2"
          anomalies={anomalies}
          isLoading={anomaliesLoading}
          onAcknowledge={afterAct(acknowledgeAnomaly)}
          onResolve={afterAct(resolveAnomaly)}
        />
        <ManualControlPanel
          robot={robot}
          activeSessions={activeSessions}
          operatorId={operatorId}
          onActivate={afterAct(activateManualMode)}
          onDeactivate={afterAct(deactivateManualMode)}
          isDeactivating={isDeactivating}
          robotName={robotName}
        />
      </div>

      <VerificationsPanel due={dueVerifications} isLoading={verificationsLoading} robotName={robotName} onComplete={afterAct(completeVerification)} />
      <CapabilitiesPanel hasRobot={Boolean(robotId)} capabilities={capabilities} isLoading={capabilitiesLoading} />
      <OversightLogPanel logs={logs} isLoading={logsLoading} />

      <VerificationFormModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        robots={robots}
        defaultRobotId={robotId}
        onCreate={afterAct(async (input) => {
          const schedule = await createSchedule(input);
          await refreshVerifications();
          return schedule;
        })}
      />
    </div>
  );
}
