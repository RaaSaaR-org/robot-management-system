/**
 * @file RobotDetailPanel.tsx
 * @description Comprehensive panel displaying robot details, telemetry, and controls
 * @feature robots
 */

import { useState, useCallback } from 'react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import { RobotLoadingScreen } from './RobotLoadingScreen';
import { RobotIdentityBar } from './RobotIdentityBar';
import { RobotQuickStats } from './RobotQuickStats';
import { RobotControlCenter } from './RobotControlCenter';
import { AutonomousExecutionPanel } from './AutonomousExecutionPanel';
import { useRobot } from '../hooks/useRobots';
import { useTelemetryStream } from '../hooks/useTelemetryStream';
import { useTasksByRobotId } from '@/features/processes/hooks/useTasks';
import { isRobotAvailable } from '../types/robots.types';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotDetailPanelProps {
  /** Robot ID to display */
  robotId: string;
  /** Callback when back button is clicked */
  onBack?: () => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function RobotDetailPanel({ robotId, onBack, className }: RobotDetailPanelProps) {
  const {
    robot,
    commandHistory,
    isLoading,
    error,
    refresh,
    sendToCharge,
    returnHome,
  } = useRobot(robotId);

  const {
    telemetry,
    isConnected: isTelemetryConnected,
    lastUpdate: telemetryLastUpdate,
  } = useTelemetryStream(robotId);

  const robotTasks = useTasksByRobotId(robotId);
  const [isCommandLoading, setIsCommandLoading] = useState(false);
  // Controls whether the loading screen is visible (hidden after it fades out)
  const [isLoadingScreenHidden, setIsLoadingScreenHidden] = useState(false);

  const executeCommand = useCallback(async (commandFn: () => Promise<unknown>) => {
    setIsCommandLoading(true);
    try {
      await commandFn();
      await refresh();
    } finally {
      setIsCommandLoading(false);
    }
  }, [refresh]);

  const handleSendToCharge = useCallback(() => executeCommand(sendToCharge), [executeCommand, sendToCharge]);
  const handleReturnHome = useCallback(() => executeCommand(returnHome), [executeCommand, returnHome]);

  // Data is ready once we have the robot entity
  const isDataLoaded = !!robot;

  // Error state (no robot loaded and error)
  if (error && !robot && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-red-100 p-4 dark:bg-red-900/30">
          <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-medium text-theme-primary">Robot not found</h3>
        <p className="mt-1 text-sm text-theme-secondary">{error}</p>
        {onBack && (
          <Button variant="primary" size="sm" className="mt-4" onClick={onBack}>
            Go Back
          </Button>
        )}
      </div>
    );
  }

  const canExecuteCommands = robot ? isRobotAvailable(robot) && !isCommandLoading : false;

  return (
    <>
      {/* Futuristic loading overlay — shown until robot data arrives, then fades out */}
      {!isLoadingScreenHidden && (
        <RobotLoadingScreen
          robotId={robotId}
          robotName={robot?.name}
          isLoaded={isDataLoaded}
          onHidden={() => setIsLoadingScreenHidden(true)}
        />
      )}

      {/* Main content — rendered in background while loading screen is up, revealed after */}
      {robot && (
        <div
          className={cn('flex flex-col gap-4 pb-24 lg:pb-6', className)}
          style={
            isDataLoaded && isLoadingScreenHidden
              ? { animation: 'materialize 0.7s ease-out forwards' }
              : { opacity: 0 }
          }
        >
          {/* Identity bar */}
          <RobotIdentityBar
            robot={robot}
            telemetry={telemetry}
            isTelemetryConnected={isTelemetryConnected}
            onBack={onBack}
          />

          {/* Quick stats strip */}
          <RobotQuickStats
            robot={robot}
            telemetry={telemetry}
            taskCount={robotTasks.length}
            isTelemetryConnected={isTelemetryConnected}
          />

          {/* Autonomous execution panel — only visible when ?executing=<skillId> */}
          <AutonomousExecutionPanel robotId={robotId} />

          {/* Control center — view switcher + chat sidebar */}
          <RobotControlCenter
            robot={robot}
            robotId={robotId}
            telemetry={telemetry}
            isTelemetryConnected={isTelemetryConnected}
            telemetryLastUpdate={telemetryLastUpdate}
            commandHistory={commandHistory}
            isCommandLoading={isCommandLoading}
            canExecuteCommands={canExecuteCommands}
            tasks={robotTasks}
            onSendToCharge={handleSendToCharge}
            onReturnHome={handleReturnHome}
          />
        </div>
      )}
    </>
  );
}
