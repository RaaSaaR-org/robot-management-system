/**
 * @file ManualControlPanel.tsx
 * @description Panel for activating/deactivating manual control mode
 * @feature oversight
 */

import { useState } from 'react';
import { Hand, Power, Clock, User } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import type { ManualControlSession, ActivateManualModeInput } from '../types';
import { MANUAL_SPEED_LIMITS } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface ManualControlPanelProps {
  activeSessions: ManualControlSession[];
  robots: Array<{ id: string; name: string; status: string }>;
  onActivate: (input: ActivateManualModeInput) => Promise<unknown>;
  onDeactivate: (robotId: string) => Promise<void>;
  isActivating?: boolean;
  isDeactivating?: boolean;
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface ActiveSessionCardProps {
  session: ManualControlSession;
  onDeactivate: () => Promise<void>;
  isDeactivating?: boolean;
}

function ActiveSessionCard({ session, onDeactivate, isDeactivating }: ActiveSessionCardProps) {
  const duration = formatDuration(new Date(session.startedAt));

  return (
    <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Hand className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="font-semibold text-theme-primary">
              {session.robotName || session.robotId}
            </span>
            <Badge variant="warning">Manual Mode</Badge>
          </div>

          <p className="mt-2 text-sm text-theme-secondary">
            {session.reason}
          </p>

          <div className="mt-2 grid grid-cols-2 gap-4 text-xs text-theme-muted">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Duration: {duration}
            </div>
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {session.operatorName || session.operatorId}
            </div>
            <div>
              Speed limit: {session.speedLimitMmPerSec} mm/s
            </div>
            <div>
              Force limit: {session.forceLimitN} N
            </div>
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={onDeactivate}
          disabled={isDeactivating}
        >
          <Power className="h-4 w-4 mr-1" />
          Deactivate
        </Button>
      </div>
    </div>
  );
}

interface ActivateFormProps {
  robots: Array<{ id: string; name: string; status: string }>;
  activeSessions: ManualControlSession[];
  onActivate: (input: ActivateManualModeInput) => Promise<unknown>;
  isActivating?: boolean;
}

function ActivateForm({ robots, activeSessions, onActivate, isActivating }: ActivateFormProps) {
  const [selectedRobotId, setSelectedRobotId] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'reduced_speed' | 'full_speed'>('reduced_speed');
  const [showForm, setShowForm] = useState(false);

  const availableRobots = robots.filter(
    (r) => r.status === 'online' && !activeSessions.some((s) => s.robotId === r.id)
  );

  const handleSubmit = async () => {
    if (!selectedRobotId || !reason.trim()) return;

    await onActivate({
      robotId: selectedRobotId,
      reason: reason.trim(),
      mode,
    });

    setSelectedRobotId('');
    setReason('');
    setMode('reduced_speed');
    setShowForm(false);
  };

  if (!showForm) {
    return (
      <Button
        variant="secondary"
        onClick={() => setShowForm(true)}
        disabled={availableRobots.length === 0}
        className="w-full"
      >
        <Hand className="h-4 w-4 mr-2" />
        Activate Manual Control
      </Button>
    );
  }

  return (
    <div className="p-4 rounded-lg bg-theme-elevated border border-theme-subtle space-y-4">
      <h4 className="font-medium text-theme-primary">Activate Manual Control</h4>

      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-1">
          Robot
        </label>
        <select
          value={selectedRobotId}
          onChange={(e) => setSelectedRobotId(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-md border border-theme-subtle bg-theme-bg text-theme-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select a robot...</option>
          {availableRobots.map((robot) => (
            <option key={robot.id} value={robot.id}>
              {robot.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-1">
          Reason
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is manual control needed?"
          className="w-full px-3 py-2 text-sm rounded-md border border-theme-subtle bg-theme-bg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-2">
          Speed Mode (ISO 10218-1)
        </label>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="reduced_speed"
              checked={mode === 'reduced_speed'}
              onChange={() => setMode('reduced_speed')}
              className="text-blue-500"
            />
            <span className="text-sm text-theme-secondary">
              Reduced ({MANUAL_SPEED_LIMITS.reduced} mm/s)
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="mode"
              value="full_speed"
              checked={mode === 'full_speed'}
              onChange={() => setMode('full_speed')}
              className="text-blue-500"
            />
            <span className="text-sm text-theme-secondary">
              Full ({MANUAL_SPEED_LIMITS.full} mm/s)
            </span>
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="ghost"
          onClick={() => setShowForm(false)}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={isActivating || !selectedRobotId || !reason.trim()}
          className="flex-1"
        >
          {isActivating ? 'Activating...' : 'Activate'}
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDuration(startedAt: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - startedAt.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 60) return `${diffMins}m`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
  return `${Math.floor(diffMins / 1440)}d ${Math.floor((diffMins % 1440) / 60)}h`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ManualControlPanel({
  activeSessions,
  robots,
  onActivate,
  onDeactivate,
  isActivating,
  isDeactivating,
  className,
}: ManualControlPanelProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Hand className="h-5 w-5 text-theme-muted" />
          <h3 className="font-semibold text-theme-primary">Manual Control</h3>
        </div>
        {activeSessions.length > 0 && (
          <Badge variant="warning">
            {activeSessions.length} active
          </Badge>
        )}
      </div>

      {activeSessions.length > 0 && (
        <div className="space-y-3">
          {activeSessions.map((session) => (
            <ActiveSessionCard
              key={session.id}
              session={session}
              onDeactivate={() => onDeactivate(session.robotId)}
              isDeactivating={isDeactivating}
            />
          ))}
        </div>
      )}

      <ActivateForm
        robots={robots}
        activeSessions={activeSessions}
        onActivate={onActivate}
        isActivating={isActivating}
      />
    </div>
  );
}
