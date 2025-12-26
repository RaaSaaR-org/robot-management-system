/**
 * @file RobotDetailPanel.tsx
 * @description Comprehensive panel displaying robot details, telemetry, and controls
 * @feature robots
 */

import { useState, useMemo, useCallback, Suspense, lazy } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, Button, Spinner, Badge, Tabs } from '@/shared/components/ui';
import type { Tab } from '@/shared/components/ui';
import { cn, CPU_THRESHOLDS, MEMORY_THRESHOLDS, getResourceVariant } from '@/shared/utils';
import { RobotHeroSection } from './RobotHeroSection';
import { RobotChatPanel } from './RobotChatPanel';
import { RobotOfflineBanner } from './RobotOfflineBanner';
import { BatteryGauge } from './BatteryGauge';
import { SensorGrid } from './SensorGrid';
import { EmergencyStopButton } from './EmergencyStopButton';
import { JointStateGrid, Robot3DViewerFallback } from './visualization';
import type { RobotType } from '../types/robots.types';

// Lazy load 3D viewer to reduce initial bundle size
const Robot3DViewer = lazy(() =>
  import('./visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer }))
);
import { CommandBar, CommandHistory } from '@/features/command';
import { useRobot } from '../hooks/useRobots';
import { useTelemetryStream } from '../hooks/useTelemetryStream';
import { useTasksByRobotId } from '@/features/processes/hooks/useTasks';
import { TaskStatusBadge } from '@/features/processes/components/TaskStatusBadge';
import {
  isRobotAvailable,
  COMMAND_TYPE_LABELS,
} from '../types/robots.types';
import type { CommandStatus } from '../types/robots.types';

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
// SUB-COMPONENTS
// ============================================================================

function ProgressBar({
  value,
  max = 100,
  variant = 'default',
  label,
}: {
  value: number;
  max?: number;
  variant?: 'default' | 'warning' | 'error' | 'success';
  label?: string;
}) {
  const percentage = Math.min(100, (value / max) * 100);

  const colorClass = {
    default: 'bg-gradient-to-r from-cobalt-400 to-cobalt-500',
    success: 'bg-gradient-to-r from-green-400 to-turquoise-400',
    warning: 'bg-gradient-to-r from-yellow-400 to-orange-400',
    error: 'bg-gradient-to-r from-red-400 to-red-500',
  }[variant];

  return (
    <div>
      {label && (
        <div className="flex justify-between mb-1">
          <span className="card-label">{label}</span>
          <span className="text-sm font-medium text-theme-primary">{value.toFixed(0)}%</span>
        </div>
      )}
      <div className="h-1.5 glass-subtle rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all duration-500 rounded-full', colorClass)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function CommandStatusBadge({ status }: { status: CommandStatus }) {
  const variants: Record<CommandStatus, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
    pending: 'default',
    executing: 'info',
    completed: 'success',
    failed: 'error',
    cancelled: 'warning',
  };

  const labels: Record<CommandStatus, string> = {
    pending: 'Pending',
    executing: 'Executing',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };

  return (
    <Badge variant={variants[status]} size="sm">
      {labels[status]}
    </Badge>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
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
  const navigate = useNavigate();
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

  const executeCommand = useCallback(async (commandFn: () => Promise<unknown>, name: string) => {
    setIsCommandLoading(true);
    try {
      await commandFn();
      await refresh();
    } catch (err) {
      console.error(`Failed to execute ${name}:`, err);
    } finally {
      setIsCommandLoading(false);
    }
  }, [refresh]);

  // Build tabs
  const tabs = useMemo<Tab[]>(() => {
    if (!robot) return [];

    const canExecuteCommands = isRobotAvailable(robot) && !isCommandLoading;
    const isOffline = robot.status === 'offline';

    return [
      {
        id: 'telemetry',
        label: 'Telemetry',
        icon: TabIcons.telemetry,
        content: (
          <div className="space-y-6">
            {/* System Metrics */}
            <Card>
              <Card.Header>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-theme-primary">System Metrics</h2>
                  {isOffline ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                      <span className="text-xs text-gray-400 font-medium">Offline</span>
                    </div>
                  ) : isTelemetryConnected ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs text-green-500 font-medium">Live</span>
                      {telemetryLastUpdate && (
                        <span className="text-xs text-theme-tertiary">
                          {telemetryLastUpdate.toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              </Card.Header>
              <Card.Body>
                {telemetry ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-6 p-4 rounded-xl glass-subtle">
                      <BatteryGauge
                        level={telemetry.batteryLevel}
                        voltage={telemetry.batteryVoltage}
                        temperature={telemetry.batteryTemperature}
                        charging={robot?.status === 'charging'}
                        size="lg"
                        showDetails
                      />
                      <div className="flex-1">
                        <div className="text-sm text-theme-secondary mb-1">Battery Status</div>
                        <div className="text-lg font-semibold text-theme-primary">
                          {telemetry.batteryLevel.toFixed(0)}%
                        </div>
                      </div>
                    </div>

                    <ProgressBar
                      label="CPU Usage"
                      value={telemetry.cpuUsage}
                      variant={getResourceVariant(telemetry.cpuUsage, CPU_THRESHOLDS.WARNING, CPU_THRESHOLDS.ERROR)}
                    />
                    <ProgressBar
                      label="Memory Usage"
                      value={telemetry.memoryUsage}
                      variant={getResourceVariant(telemetry.memoryUsage, MEMORY_THRESHOLDS.WARNING, MEMORY_THRESHOLDS.ERROR)}
                    />

                    <div className="pt-4 border-t border-glass-subtle">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="glass-subtle p-3 rounded-lg">
                          <span className="card-label">Temperature</span>
                          <p className="text-lg font-semibold text-theme-primary">{telemetry.temperature.toFixed(1)}°C</p>
                        </div>
                        {telemetry.speed !== undefined && (
                          <div className="glass-subtle p-3 rounded-lg">
                            <span className="card-label">Speed</span>
                            <p className="text-lg font-semibold text-theme-primary">{telemetry.speed.toFixed(2)} m/s</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : isOffline ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="glass-subtle rounded-2xl p-4 mb-3">
                      <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                      </svg>
                    </div>
                    <p className="text-theme-secondary font-medium">Telemetry data unavailable</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Last connected {formatTimeAgo(robot.lastSeen)}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Spinner size="md" color="cobalt" label="Loading telemetry..." />
                  </div>
                )}
              </Card.Body>
            </Card>

            {/* Sensor Diagnostics */}
            <Card>
              <Card.Header>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-theme-primary">Sensor Diagnostics</h2>
                  {isOffline ? (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                      <span className="text-xs text-gray-400">Offline</span>
                    </div>
                  ) : isTelemetryConnected && telemetry?.sensors ? (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs text-green-500">Live</span>
                    </div>
                  ) : null}
                </div>
              </Card.Header>
              <Card.Body>
                {telemetry?.sensors ? (
                  <SensorGrid sensors={telemetry.sensors} columns={2} />
                ) : isOffline ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="glass-subtle rounded-2xl p-4 mb-3">
                      <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.789M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                      </svg>
                    </div>
                    <p className="text-theme-secondary font-medium">Sensor data unavailable</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Robot is currently offline
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Spinner size="md" color="cobalt" label="Loading sensors..." />
                  </div>
                )}
              </Card.Body>
            </Card>
          </div>
        ),
      },
      {
        id: 'commands',
        label: 'Commands',
        icon: TabIcons.commands,
        content: (
          <div className="space-y-6">
            {/* Quick Commands */}
            <Card>
              <Card.Header>
                <h2 className="text-lg font-semibold text-theme-primary">Quick Commands</h2>
              </Card.Header>
              <Card.Body>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <EmergencyStopButton
                    robotId={robotId}
                    robotName={robot.name}
                    size="md"
                    className="w-full justify-center"
                  />
                  <Button
                    variant="secondary"
                    fullWidth
                    disabled={!canExecuteCommands}
                    isLoading={isCommandLoading}
                    onClick={() => executeCommand(sendToCharge, 'Send to Charge')}
                  >
                    Send to Charge
                  </Button>
                  <Button
                    variant="outline"
                    fullWidth
                    disabled={!canExecuteCommands}
                    isLoading={isCommandLoading}
                    onClick={() => executeCommand(returnHome, 'Return Home')}
                  >
                    Return Home
                  </Button>
                </div>
                {!isRobotAvailable(robot) && (
                  <div className="mt-4 flex items-start gap-4 p-4 rounded-xl glass-subtle border-gray-500/30 bg-gray-500/10">
                    <div className="p-2 rounded-lg glass-subtle border-gray-500/20">
                      <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-300">Commands Unavailable</h3>
                      <p className="mt-1 text-sm text-gray-400">
                        Robot must be online to receive commands. Current status: <span className="font-medium capitalize">{robot.status}</span>
                      </p>
                    </div>
                  </div>
                )}
              </Card.Body>
            </Card>

            {/* Natural Language Command */}
            <Card>
              <Card.Header>
                <h2 className="text-lg font-semibold text-theme-primary">Natural Language Command</h2>
              </Card.Header>
              <Card.Body>
                <CommandBar robotId={robotId} robotName={robot.name} />
              </Card.Body>
            </Card>

            {/* Command History */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CommandHistory robotId={robotId} maxHeight="300px" />

              <Card>
                <Card.Header>
                  <h2 className="text-lg font-semibold text-theme-primary">API Commands</h2>
                </Card.Header>
                <Card.Body>
                  {commandHistory.length > 0 ? (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {commandHistory.map((cmd) => (
                        <div
                          key={cmd.id}
                          className="flex items-center justify-between p-3 rounded-xl glass-subtle"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-theme-primary truncate">
                              {COMMAND_TYPE_LABELS[cmd.type] || cmd.type}
                            </p>
                            <p className="card-meta mt-0.5">{formatTimeAgo(cmd.createdAt)}</p>
                          </div>
                          <CommandStatusBadge status={cmd.status} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8">
                      <div className="glass-subtle rounded-2xl p-4 mb-3">
                        <svg className="h-6 w-6 text-theme-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <p className="card-meta">No commands recorded</p>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </div>
          </div>
        ),
      },
      {
        id: 'tasks',
        label: 'Tasks',
        icon: TabIcons.tasks,
        content: (
          <Card>
            <Card.Header>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-theme-primary">Assigned Tasks</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(`/tasks?robotId=${robotId}`)}
                >
                  View All
                  <svg className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Button>
              </div>
            </Card.Header>
            <Card.Body>
              {robotTasks.length > 0 ? (
                <div className="space-y-2">
                  {robotTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-4 rounded-xl glass-subtle cursor-pointer hover:border-glass-highlight transition-all duration-200"
                      onClick={() => navigate(`/tasks/${task.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/tasks/${task.id}`)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-theme-primary truncate">{task.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <div className="flex-1 max-w-[120px]">
                            <div className="h-1.5 glass-subtle rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-cobalt-400 to-turquoise-400 rounded-full"
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                          </div>
                          <span className="card-meta">{task.progress.toFixed(0)}%</span>
                        </div>
                      </div>
                      <TaskStatusBadge status={task.status} size="sm" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="glass-subtle rounded-2xl p-4 mb-3">
                    <svg className="h-8 w-8 text-theme-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-theme-secondary mb-4">No tasks assigned to this robot</p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => navigate(`/tasks?robotId=${robotId}`)}
                  >
                    Create Task
                  </Button>
                </div>
              )}
            </Card.Body>
          </Card>
        ),
      },
      {
        id: 'info',
        label: 'Info',
        icon: TabIcons.info,
        content: (
          <div className="space-y-6">
            {/* Capabilities */}
            <Card>
              <Card.Header>
                <h2 className="text-lg font-semibold text-theme-primary">Capabilities</h2>
              </Card.Header>
              <Card.Body>
                <div className="flex flex-wrap gap-2">
                  {robot.capabilities.length > 0 ? (
                    robot.capabilities.map((cap) => (
                      <Badge key={cap} variant="cobalt" size="md">
                        {cap}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-theme-tertiary">No capabilities listed</p>
                  )}
                </div>
              </Card.Body>
            </Card>

            {/* Robot Information */}
            <Card>
              <Card.Header>
                <h2 className="text-lg font-semibold text-theme-primary">Robot Details</h2>
              </Card.Header>
              <Card.Body>
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="glass-subtle p-3 rounded-xl">
                    <dt className="card-label">Robot ID</dt>
                    <dd className="font-mono text-sm text-theme-primary mt-1 truncate">{robot.id}</dd>
                  </div>
                  {robot.serialNumber && (
                    <div className="glass-subtle p-3 rounded-xl">
                      <dt className="card-label">Serial Number</dt>
                      <dd className="font-mono text-sm text-theme-primary mt-1">{robot.serialNumber}</dd>
                    </div>
                  )}
                  {robot.firmware && (
                    <div className="glass-subtle p-3 rounded-xl">
                      <dt className="card-label">Firmware</dt>
                      <dd className="text-sm text-theme-primary mt-1">{robot.firmware}</dd>
                    </div>
                  )}
                  {robot.ipAddress && (
                    <div className="glass-subtle p-3 rounded-xl">
                      <dt className="card-label">IP Address</dt>
                      <dd className="font-mono text-sm text-theme-primary mt-1">{robot.ipAddress}</dd>
                    </div>
                  )}
                  <div className="glass-subtle p-3 rounded-xl">
                    <dt className="card-label">Created</dt>
                    <dd className="text-sm text-theme-primary mt-1">{new Date(robot.createdAt).toLocaleDateString()}</dd>
                  </div>
                  <div className="glass-subtle p-3 rounded-xl">
                    <dt className="card-label">Last Updated</dt>
                    <dd className="text-sm text-theme-primary mt-1">{new Date(robot.updatedAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </Card.Body>
            </Card>

            {/* A2A Agent Section */}
            {(robot.a2aEnabled || robot.capabilities.includes('a2a')) && (
              <Card>
                <Card.Header>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500/20 to-cobalt-500/20">
                        <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <h2 className="text-lg font-semibold text-theme-primary">A2A Agent</h2>
                    </div>
                    <Badge variant={robot.a2aEnabled ? 'success' : 'default'} size="sm">
                      {robot.a2aEnabled ? 'Enabled' : 'Available'}
                    </Badge>
                  </div>
                </Card.Header>
                <Card.Body>
                  <div className="space-y-4">
                    <div className="glass-subtle p-4 rounded-xl">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-purple-500/10 to-cobalt-500/10">
                          <svg className="h-8 w-8 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-theme-primary">{robot.name} Agent</h3>
                          <p className="text-sm text-theme-secondary mt-1">
                            This robot can communicate with other A2A-compatible agents.
                          </p>
                          {robot.a2aAgentUrl && (
                            <p className="text-xs font-mono text-theme-tertiary mt-2 truncate">
                              {robot.a2aAgentUrl}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <Link to={`/a2a?robotId=${robot.id}`} className="flex-1">
                        <Button variant="secondary" fullWidth>
                          <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          Start A2A Conversation
                        </Button>
                      </Link>
                      <Link to="/a2a" className="flex-1">
                        <Button variant="outline" fullWidth>
                          View All Agents
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card.Body>
              </Card>
            )}
          </div>
        ),
      },
      // 3D Model tab
      {
        id: '3d-model',
        label: '3D Model',
        icon: TabIcons.model3d,
        content: (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 3D Viewer */}
            <Card className="min-h-[400px]">
              <Card.Header>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-theme-primary">3D Model</h2>
                  {telemetry?.robotType && (
                    <Badge variant="cobalt" size="sm">
                      {telemetry.robotType.toUpperCase()}
                    </Badge>
                  )}
                </div>
              </Card.Header>
              <Card.Body className="p-0 h-[350px]">
                <Suspense fallback={<Robot3DViewerFallback />}>
                  <Robot3DViewer
                    robotType={(telemetry?.robotType as RobotType) ?? (robot.metadata?.robotType as RobotType) ?? 'generic'}
                    jointStates={telemetry?.jointStates}
                    isAnimating={isTelemetryConnected}
                  />
                </Suspense>
              </Card.Body>
            </Card>

            {/* Joint States */}
            <Card>
              <Card.Header>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-theme-primary">Joint States</h2>
                  {isTelemetryConnected && telemetry?.jointStates ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs text-green-500 font-medium">Live</span>
                    </div>
                  ) : isOffline ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                      <span className="text-xs text-gray-400 font-medium">Offline</span>
                    </div>
                  ) : null}
                </div>
              </Card.Header>
              <Card.Body className="max-h-[350px] overflow-y-auto">
                <JointStateGrid jointStates={telemetry?.jointStates ?? []} columns={2} />
              </Card.Body>
            </Card>
          </div>
        ),
      },
      // Chat tab
      {
        id: 'chat',
        label: 'Chat',
        icon: TabIcons.chat,
        content: (
          <div className="h-[500px]">
            <RobotChatPanel
              robotId={robot.id}
              robotName={robot.name}
              agentUrl={robot.a2aAgentUrl}
            />
          </div>
        ),
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
    executeCommand,
    sendToCharge,
    returnHome,
    navigate,
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

      {/* Offline Banner */}
      {robot.status === 'offline' && (
        <RobotOfflineBanner robotName={robot.name} lastSeen={robot.lastSeen} />
      )}

      {/* Errors & Warnings Banner */}
      {(telemetry?.errors?.length || telemetry?.warnings?.length || !!robot.metadata?.errorCode || !!robot.metadata?.maintenanceReason) && (
        <div className="space-y-3">
          {/* Critical Errors */}
          {(telemetry?.errors?.length || !!robot.metadata?.errorCode) && (
            <div className="flex items-start gap-4 p-4 rounded-xl glass-subtle border-red-500/30 bg-red-500/10">
              <div className="p-2 rounded-lg glass-subtle border-red-500/20">
                <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-red-400">Error Detected</h3>
                <div className="mt-1 space-y-1">
                  {!!robot.metadata?.errorCode && (
                    <p className="text-sm text-red-300/80">
                      <span className="font-mono font-medium text-red-300">{String(robot.metadata.errorCode)}</span>
                      {!!robot.metadata?.errorMessage && `: ${String(robot.metadata.errorMessage)}`}
                    </p>
                  )}
                  {telemetry?.errors?.map((err, i) => (
                    <p key={i} className="text-sm text-red-300/80 font-mono">{err}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Warnings */}
          {telemetry?.warnings?.length ? (
            <div className="flex items-start gap-4 p-4 rounded-xl glass-subtle border-yellow-500/30 bg-yellow-500/10">
              <div className="p-2 rounded-lg glass-subtle border-yellow-500/20">
                <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-400">Warnings</h3>
                <div className="mt-1 space-y-1">
                  {telemetry.warnings.map((warn, i) => (
                    <p key={i} className="text-sm text-yellow-300/80">{warn}</p>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* Maintenance Notice */}
          {!!robot.metadata?.maintenanceReason && (
            <div className="flex items-start gap-4 p-4 rounded-xl glass-subtle border-orange-500/30 bg-orange-500/10">
              <div className="p-2 rounded-lg glass-subtle border-orange-500/20">
                <svg className="h-5 w-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-orange-400">Maintenance Mode</h3>
                <p className="mt-1 text-sm text-orange-300/80">{String(robot.metadata.maintenanceReason)}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabbed Content */}
      <Tabs tabs={tabs} defaultTab="telemetry" />
    </div>
  );
}
