/**
 * @file SessionEStopButton.tsx
 * @description The robot's E-STOP on the session page itself (TASK-410 D5):
 *              the assistant never has to leave the page to stop the robot.
 *              One press fires — an emergency stop never asks. Escape pressed
 *              twice within a second fires it too; a single Escape keeps its
 *              usual job (closing a dialog), and Escape while typing does not
 *              count, so an operator closing a field cannot drop the robot.
 * @feature datacollection
 * @apiCalls safetyApi.triggerRobotEStop
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { OctagonX } from 'lucide-react';
import { Button, errorMessage, toast } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { triggerRobotEStop } from '../../../safety/api/safetyApi';
import { isTypingTarget } from '../../utils/hotkeys';

/** Two Escapes closer together than this fire the E-stop. */
export const ESTOP_DOUBLE_ESCAPE_MS = 1000;

export interface SessionEStopButtonProps {
  robotId: string;
  robotName: string;
  /** Bind the Escape-twice hotkey (default true) */
  hotkey?: boolean;
  className?: string;
}

export function SessionEStopButton({ robotId, robotName, hotkey = true, className }: SessionEStopButtonProps) {
  const [firing, setFiring] = useState(false);
  const lastEscape = useRef(Number.NEGATIVE_INFINITY);

  const fire = useCallback(async () => {
    setFiring(true);
    try {
      await triggerRobotEStop(robotId, { reason: 'E-STOP pressed on the data collection session page', triggeredBy: 'session-page' });
      toast.success('Emergency stop sent', { description: robotName });
    } catch (err) {
      toast.error("Couldn't send emergency stop", { description: `${robotName}: ${errorMessage(err)}` });
    } finally {
      setFiring(false);
    }
  }, [robotId, robotName]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.repeat) return;
      if (isTypingTarget(ev.target)) { lastEscape.current = Number.NEGATIVE_INFINITY; return; }
      const now = Date.now();
      if (now - lastEscape.current <= ESTOP_DOUBLE_ESCAPE_MS) {
        lastEscape.current = Number.NEGATIVE_INFINITY;
        void fire();
      } else {
        lastEscape.current = now;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey, fire]);

  return (
    <Button
      onClick={() => void fire()}
      isLoading={firing}
      loadingText="Stopping…"
      data-testid="session-estop"
      title="Emergency stop the robot (Escape twice)"
      aria-label={`Emergency stop ${robotName}`}
      leftIcon={<OctagonX className="h-4 w-4" strokeWidth={1.75} />}
      className={cn('bg-stop font-semibold tracking-[0.06em] text-on-stop hover:bg-stop/90', className)}
    >
      E-STOP
    </Button>
  );
}
