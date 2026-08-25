/**
 * @file useElapsedSince.ts
 * @description How long ago an instant was, re-computed on a tick.
 * @feature agentmode
 */

import { useEffect, useState } from 'react';

/**
 * Milliseconds since `startedAt`, re-computed every `tickMs`; null when there
 * is no usable instant.
 *
 * TIME PASSING IS NOT A STORE EVENT. A zustand selector only re-runs when the
 * store publishes, and the cases these counters exist for — a robot going
 * quiet, a planner that never answers — are precisely the ones where nothing
 * publishes. Anything that has to keep counting while nothing arrives needs its
 * own interval.
 *
 * Lifted out of `SelfHeader`'s `useSnapshotAge` when the Agent Mode rail needed
 * the same behaviour for its planning counter (TASK-202): two hand-rolled
 * copies of one ticker is how their clamping rules drift apart.
 *
 * @param startedAt ISO instant to measure from, or null.
 * @param tickMs    How often to re-render. Pick it for the label: an age
 *                  measured in minutes does not need a per-second tick, and a
 *                  "is this stuck?" counter does.
 */
export function useElapsedSince(startedAt: string | null, tickMs: number): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    // A new instant resets the clock immediately; the interval only keeps a
    // page nobody touches from claiming the value is younger than it is.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [startedAt, tickMs]);

  if (!startedAt) return null;
  const taken = new Date(startedAt).getTime();
  if (Number.isNaN(taken)) return null;
  // A robot's clock is not this browser's clock, so a stamp can arrive "from
  // the future". Clamp rather than render a negative or backwards-running
  // number — a counter that goes down is worse than no counter.
  return Math.max(0, now - taken);
}
