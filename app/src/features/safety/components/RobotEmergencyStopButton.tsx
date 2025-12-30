/**
 * @file RobotEmergencyStopButton.tsx
 * @description Per-robot emergency stop button with confirmation dialog
 * @feature safety
 */

import { useState, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { useRobotSafety } from '../hooks/useSafety';
import { useAlerts } from '@/features/alerts/hooks/useAlerts';

// ============================================================================
// TYPES
// ============================================================================

export interface RobotEmergencyStopButtonProps {
  /** Robot ID */
  robotId: string;
  /** Robot name for display */
  robotName?: string;
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
  /** Show as compact button (icon only) */
  compact?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Per-robot emergency stop button that halts a single robot.
 * Shows a confirmation dialog before executing.
 */
export function RobotEmergencyStopButton({
  robotId,
  robotName,
  size = 'md',
  className,
  compact = false,
}: RobotEmergencyStopButtonProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  const {
    isTriggered,
    isTriggering,
    isResetting,
    triggerEStop,
    resetEStop,
    lastError,
  } = useRobotSafety(robotId);

  const { addAlert } = useAlerts();

  const displayName = robotName || robotId;

  const handleTriggerClick = useCallback(() => {
    setIsConfirmOpen(true);
  }, []);

  const handleConfirmTrigger = useCallback(async () => {
    const stopReason = reason.trim() || `Emergency stop triggered for ${displayName}`;
    const success = await triggerEStop(stopReason);

    if (success) {
      addAlert({
        severity: 'critical',
        title: `Emergency Stop - ${displayName}`,
        message: `Robot has been commanded to stop immediately.`,
        source: 'robot',
        sourceId: robotId,
        dismissable: false,
      });
    } else {
      addAlert({
        severity: 'error',
        title: `Emergency Stop Failed - ${displayName}`,
        message: lastError || 'Failed to trigger emergency stop.',
        source: 'robot',
        sourceId: robotId,
      });
    }

    setIsConfirmOpen(false);
    setReason('');
  }, [reason, triggerEStop, addAlert, lastError, displayName, robotId]);

  const handleReset = useCallback(async () => {
    const success = await resetEStop();

    if (success) {
      addAlert({
        severity: 'info',
        title: `E-Stop Reset - ${displayName}`,
        message: 'Robot has been released from emergency stop.',
        source: 'robot',
        sourceId: robotId,
      });
    } else {
      addAlert({
        severity: 'error',
        title: `E-Stop Reset Failed - ${displayName}`,
        message: lastError || 'Failed to reset emergency stop.',
        source: 'robot',
        sourceId: robotId,
      });
    }
  }, [resetEStop, addAlert, lastError, displayName, robotId]);

  const handleCancel = useCallback(() => {
    setIsConfirmOpen(false);
    setReason('');
  }, []);

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 24 : 18;

  const StopIcon = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={compact ? '' : 'mr-2'}
    >
      <circle cx="12" cy="12" r="10" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
    </svg>
  );

  return (
    <>
      {/* Main Button */}
      <div className={cn('flex items-center gap-2', className)}>
        <Button
          variant="destructive"
          size={size}
          onClick={handleTriggerClick}
          isLoading={isTriggering}
          disabled={isTriggering || isResetting}
          className={cn(
            'font-semibold',
            isTriggered && 'animate-pulse'
          )}
          aria-label={`Emergency stop ${displayName}`}
          title={`Emergency stop ${displayName}`}
        >
          {StopIcon}
          {!compact && 'E-Stop'}
        </Button>

        {/* Status indicator & Reset button */}
        {isTriggered && (
          <>
            <span className="flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              isLoading={isResetting}
              disabled={isTriggering || isResetting}
            >
              Reset
            </Button>
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={isConfirmOpen}
        onClose={handleCancel}
        title={`Confirm Emergency Stop`}
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isTriggering}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmTrigger}
              isLoading={isTriggering}
            >
              Stop Robot
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Warning banner */}
          <div className="flex items-start gap-3 p-4 bg-red-100 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-red-600 dark:text-red-400 flex-shrink-0"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <p className="font-semibold text-red-900 dark:text-red-200">
                This will immediately halt {displayName}
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                All current operations and movements will be stopped. Manual reset will be required to resume operations.
              </p>
            </div>
          </div>

          {/* Reason input */}
          <div>
            <label
              htmlFor="robot-estop-reason"
              className="block text-sm font-medium text-theme-secondary mb-2"
            >
              Reason for emergency stop (optional)
            </label>
            <textarea
              id="robot-estop-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for audit log..."
              rows={2}
              className={cn(
                'w-full px-3 py-2 rounded-lg border',
                'bg-theme-elevated border-theme-subtle',
                'text-theme-primary placeholder:text-theme-muted',
                'focus:outline-none focus:ring-2 focus:ring-red-500'
              )}
            />
          </div>

          <p className="text-sm text-theme-secondary">
            Are you sure you want to trigger an emergency stop for <strong>{displayName}</strong>?
          </p>
        </div>
      </Modal>
    </>
  );
}
