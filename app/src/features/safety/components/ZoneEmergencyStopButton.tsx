/**
 * @file ZoneEmergencyStopButton.tsx
 * @description Zone emergency stop: halts every robot in one zone on a single
 *              press (the E-stop never confirms) and reports the result as a toast.
 * @feature safety
 */

import { useCallback } from 'react';
import { OctagonX } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, toast } from '@/shared/components/ui';
import { useZoneSafety } from '../hooks/useSafety';
import { STOP_BUTTON_CLASS, STOP_ICON_CLASS, lastSafetyError } from './stopStyles';

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

/**
 * Zone-based emergency stop button that halts all robots in a specific zone.
 */
export function ZoneEmergencyStopButton({
  zoneId,
  zoneName,
  size = 'md',
  className,
}: ZoneEmergencyStopButtonProps) {
  const { isTriggering, triggerEStop } = useZoneSafety(zoneId);

  const handleStop = useCallback(async () => {
    if (await triggerEStop(`Zone emergency stop for ${zoneName}`)) {
      toast.warning('Zone stopped', { description: `Every robot in ${zoneName} received the stop.` });
    } else {
      toast.error(`Couldn't stop ${zoneName}`, {
        description: lastSafetyError('The stop did not reach the server. Use the hardware stop.'),
        duration: null,
      });
    }
  }, [triggerEStop, zoneName]);

  return (
    <Button
      size={size}
      onClick={() => void handleStop()}
      isLoading={isTriggering}
      disabled={isTriggering}
      className={cn(STOP_BUTTON_CLASS, className)}
      leftIcon={<OctagonX className={STOP_ICON_CLASS} strokeWidth={1.75} />}
      aria-label={`Emergency stop zone ${zoneName}`}
    >
      Stop zone
    </Button>
  );
}
