/**
 * @file FleetEmergencyStopButton.tsx
 * @description Fleet-wide emergency stop button with confirmation dialog
 * @feature safety
 */

import { useState, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { useFleetSafety } from '../hooks/useSafety';
import { useAlerts } from '@/features/alerts/hooks/useAlerts';

// ============================================================================
// TYPES
// ============================================================================

export interface FleetEmergencyStopButtonProps {
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Fleet-wide emergency stop button that halts all connected robots.
 * Shows a confirmation dialog before executing.
 */
export function FleetEmergencyStopButton({
  size = 'lg',
  className,
}: FleetEmergencyStopButtonProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  const {
    hasTriggeredEStop,
    triggeredCount,
    isTriggering,
    isResetting,
    triggerEStop,
    resetEStop,
    lastError,
  } = useFleetSafety();

  const { addAlert } = useAlerts();

  const handleTriggerClick = useCallback(() => {
    setIsConfirmOpen(true);
  }, []);

  const handleConfirmTrigger = useCallback(async () => {
    const stopReason = reason.trim() || 'Fleet-wide emergency stop triggered by operator';
    const success = await triggerEStop(stopReason);

    if (success) {
      addAlert({
        severity: 'critical',
        title: 'Fleet Emergency Stop Executed',
        message: 'All robots have been commanded to stop immediately.',
        source: 'system',
        sourceId: 'fleet',
        dismissable: false,
      });
    } else {
      addAlert({
        severity: 'error',
        title: 'Fleet Emergency Stop Failed',
        message: lastError || 'Failed to trigger fleet-wide emergency stop.',
        source: 'system',
        sourceId: 'fleet',
      });
    }

    setIsConfirmOpen(false);
    setReason('');
  }, [reason, triggerEStop, addAlert, lastError]);

  const handleReset = useCallback(async () => {
    const success = await resetEStop();

    if (success) {
      addAlert({
        severity: 'info',
        title: 'Fleet E-Stop Reset',
        message: 'All robots have been released from emergency stop.',
        source: 'system',
        sourceId: 'fleet',
      });
    } else {
      addAlert({
        severity: 'error',
        title: 'Fleet E-Stop Reset Failed',
        message: lastError || 'Failed to reset fleet emergency stop.',
        source: 'system',
        sourceId: 'fleet',
      });
    }
  }, [resetEStop, addAlert, lastError]);

  const handleCancel = useCallback(() => {
    setIsConfirmOpen(false);
    setReason('');
  }, []);

  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 28 : 20;

  return (
    <>
      {/* Main Button */}
      <div className={cn('flex flex-col gap-2', className)}>
        <Button
          variant="destructive"
          size={size}
          onClick={handleTriggerClick}
          isLoading={isTriggering}
          disabled={isTriggering || isResetting}
          className={cn(
            'font-bold uppercase tracking-wide',
            size === 'lg' && 'px-8 py-4 text-lg',
            hasTriggeredEStop && 'animate-pulse'
          )}
          aria-label="Fleet-wide emergency stop"
        >
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
            className="mr-2"
          >
            <circle cx="12" cy="12" r="10" />
            <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
          </svg>
          Fleet E-Stop
        </Button>

        {/* Status indicator */}
        {hasTriggeredEStop && (
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="text-sm font-medium text-red-500">
              {triggeredCount} robot{triggeredCount !== 1 ? 's' : ''} stopped
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              isLoading={isResetting}
              disabled={isTriggering || isResetting}
            >
              Reset All
            </Button>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={isConfirmOpen}
        onClose={handleCancel}
        title="Confirm Fleet Emergency Stop"
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
              Stop All Robots
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
                This will immediately halt ALL robots in the fleet
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                All current operations and movements will be stopped. Manual reset will be required for each robot to resume operations.
              </p>
            </div>
          </div>

          {/* Reason input */}
          <div>
            <label
              htmlFor="estop-reason"
              className="block text-sm font-medium text-theme-secondary mb-2"
            >
              Reason for emergency stop (optional)
            </label>
            <textarea
              id="estop-reason"
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
            Are you sure you want to trigger a fleet-wide emergency stop?
          </p>
        </div>
      </Modal>
    </>
  );
}
