/**
 * @file FleetEmergencyStopButton.tsx
 * @description Fleet-wide emergency stop. Fires on one press (the E-stop never
 *              confirms); while stopped it shows the stopped tag and a
 *              "Resume fleet" act that does confirm, because resuming moves robots.
 * @feature safety
 */

import { useCallback } from 'react';
import { OctagonX, Play } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, StatusTag, confirm, toast } from '@/shared/components/ui';
import { useFleetSafety } from '../hooks/useSafety';
import { useSafetyStore } from '../store/safetyStore';
import { STOP_BUTTON_CLASS, STOP_ICON_CLASS, lastSafetyError } from './stopStyles';

export interface FleetEmergencyStopButtonProps {
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

const plural = (n: number) => `${n} robot${n === 1 ? '' : 's'}`;

/**
 * Fleet-wide emergency stop button that halts every connected robot at once.
 */
export function FleetEmergencyStopButton({ size = 'lg', className }: FleetEmergencyStopButtonProps) {
  const { hasTriggeredEStop, triggeredCount, isTriggering, isResetting, triggerEStop, resetEStop } =
    useFleetSafety();

  const handleStop = useCallback(async () => {
    const robotCount = useSafetyStore.getState().fleetStatus?.robots.length ?? 0;
    const ok = await triggerEStop('Fleet-wide emergency stop triggered by operator');
    if (ok) {
      toast.warning('Fleet stopped', {
        description:
          robotCount > 0
            ? `${plural(robotCount)} received the stop.`
            : 'Every connected robot received the stop.',
      });
    } else {
      toast.error("Couldn't stop the fleet", {
        description: lastSafetyError('The stop did not reach the server. Use the hardware stop.'),
        duration: null,
      });
    }
  }, [triggerEStop]);

  const handleResume = useCallback(async () => {
    const ok = await confirm({
      title: 'Resume the fleet?',
      description: 'Robots leave the protective stop and continue their tasks.',
      confirmLabel: 'Resume fleet',
    });
    if (!ok) return;
    if (await resetEStop()) {
      toast.success('Fleet resumed');
    } else {
      toast.error("Couldn't resume the fleet", { description: lastSafetyError('Try again.') });
    }
  }, [resetEStop]);

  const busy = isTriggering || isResetting;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {hasTriggeredEStop && (
        <>
          <StatusTag tone="stopped" dot>
            {triggeredCount > 0 ? `${plural(triggeredCount)} stopped` : 'Fleet stopped'}
          </StatusTag>
          <Button
            variant="secondary"
            size={size === 'lg' ? 'md' : size}
            leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />}
            onClick={() => void handleResume()}
            isLoading={isResetting}
            disabled={busy}
          >
            Resume fleet
          </Button>
        </>
      )}
      <Button
        size={size}
        onClick={() => void handleStop()}
        isLoading={isTriggering}
        disabled={busy}
        className={STOP_BUTTON_CLASS}
        leftIcon={<OctagonX className={STOP_ICON_CLASS} strokeWidth={1.75} />}
        aria-label="Emergency stop all robots"
      >
        Stop fleet
      </Button>
    </div>
  );
}
