/**
 * @file EmergencyStopButton.tsx
 * @description Emergency stop button with confirmation dialog
 * @feature robots
 * @dependencies @/shared/components/ui, @/features/robots/api, @/features/alerts/hooks
 * @apiCalls robotsApi.emergencyStop
 */

import { useState, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { robotsApi } from '../api/robotsApi';
import { useAlerts } from '@/features/alerts/hooks/useAlerts';

// ============================================================================
// TYPES
// ============================================================================

export interface EmergencyStopButtonProps {
  /** Robot ID to stop */
  robotId: string;
  /** Robot name for display */
  robotName?: string;
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show confirmation dialog */
  showConfirmation?: boolean;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Emergency stop button that sends an immediate stop command to a robot.
 * Shows a confirmation dialog before executing (can be disabled).
 *
 * @example
 * ```tsx
 * <EmergencyStopButton
 *   robotId="robot-1"
 *   robotName="ARM-001"
 *   size="lg"
 * />
 * ```
 */
export function EmergencyStopButton({
  robotId,
  robotName,
  size = 'md',
  showConfirmation = true,
  className,
}: EmergencyStopButtonProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const { addAlert } = useAlerts();

  const displayName = robotName || robotId;

  const executeEmergencyStop = useCallback(async () => {
    setIsExecuting(true);

    try {
      await robotsApi.emergencyStop(robotId);

      addAlert({
        severity: 'critical',
        title: 'Emergency Stop Executed',
        message: `Emergency stop command sent to ${displayName}. Robot has been halted.`,
        source: 'robot',
        sourceId: robotId,
        dismissable: false,
      });

      setIsConfirmOpen(false);
    } catch (error) {
      addAlert({
        severity: 'error',
        title: 'Emergency Stop Failed',
        message: `Failed to send emergency stop to ${displayName}. Please try again or check robot connectivity.`,
        source: 'robot',
        sourceId: robotId,
      });
    } finally {
      setIsExecuting(false);
    }
  }, [robotId, displayName, addAlert]);

  const handleClick = useCallback(() => {
    if (showConfirmation) {
      setIsConfirmOpen(true);
    } else {
      executeEmergencyStop();
    }
  }, [showConfirmation, executeEmergencyStop]);

  const handleConfirm = useCallback(() => {
    executeEmergencyStop();
  }, [executeEmergencyStop]);

  const handleCancel = useCallback(() => {
    setIsConfirmOpen(false);
  }, []);

  // Size-based icon sizing
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 24 : 20;

  return (
    <>
      <Button
        variant="destructive"
        size={size}
        onClick={handleClick}
        isLoading={isExecuting}
        className={cn('font-semibold', className)}
        aria-label={`Emergency stop ${displayName}`}
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
        Emergency Stop
      </Button>

      <Modal
        isOpen={isConfirmOpen}
        onClose={handleCancel}
        title="Confirm Emergency Stop"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleCancel} disabled={isExecuting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              isLoading={isExecuting}
            >
              Stop Robot
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-red-100 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
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
              <p className="font-medium text-red-900 dark:text-red-200">
                This action will immediately halt the robot
              </p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                All current operations will be stopped.
              </p>
            </div>
          </div>

          <p className="text-theme-secondary">
            Are you sure you want to send an emergency stop command to{' '}
            <span className="font-medium text-theme-primary">{displayName}</span>?
          </p>
        </div>
      </Modal>
    </>
  );
}
