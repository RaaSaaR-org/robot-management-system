/**
 * @file SessionEStopButton.tsx
 * @description The robot's E-STOP on the session page itself (TASK-410 D5):
 *              the assistant never has to leave the page to stop the robot.
 *              One press fires — an emergency stop never asks. Escape pressed
 *              twice within a second fires it too; a single Escape keeps its
 *              usual job (closing a dialog), and Escape while typing does not
 *              count, so an operator closing a field cannot drop the robot.
 *              TASK-426: it stands alone in the command bar's right zone, in
 *              the display face with its Escape-twice hint; below 640 px the
 *              zone is the bottom dock and the button grows to 52 px.
 *              TASK-453: the Teleop tab's keyboard section reuses it, with its
 *              own reason and source in the E-stop log.
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
  /** Why the E-stop log says it fired (default: the session page) */
  reason?: string;
  /** Who the E-stop log says fired it (default `session-page`) */
  triggeredBy?: string;
  /** The button's `data-testid` (default `session-estop`) */
  testId?: string;
  className?: string;
}

export function SessionEStopButton({
  robotId,
  robotName,
  hotkey = true,
  reason = 'E-STOP pressed on the data collection session page',
  triggeredBy = 'session-page',
  testId = 'session-estop',
  className,
}: SessionEStopButtonProps) {
  const [firing, setFiring] = useState(false);
  const lastEscape = useRef(Number.NEGATIVE_INFINITY);

  const fire = useCallback(async () => {
    setFiring(true);
    try {
      await triggerRobotEStop(robotId, { reason, triggeredBy });
      toast.success('Emergency stop sent', { description: robotName });
    } catch (err) {
      toast.error("Couldn't send emergency stop", { description: `${robotName}: ${errorMessage(err)}` });
    } finally {
      setFiring(false);
    }
  }, [robotId, robotName, reason, triggeredBy]);

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
      variant="danger"
      onClick={() => void fire()}
      isLoading={firing}
      loadingText="Stopping…"
      data-testid={testId}
      title="Emergency stop the robot (Escape twice)"
      aria-label={`Emergency stop ${robotName}`}
      leftIcon={<OctagonX className="h-[18px] w-[18px]" strokeWidth={1.75} />}
      className={cn(
        "h-11 gap-2.5 rounded-control bg-stop px-3.5 font-display text-[15px] font-bold tracking-[.06em] text-on-stop [font-variation-settings:'wdth'_112]",
        // Phones: the bottom dock's one control — taller, wider, no key hint.
        'max-sm:h-[52px] max-sm:min-w-[176px] max-sm:px-5',
        className,
      )}
    >
      E-STOP
      {!firing && (
        <kbd className="rounded-[5px] border border-on-stop/40 px-[5px] py-[3px] font-sans text-[11px] font-semibold leading-none tracking-[.02em] text-on-stop/85 max-sm:hidden">
          Esc Esc
        </kbd>
      )}
    </Button>
  );
}
