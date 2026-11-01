/**
 * @file useFreshOperator.ts
 * @description The operator's relayed state while it is fresh (TASK-414): the
 *              store keeps the last one, and this re-reads it twice a second,
 *              so a headset that went quiet turns into "no operator" after 2 s
 *              even though no event says so.
 * @feature datacollection
 */

import { useEffect, useState } from 'react';
import { useDataCollectionStore, selectOperatorFor } from '../store/datacollectionStore';
import type { OperatorSnapshot } from '../types/datacollection.types';

const RECHECK_MS = 500;

export function useFreshOperator(sessionId: string | undefined): OperatorSnapshot | null {
  const operator = useDataCollectionStore((s) => s.operator);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!operator) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), RECHECK_MS);
    return () => clearInterval(timer);
  }, [operator]);
  // A new state is fresh by definition; the tick only ages an old one.
  return selectOperatorFor(sessionId, Math.max(nowMs, operator?.receivedAt ?? 0))({ operator });
}
