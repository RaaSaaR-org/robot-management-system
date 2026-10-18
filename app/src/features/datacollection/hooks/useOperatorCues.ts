/**
 * @file useOperatorCues.ts
 * @description Plays the assistant's operator cues (TASK-414) — see
 *              `operatorCues.ts`. Looks at the store four times a second, so a
 *              block that lasts past one second sounds even when no new state
 *              arrives, and a state that goes stale counts as no operator.
 * @feature datacollection
 */

import { useEffect, useRef } from 'react';
import { playCue } from '@/shared/utils/sessionCues';
import { useDataCollectionStore, selectOperatorFor } from '../store/datacollectionStore';
import { INITIAL_OPERATOR_CUE_MEMORY, operatorCues, type OperatorCueMemory } from '../utils/operatorCues';

const LOOK_MS = 250;

export function useOperatorCues(sessionId: string | undefined, capturing: boolean, enabled: boolean): void {
  const memory = useRef<OperatorCueMemory>(INITIAL_OPERATOR_CUE_MEMORY);
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  useEffect(() => {
    memory.current = INITIAL_OPERATOR_CUE_MEMORY;
    if (!enabled || !sessionId) return undefined;
    const look = () => {
      const now = Date.now();
      const op = selectOperatorFor(sessionId, now)(useDataCollectionStore.getState());
      const next = operatorCues(memory.current, op?.state ?? null, capturingRef.current, now);
      memory.current = next.memory;
      next.cues.forEach((cue) => playCue(cue));
    };
    const timer = setInterval(look, LOOK_MS);
    return () => clearInterval(timer);
  }, [sessionId, enabled]);
}
