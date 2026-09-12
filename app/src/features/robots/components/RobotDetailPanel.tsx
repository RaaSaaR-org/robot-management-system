/**
 * @file RobotDetailPanel.tsx
 * @description The robot detail page: one PageHeader (name, model · zone, status +
 *              telemetry provenance, control-center link, E-stop, more actions),
 *              then the tabbed control center. Loading and not-found keep the
 *              header so the page never jumps.
 * @feature robots
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BatteryCharging, Gauge, Home, Trash2 } from 'lucide-react';
import {
  ErrorState,
  LinkButton,
  PageHeader, Panel,
  RowActions,
  SkeletonText, confirm,
  errorMessage, toast,
} from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { RobotControlCenter } from './RobotControlCenter';
import { AutonomousExecutionPanel } from './AutonomousExecutionPanel';
import { EmergencyStopButton } from './EmergencyStopButton';
import { RobotStatusTag, ProvenanceTag, provenanceOf } from './common';
import { useRobot } from '../hooks/useRobots';
import { useTelemetryStream } from '../hooks/useTelemetryStream';
import { useRobotsStore } from '../store/robotsStore';
import { useTasksByRobotId } from '@/features/processes/hooks/useTasks';
import { isRobotAvailable } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotDetailPanelProps {
  /** Robot ID to display */
  robotId: string;
  /** Additional class names */
  className?: string;
}

const BACK = { to: '/fleet?tab=list', label: 'Fleet' };
const ICON = 'h-4 w-4';

// ============================================================================
// COMPONENT
// ============================================================================

export function RobotDetailPanel({ robotId, className }: RobotDetailPanelProps) {
  const navigate = useNavigate();
  const { robot, commandHistory, isLoading, error, refresh, sendToCharge, returnHome } =
    useRobot(robotId);
  const {
    telemetry,
    status: telemetryStatus,
    isConnected: isTelemetryConnected,
    lastUpdate: telemetryLastUpdate,
    connect: reconnectTelemetry,
  } = useTelemetryStream(robotId);
  const robotTasks = useTasksByRobotId(robotId);
  const [isCommandLoading, setIsCommandLoading] = useState(false);

  const executeCommand = useCallback(
    async (commandFn: () => Promise<unknown>) => {
      setIsCommandLoading(true);
      try {
        await commandFn();
        await refresh();
      } finally {
        setIsCommandLoading(false);
      }
    },
    [refresh]
  );

  const name = robot?.name ?? 'This robot';

  const handleSendToCharge = useCallback(async () => {
    const ok = await confirm({
      title: `Send ${name} to charge?`,
      description: `${name} leaves its current task and drives to the nearest dock.`,
      confirmLabel: 'Send to charge',
    });
    if (!ok) return;
    try {
      await executeCommand(sendToCharge);
      toast.success('Sent to charge', { description: name });
    } catch (err) {
      toast.error("Couldn't send to charge", { description: errorMessage(err) });
    }
  }, [executeCommand, sendToCharge, name]);

  const handleReturnHome = useCallback(async () => {
    const ok = await confirm({
      title: `Send ${name} home?`,
      description: `${name} leaves its current task and returns to its home position.`,
      confirmLabel: 'Return home',
    });
    if (!ok) return;
    try {
      await executeCommand(returnHome);
      toast.success('Sent home', { description: name });
    } catch (err) {
      toast.error("Couldn't send home", { description: errorMessage(err) });
    }
  }, [executeCommand, returnHome, name]);

  const handleUnregister = useCallback(async () => {
    const ok = await confirm({
      title: `Unregister ${name}?`,
      description:
        'The robot leaves the fleet and stops receiving tasks. Register its agent URL again to bring it back.',
      confirmLabel: 'Unregister',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await useRobotsStore.getState().unregisterRobot(robotId);
      toast.success('Robot unregistered', { description: name });
      navigate(BACK.to);
    } catch (err) {
      toast.error("Couldn't unregister robot", { description: errorMessage(err) });
    }
  }, [navigate, robotId, name]);

  // Not found / failed to load — keep the header and its way back.
  if (!robot && error && !isLoading) {
    return (
      <div className={cn('flex flex-col gap-6', className)}>
        <PageHeader eyebrow="Operate" back={BACK} title="Robot not found" />
        <Panel>
          <ErrorState
            title="Couldn't load this robot"
            message={`No robot with the id “${robotId}” is registered, or the server could not be reached. Check the id, or go back to the fleet.`}
            onRetry={() => void refresh()}
          />
        </Panel>
      </div>
    );
  }

  // First load — the header with a skeleton, no overlay.
  if (!robot) {
    return (
      <div className={cn('flex flex-col gap-6', className)} aria-busy="true">
        <PageHeader eyebrow="Operate" back={BACK} title="Loading…" />
        <Panel>
          <SkeletonText lines={4} />
        </Panel>
      </div>
    );
  }

  const canExecuteCommands = isRobotAvailable(robot) && !isCommandLoading;

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <PageHeader
        eyebrow="Operate"
        back={BACK}
        title={robot.name}
        description={`${robot.model} · ${robot.location?.zone || 'Place unknown'}`}
        meta={
          <>
            <RobotStatusTag status={robot.status} />
            <ProvenanceTag source={provenanceOf(telemetry, isTelemetryConnected)} />
          </>
        }
        actions={
          <>
            <LinkButton
              to={`/robots/${robot.id}/cockpit`}
              variant="secondary"
              leftIcon={<Gauge className={ICON} strokeWidth={1.75} />}
            >
              Open control center
            </LinkButton>
            <EmergencyStopButton robotId={robot.id} robotName={robot.name} />
            <RowActions
              label="More actions"
              items={[
                {
                  label: 'Send to charge',
                  icon: <BatteryCharging className={ICON} strokeWidth={1.75} />,
                  disabled: !canExecuteCommands,
                  onSelect: () => void handleSendToCharge(),
                },
                {
                  label: 'Return home',
                  icon: <Home className={ICON} strokeWidth={1.75} />,
                  disabled: !canExecuteCommands,
                  onSelect: () => void handleReturnHome(),
                },
                {
                  label: 'Unregister',
                  icon: <Trash2 className={ICON} strokeWidth={1.75} />,
                  tone: 'danger',
                  separatorBefore: true,
                  onSelect: () => void handleUnregister(),
                },
              ]}
            />
          </>
        }
      />

      {/* Only visible while ?executing=<skillId> is set */}
      <AutonomousExecutionPanel robotId={robotId} />

      <RobotControlCenter
        robot={robot}
        robotId={robotId}
        telemetry={telemetry}
        isTelemetryConnected={isTelemetryConnected}
        telemetryLastUpdate={telemetryLastUpdate}
        telemetryStatus={telemetryStatus}
        onTelemetryRetry={reconnectTelemetry}
        commandHistory={commandHistory}
        isCommandLoading={isCommandLoading}
        canExecuteCommands={canExecuteCommands}
        tasks={robotTasks}
        onSendToCharge={handleSendToCharge}
        onReturnHome={handleReturnHome}
      />
    </div>
  );
}
