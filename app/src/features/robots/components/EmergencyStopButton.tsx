/**
 * @file EmergencyStopButton.tsx
 * @description Emergency stop for one robot. Fires on a single press (the E-stop
 *   never asks for confirmation) and reports the result as a toast.
 * @feature robots
 * @apiCalls robotsApi.emergencyStop
 */

import { useCallback, useState } from 'react';
import { OctagonX } from 'lucide-react';
import { Button, errorMessage, toast } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { robotsApi } from '../api/robotsApi';

export interface EmergencyStopButtonProps {
  /** Robot ID to stop */
  robotId: string;
  /** Robot name for the toast and accessible label */
  robotName?: string;
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Kept for compatibility; the E-stop never confirms */
  showConfirmation?: boolean;
  /** Always show the short "E-stop" label */
  compact?: boolean;
  /** Stretch to the container width */
  fullWidth?: boolean;
  /** Additional class names */
  className?: string;
}

/** One-press emergency stop in the stop color. */
export function EmergencyStopButton({
  robotId,
  robotName,
  size = 'md',
  compact = false,
  fullWidth = false,
  className,
}: EmergencyStopButtonProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const displayName = robotName || robotId;

  const fire = useCallback(async () => {
    setIsExecuting(true);
    try {
      await robotsApi.emergencyStop(robotId);
      toast.success('Emergency stop sent', { description: displayName });
    } catch (err) {
      toast.error("Couldn't send emergency stop", {
        description: `${displayName}: ${errorMessage(err)}`,
      });
    } finally {
      setIsExecuting(false);
    }
  }, [robotId, displayName]);

  return (
    <Button
      size={size}
      onClick={() => void fire()}
      isLoading={isExecuting}
      loadingText="Stopping…"
      fullWidth={fullWidth}
      leftIcon={<OctagonX className="h-4 w-4" strokeWidth={1.75} />}
      className={cn('bg-stop font-semibold text-on-stop hover:bg-stop/90', className)}
      aria-label={`Emergency stop ${displayName}`}
    >
      {compact ? (
        'E-stop'
      ) : (
        <>
          <span className="sm:hidden">E-stop</span>
          <span className="hidden sm:inline">Emergency stop</span>
        </>
      )}
    </Button>
  );
}
