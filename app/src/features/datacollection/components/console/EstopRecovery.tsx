/**
 * @file EstopRecovery.tsx
 * @description The way out of a stop on the session page (TASK-431). It shows
 *              Reset E-stop first, then the agent's reason, what the button
 *              does, and why the reset failed when it did. Set up's step 3 and
 *              Record's recovery slot render it under their own title line.
 *              The button is the same reset the VR window offers, with no
 *              confirm. It is a normal action and always lies in the page's
 *              left column or in the take dock's slot, far from the E-STOP.
 * @feature datacollection
 */

import { RotateCcw } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { resetText, STAND_UP_AGAIN, type RobotStop } from '../../utils/robotStop';

export interface EstopRecoveryProps {
  stop: RobotStop;
  /** The page's one lit action: the current Set up step, or Record's slot. */
  lit: boolean;
  pending: boolean;
  /** Why the last reset failed, or null. */
  error: string | null;
  onReset: () => void;
  /** A VR session: the operator can also reset the latch in the headset. */
  headset?: boolean;
  /** The robot does not balance: say that it has to stand up again after the reset. */
  standUp?: boolean;
  /** Record's slot: the compact button and text. */
  dense?: boolean;
  className?: string;
}

export function EstopRecovery({
  stop, lit, pending, error, onReset, headset = false, standUp = true, dense = false, className,
}: EstopRecoveryProps) {
  const line = cn('m-0 leading-normal text-ink-secondary', dense ? 'mt-1.5 text-[13px]' : 'mt-2 max-w-[62ch] text-[14px]');
  return (
    <div className={cn('min-w-0', className)} data-testid="estop-recovery" data-kind={stop.kind} data-code={stop.code}>
      <Button
        variant={lit ? 'primary' : 'secondary'}
        size={dense ? 'sm' : undefined}
        onClick={onReset}
        isLoading={pending}
        loadingText="Resetting…"
        leftIcon={<RotateCcw className="h-4 w-4" strokeWidth={1.75} />}
        data-testid="estop-reset"
      >
        Reset E-stop
      </Button>
      {stop.reason && (
        <p className={cn(line, 'text-ink-primary')} data-testid="estop-recovery-reason">
          Reason: {stop.reason}.
        </p>
      )}
      <p className={line} data-testid="take-dock-estop-reset">
        {resetText(stop, headset)}
        {standUp ? ` ${STAND_UP_AGAIN}` : ''}
      </p>
      {error && (
        <p className={cn(line, 'font-medium text-signal-stopped')} role="alert" data-testid="estop-reset-error">
          {error}
        </p>
      )}
    </div>
  );
}
