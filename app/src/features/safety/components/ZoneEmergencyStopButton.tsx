/**
 * @file ZoneEmergencyStopButton.tsx
 * @description Zone-based emergency stop button with confirmation dialog
 * @feature safety
 */

import { useState, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { useZoneSafety } from '../hooks/useSafety';
import { useAlerts } from '@/features/alerts/hooks/useAlerts';

// ============================================================================
// TYPES
// ============================================================================

export interface ZoneEmergencyStopButtonProps {
  /** Zone ID */
  zoneId: string;
  /** Zone name for display */
  zoneName: string;
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Zone-based emergency stop button that halts all robots in a specific zone.
 */
export function ZoneEmergencyStopButton({
  zoneId,
  zoneName,
  size = 'md',
  className,
}: ZoneEmergencyStopButtonProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  const { isTriggering, triggerEStop, lastError } = useZoneSafety(zoneId);
  const { addAlert } = useAlerts();

  const handleClick = useCallback(() => {
    setIsConfirmOpen(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    const stopReason = reason.trim() || `Zone emergency stop for ${zoneName}`;
    const success = await triggerEStop(stopReason);

    if (success) {
      addAlert({
        severity: 'critical',
        title: `Zone E-Stop: ${zoneName}`,
        message: `All robots in ${zoneName} have been stopped.`,
        source: 'system',
        sourceId: zoneId,
        dismissable: false,
      });
    } else {
      addAlert({
        severity: 'error',
        title: 'Zone E-Stop Failed',
        message: lastError || `Failed to stop robots in ${zoneName}.`,
        source: 'system',
        sourceId: zoneId,
      });
    }

    setIsConfirmOpen(false);
    setReason('');
  }, [reason, zoneName, zoneId, triggerEStop, addAlert, lastError]);

  const handleCancel = useCallback(() => {
    setIsConfirmOpen(false);
    setReason('');
  }, []);

  const iconSize = size === 'sm' ? 14 : size === 'lg' ? 20 : 16;

  return (
    <>
      <Button
        variant="destructive"
        size={size}
        onClick={handleClick}
        isLoading={isTriggering}
        disabled={isTriggering}
        className={cn('font-semibold', className)}
        aria-label={`Emergency stop for zone ${zoneName}`}
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
          className="mr-1.5"
        >
          <circle cx="12" cy="12" r="10" />
          <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
        </svg>
        Stop Zone
      </Button>

      <Modal
        isOpen={isConfirmOpen}
        onClose={handleCancel}
        title={`Stop Zone: ${zoneName}`}
        size="sm"
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
              onClick={handleConfirm}
              isLoading={isTriggering}
            >
              Stop Robots
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
                This will stop all robots in {zoneName}
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="zone-estop-reason"
              className="block text-sm font-medium text-theme-secondary mb-2"
            >
              Reason (optional)
            </label>
            <input
              id="zone-estop-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason..."
              className={cn(
                'w-full px-3 py-2 rounded-lg border',
                'bg-theme-elevated border-theme-subtle',
                'text-theme-primary placeholder:text-theme-muted',
                'focus:outline-none focus:ring-2 focus:ring-red-500'
              )}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
