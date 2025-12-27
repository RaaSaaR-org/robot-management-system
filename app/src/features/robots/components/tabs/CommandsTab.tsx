/**
 * @file CommandsTab.tsx
 * @description Commands tab with quick commands, NL input, and history
 * @feature robots
 */

import { Card, Button, Badge } from '@/shared/components/ui';
import { formatTimeAgo } from '@/shared/utils';
import { EmergencyStopButton } from '../EmergencyStopButton';
import { CommandBar, CommandHistory } from '@/features/command';
import { isRobotAvailable, COMMAND_TYPE_LABELS } from '../../types/robots.types';
import type { CommandStatus } from '../../types/robots.types';
import type { CommandsTabProps } from './types';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

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

// ============================================================================
// COMPONENT
// ============================================================================

export function CommandsTab({
  robot,
  robotId,
  commandHistory,
  isCommandLoading,
  canExecuteCommands,
  onSendToCharge,
  onReturnHome,
}: CommandsTabProps) {
  return (
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
              onClick={onSendToCharge}
            >
              Send to Charge
            </Button>
            <Button
              variant="outline"
              fullWidth
              disabled={!canExecuteCommands}
              isLoading={isCommandLoading}
              onClick={onReturnHome}
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
  );
}
