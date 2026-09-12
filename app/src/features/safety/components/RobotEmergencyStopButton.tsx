/**
 * @file RobotEmergencyStopButton.tsx
 * @description Per-robot emergency stop. Fires on one press (the E-stop never
 *              confirms); while stopped it shows the stopped tag and a
 *              "Resume robot" act that confirms first, because it moves the robot.
 * @feature safety
 */

import { useCallback } from 'react';
import { OctagonX, Play } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, StatusTag, confirm, toast } from '@/shared/components/ui';
import { useRobotSafety } from '../hooks/useSafety';
import { STOP_BUTTON_CLASS, STOP_ICON_CLASS, lastSafetyError } from './stopStyles';

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

/**
 * Per-robot emergency stop button that halts a single robot.
 */
export function RobotEmergencyStopButton({
  robotId,
  robotName,
  size = 'md',
  className,
  compact = false,
}: RobotEmergencyStopButtonProps) {
  const { isTriggered, isTriggering, isResetting, triggerEStop, resetEStop } =
    useRobotSafety(robotId);

  const displayName = robotName || robotId;

  const handleStop = useCallback(async () => {
    if (await triggerEStop(`Emergency stop triggered for ${displayName}`)) {
      toast.warning('Robot stopped', { description: `${displayName} received the stop.` });
    } else {
      toast.error(`Couldn't stop ${displayName}`, {
        description: lastSafetyError('The stop did not reach the robot. Use the hardware stop.'),
        duration: null,
      });
    }
  }, [triggerEStop, displayName]);

  const handleResume = useCallback(async () => {
    const ok = await confirm({
      title: `Resume ${displayName}?`,
      description: `${displayName} leaves the protective stop and continues its task.`,
      confirmLabel: 'Resume robot',
    });
    if (!ok) return;
    if (await resetEStop()) {
      toast.success('Robot resumed', { description: displayName });
    } else {
      toast.error(`Couldn't resume ${displayName}`, { description: lastSafetyError('Try again.') });
    }
  }, [resetEStop, displayName]);

  const busy = isTriggering || isResetting;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {isTriggered && (
        <>
          <StatusTag tone="stopped" dot>
            Stopped
          </StatusTag>
          <Button
            variant="secondary"
            size={size === 'lg' ? 'md' : size}
            leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => void handleResume()}
            isLoading={isResetting}
            disabled={busy}
          >
            Resume robot
          </Button>
        </>
      )}
      <Button
        size={size}
        iconOnly={compact}
        onClick={() => void handleStop()}
        isLoading={isTriggering}
        disabled={busy}
        className={STOP_BUTTON_CLASS}
        leftIcon={compact ? undefined : <OctagonX className={STOP_ICON_CLASS} strokeWidth={1.75} />}
        aria-label={`Emergency stop ${displayName}`}
        title={`Emergency stop ${displayName}`}
      >
        {compact ? <OctagonX className={STOP_ICON_CLASS} strokeWidth={1.75} /> : 'Stop robot'}
      </Button>
    </div>
  );
}
