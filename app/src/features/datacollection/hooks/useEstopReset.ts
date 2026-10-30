/**
 * @file useEstopReset.ts
 * @description The session page's Reset E-stop (TASK-431). It makes the same
 *              call as the VR window's reset (`safetyApi.resetRobotEStop`). The
 *              server forwards it to the robot agent's own
 *              `/safety/estop/reset`, which clears the agent's latch, Agent
 *              Mode's latch and the sidecar's latch. With nothing latched it
 *              clears a leftover `protective_stop` status. It never moves the
 *              robot: an E-stop damps it, and standing it up again is Set up's
 *              step 3. There is no confirm, as in the VR window: the button
 *              stays far from the E-STOP instead.
 * @feature datacollection
 * @apiCalls safetyApi.resetRobotEStop (POST /api/safety/robots/:id/estop/reset)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, toast } from '@/shared/components/ui';
import { resetRobotEStop } from '@/features/safety/api/safetyApi';
import { RESET_DONE } from '../utils/robotStop';

export interface UseEstopResetReturn {
  /** The reset request is in flight. */
  pending: boolean;
  /** Why the last reset failed, or null. */
  error: string | null;
  /** `Date.now()` of the last reset the robot accepted; null before one, or after `clear()`. */
  resetAt: number | null;
  reset(): Promise<boolean>;
  /** Forget the last reset (the robot balances again, or another stop came). */
  clear(): void;
}

/**
 * @param robotId - the session's robot; null while it is not known.
 * @param onReset - runs after the robot accepted the reset (refresh what the page reads).
 */
export function useEstopReset(robotId: string | null, onReset?: () => void): UseEstopResetReturn {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetAt, setResetAt] = useState<number | null>(null);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  // Another robot's reset says nothing about this one.
  useEffect(() => {
    setError(null);
    setResetAt(null);
  }, [robotId]);

  const reset = useCallback(async (): Promise<boolean> => {
    if (!robotId) return false;
    setPending(true);
    setError(null);
    try {
      await resetRobotEStop(robotId);
      setResetAt(Date.now());
      toast.success('E-stop reset', { description: RESET_DONE });
      onResetRef.current?.();
      return true;
    } catch (err) {
      setError(`Reset failed: ${errorMessage(err, 'unknown error')}. The robot is still stopped.`);
      return false;
    } finally {
      setPending(false);
    }
  }, [robotId]);

  const clear = useCallback(() => {
    setResetAt(null);
    setError(null);
  }, []);

  return { pending, error, resetAt, reset, clear };
}
