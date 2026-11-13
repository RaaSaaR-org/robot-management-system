/**
 * @file useSettledValue.ts
 * @description A value that follows its source at once when it changes now and then, and waits for
 *              the source to hold still when it changes in quick succession.
 * @feature training
 */

import { useEffect, useRef, useState } from 'react';

/**
 * The selection the heavy parts of a page should load for (TASK-492).
 *
 * A viewer walking down a list — a held arrow key, a run of quick clicks —
 * passes through many rows and wants one. Everything cheap (the highlight, the
 * numbers already in hand) follows `value`; everything that costs a request
 * follows what this returns:
 *
 * - a change that comes after `quietMs` without one is passed on at once, so
 *   a single click is never made to wait;
 * - a change that follows another one sooner is held until `quietMs` have
 *   passed without a further change, and only the last one is passed on;
 * - `null`/`undefined` — nothing selected — is passed on at once in both
 *   directions: there is nothing to wait for.
 */
export function useSettledValue<T>(value: T, quietMs: number): T {
  const [settled, setSettled] = useState(value);
  const lastChange = useRef(Number.NEGATIVE_INFINITY);
  const previous = useRef(value);
  // When the value now in `previous` may be passed on. Kept apart from the
  // timer so the effect can run twice for one change (StrictMode) and arm the
  // same wait again instead of losing it.
  const holdUntil = useRef(0);

  useEffect(() => {
    if (!Object.is(previous.current, value)) {
      const from = previous.current;
      previous.current = value;
      const now = performance.now();
      const quiet = now - lastChange.current >= quietMs;
      lastChange.current = now;
      holdUntil.current = quiet || value == null || from == null ? 0 : now + quietMs;
    }
    const wait = holdUntil.current - performance.now();
    if (wait <= 0) {
      setSettled(value);
      return;
    }
    const timer = setTimeout(() => setSettled(value), wait);
    return () => clearTimeout(timer);
  }, [value, quietMs]);

  // Into and out of "nothing selected" there is not even a render to wait for.
  return value == null || settled == null ? value : settled;
}
