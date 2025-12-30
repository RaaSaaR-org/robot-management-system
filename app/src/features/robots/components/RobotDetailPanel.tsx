/**
 * @file RobotDetailPanel.tsx
 * @description Comprehensive panel displaying robot details, telemetry, and controls
 * @feature robots
 */

import { useState, useMemo, useCallback } from 'react';
import { Button, Spinner, Tabs } from '@/shared/components/ui';
import type { Tab } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import { RobotHeroSection } from './RobotHeroSection';
import { RobotOfflineBanner } from './RobotOfflineBanner';
import { RobotErrorBanner } from './RobotErrorBanner';
import { RobotEmergencyStopButton } from '@/features/safety';
import {
  TelemetryTab,
  CommandsTab,
  TasksTab,
  InfoTab,
  Model3DTab,
  ChatTab,
} from './tabs';
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
// TAB ICONS
// ============================================================================

const TabIcons = {
  telemetry: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  commands: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
    </svg>
  ),
  tasks: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
    </svg>
  ),
  info: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  ),
  chat: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  model3d: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>
  ),
};

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

  // Build tabs configuration
  const tabs = useMemo<Tab[]>(() => {
    if (!robot) return [];

    const canExecuteCommands = isRobotAvailable(robot) && !isCommandLoading;

    return [
      {
        id: 'telemetry',
        label: 'Telemetry',
        icon: TabIcons.telemetry,
        content: (
          <TelemetryTab
            robot={robot}
            robotId={robotId}
            telemetry={telemetry}
            isTelemetryConnected={isTelemetryConnected}
            telemetryLastUpdate={telemetryLastUpdate}
          />
        ),
      },
      {
        id: 'commands',
        label: 'Commands',
        icon: TabIcons.commands,
        content: (
          <CommandsTab
            robot={robot}
            robotId={robotId}
            commandHistory={commandHistory}
            isCommandLoading={isCommandLoading}
            canExecuteCommands={canExecuteCommands}
            onSendToCharge={handleSendToCharge}
            onReturnHome={handleReturnHome}
          />
        ),
      },
      {
        id: 'tasks',
        label: 'Tasks',
        icon: TabIcons.tasks,
        content: <TasksTab robot={robot} robotId={robotId} tasks={robotTasks} />,
      },
      {
        id: 'info',
        label: 'Info',
        icon: TabIcons.info,
        content: <InfoTab robot={robot} robotId={robotId} />,
      },
      {
        id: '3d-model',
        label: '3D Model',
        icon: TabIcons.model3d,
        content: (
          <Model3DTab
            robot={robot}
            robotId={robotId}
            telemetry={telemetry}
            isTelemetryConnected={isTelemetryConnected}
          />
        ),
      },
      {
        id: 'chat',
        label: 'Chat',
        icon: TabIcons.chat,
        content: <ChatTab robot={robot} robotId={robotId} />,
      },
    ];
  }, [
    robot,
    robotId,
    telemetry,
    isTelemetryConnected,
    telemetryLastUpdate,
    commandHistory,
    robotTasks,
    isCommandLoading,
    handleSendToCharge,
    handleReturnHome,
  ]);

  // Loading state
  if (isLoading && !robot) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" color="cobalt" label="Loading robot details..." />
      </div>
    );
  }

  // Error state
  if (error && !robot) {
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

  if (!robot) return null;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Back Button */}
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <svg className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back
        </Button>
      )}

      {/* Hero Section */}
      <RobotHeroSection robot={robot} telemetry={telemetry} isLive={isTelemetryConnected} />

      {/* Emergency Stop Section */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-theme-elevated border border-theme-subtle">
        <div className="flex items-center gap-3">
          <svg
            className="w-5 h-5 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-theme-primary">Safety Control</p>
            <p className="text-xs text-theme-secondary">Emergency stop for this robot</p>
          </div>
        </div>
        <RobotEmergencyStopButton robotId={robotId} robotName={robot.name} size="md" />
      </div>

      {/* Offline Banner */}
      {robot.status === 'offline' && (
        <RobotOfflineBanner robotName={robot.name} lastSeen={robot.lastSeen} />
      )}

      {/* Errors & Warnings Banner */}
      <RobotErrorBanner robot={robot} telemetry={telemetry} />

      {/* Tabbed Content */}
      <Tabs tabs={tabs} defaultTab="telemetry" />
    </div>
  );
}
