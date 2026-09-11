/**
 * @file RobotControlCenter.tsx
 * @description Tabbed body of the robot detail page. The kit Tabs bar lives in the
 *              URL (?tab=, default overview), sits right under the PageHeader and
 *              every tab renders as a stack of Panels below it. The Overview tab
 *              adds the stat row; offline and error hints sit above the content.
 * @feature robots
 */

import { memo, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { RobotOfflineBanner } from './RobotOfflineBanner';
import { RobotErrorBanner } from './RobotErrorBanner';
import { RobotQuickStats } from './RobotQuickStats';
import {
  OverviewTab,
  TelemetryTab,
  ActivityTab,
  InfoTab,
  TeleopTab,
  PerceptionTab,
  MotionTab,
  VoiceTab,
  ChatTab,
} from './tabs';
import type { Robot, RobotTelemetry, RobotCommand } from '../types/robots.types';
import type { Process } from '@/features/processes/types';
import type { WebSocketStatus } from '@/shared/types/api.types';

// ============================================================================
// TYPES
// ============================================================================

export type RobotDetailTabId =
  | 'overview'
  | 'telemetry'
  | 'perception'
  | 'motion'
  | 'teleop'
  | 'voice'
  | 'chat'
  | 'activity'
  | 'details';

export interface RobotControlCenterProps {
  robot: Robot;
  robotId: string;
  telemetry: RobotTelemetry | null;
  isTelemetryConnected: boolean;
  telemetryLastUpdate: Date | null;
  /** Telemetry stream status (drives the Telemetry tab's error state) */
  telemetryStatus?: WebSocketStatus;
  /** Retry the telemetry connection after an error */
  onTelemetryRetry?: () => void;
  commandHistory: RobotCommand[];
  isCommandLoading: boolean;
  canExecuteCommands: boolean;
  tasks: Process[];
  onSendToCharge: () => Promise<void>;
  onReturnHome: () => Promise<void>;
  className?: string;
}

const TABS: { id: RobotDetailTabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'perception', label: 'Perception' },
  { id: 'motion', label: 'Motion' },
  { id: 'teleop', label: 'Teleop' },
  { id: 'voice', label: 'Voice' },
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
  { id: 'details', label: 'Details' },
];

/** Tabs that need G1 hardware: depth/LiDAR, mic array + speaker, G1 skeleton. */
const G1_ONLY = new Set<RobotDetailTabId>(['perception', 'voice', 'motion']);

// ============================================================================
// COMPONENT
// ============================================================================

export const RobotControlCenter = memo(function RobotControlCenter({
  robot,
  robotId,
  telemetry,
  isTelemetryConnected,
  telemetryLastUpdate,
  telemetryStatus,
  onTelemetryRetry,
  commandHistory,
  isCommandLoading,
  canExecuteCommands,
  tasks,
  onSendToCharge,
  onReturnHome,
  className,
}: RobotControlCenterProps) {
  const [params, setParams] = useSearchParams();

  const descriptor = `${telemetry?.robotType ?? ''} ${
    (robot.metadata?.robotType as string | undefined) ?? ''
  } ${robot.model ?? ''}`.toLowerCase();
  const isG1Family = descriptor.includes('g1');

  const visibleTabs = useMemo(
    () => TABS.filter((t) => isG1Family || !G1_ONLY.has(t.id)),
    [isG1Family]
  );

  const requested = params.get('tab');
  const tab: RobotDetailTabId =
    visibleTabs.find((t) => t.id === requested)?.id ?? 'overview';

  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === 'overview') p.delete('tab');
        else p.set('tab', id);
        return p;
      },
      { replace: true }
    );

  const common = { robot, robotId };

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <Tabs
        label="Robot views"
        tabs={visibleTabs.map(({ id, label }) => ({
          id,
          label,
          count: id === 'activity' ? tasks.length : undefined,
        }))}
        activeTab={tab}
        onTabChange={setTab}
      />

      {robot.status === 'offline' && (
        <RobotOfflineBanner robotName={robot.name} lastSeen={robot.lastSeen} />
      )}

      {tab === 'overview' && (
        <RobotQuickStats
          robot={robot}
          telemetry={telemetry}
          isTelemetryConnected={isTelemetryConnected}
        />
      )}

      <RobotErrorBanner robot={robot} telemetry={telemetry} />

      {tab === 'overview' && (
        <OverviewTab
          {...common}
          telemetry={telemetry}
          isTelemetryConnected={isTelemetryConnected}
          isCommandLoading={isCommandLoading}
          canExecuteCommands={canExecuteCommands}
          onSendToCharge={onSendToCharge}
          onReturnHome={onReturnHome}
        />
      )}
      {tab === 'telemetry' && (
        <TelemetryTab
          {...common}
          telemetry={telemetry}
          isTelemetryConnected={isTelemetryConnected}
          telemetryLastUpdate={telemetryLastUpdate}
          telemetryStatus={telemetryStatus}
          onTelemetryRetry={onTelemetryRetry}
        />
      )}
      {tab === 'perception' && <PerceptionTab {...common} telemetry={telemetry} />}
      {tab === 'motion' && <MotionTab {...common} telemetry={telemetry} />}
      {tab === 'teleop' && <TeleopTab {...common} />}
      {tab === 'voice' && <VoiceTab {...common} />}
      {tab === 'chat' && <ChatTab {...common} />}
      {tab === 'activity' && (
        <ActivityTab
          {...common}
          commandHistory={commandHistory}
          isCommandLoading={isCommandLoading}
          canExecuteCommands={canExecuteCommands}
          onSendToCharge={onSendToCharge}
          onReturnHome={onReturnHome}
          tasks={tasks}
        />
      )}
      {tab === 'details' && <InfoTab {...common} />}
    </div>
  );
});
