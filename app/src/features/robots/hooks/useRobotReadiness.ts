/**
 * @file useRobotReadiness.ts
 * @description One robot's readiness (TASK-411): the merged supervisor + agent
 *              snapshot pushed as `robot:readiness` over the app's robot socket,
 *              a GET every 2 s while that socket is down, and a GET every 20 s
 *              while it is up — the GET is what keeps the server watching the
 *              robot (its watch window is 30 s). Also the robot-side actions:
 *              Start (always read-only), Stop, the sidecar mode switch,
 *              adopt / leave of a foreign process, and bringing the LAN up.
 * @feature robots
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readinessApi as defaultApi,
  type BringupResult,
  type BringupStepId,
  type ReadinessApi,
  type RobotReadiness,
  type SidecarMode,
} from '../api/readinessApi';
import { useReadinessStore } from '../store/readinessStore';

export const READINESS_FALLBACK_POLL_MS = 2_000;
export const READINESS_WATCH_REFRESH_MS = 20_000;
/** The server emits at least every 5 s while watched; twice that and a bit is stale. */
export const READINESS_STALE_MS = 12_000;

export type ReadinessAction = 'start' | 'stop' | 'sidecar-mode' | 'adopt' | 'leave' | 'lan-up';

export interface ReadinessPending {
  action: ReadinessAction;
  step?: BringupStepId;
}

export interface ReadinessActionError {
  action: ReadinessAction;
  code: string;
  error: string;
}

export interface UseRobotReadinessOptions {
  api?: Pick<ReadinessApi, 'getReadiness' | 'startBringup' | 'stopBringup' | 'setSidecarMode' | 'adoptStep' | 'leaveStep' | 'lanUp'>;
  pollMs?: number;
  watchRefreshMs?: number;
  staleMs?: number;
  /** False stops all reads (a view that is not shown). */
  enabled?: boolean;
}

export interface UseRobotReadinessReturn {
  readiness: RobotReadiness | null;
  /** No snapshot yet, or the last one is older than `staleMs`. */
  stale: boolean;
  /** Why the last GET failed, or null. */
  readError: string | null;
  actions: {
    /** Start the robot side read-only. Never arm_sdk from here (D2). */
    start(): Promise<BringupResult>;
    stop(): Promise<BringupResult>;
    switchMode(mode: SidecarMode, grant: { leaseId: string; generation: number } | null): Promise<BringupResult>;
    adopt(step: BringupStepId): Promise<BringupResult>;
    leave(step: BringupStepId): Promise<BringupResult>;
    lanUp(): Promise<BringupResult>;
  };
  pending: ReadinessPending | null;
  lastError: ReadinessActionError | null;
  refresh(): Promise<void>;
}

export function useRobotReadiness(robotId: string, options: UseRobotReadinessOptions = {}): UseRobotReadinessReturn {
  const api = options.api ?? defaultApi;
  const pollMs = options.pollMs ?? READINESS_FALLBACK_POLL_MS;
  const watchRefreshMs = options.watchRefreshMs ?? READINESS_WATCH_REFRESH_MS;
  const staleMs = options.staleMs ?? READINESS_STALE_MS;
  const enabled = options.enabled ?? true;

  const entry = useReadinessStore((s) => s.byRobot[robotId]);
  const socketOpen = useReadinessStore((s) => s.socketOpen);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadinessPending | null>(null);
  const [lastError, setLastError] = useState<ReadinessActionError | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef(false);
  const robotRef = useRef(robotId);
  robotRef.current = robotId;

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const forRobot = robotId;
    try {
      const next = await api.getReadiness(forRobot);
      if (robotRef.current !== forRobot || !next || typeof next !== 'object') return;
      useReadinessStore.getState().put({ ...next, robotId: next.robotId ?? forRobot });
      setReadError(null);
    } catch (err) {
      if (robotRef.current !== forRobot) return;
      setReadError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
    }
  }, [api, robotId]);

  // The GET doubles as the watch refresh: fast while the socket is down, slow
  // while it pushes.
  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    const timer = setInterval(() => void refresh(), socketOpen ? watchRefreshMs : pollMs);
    return () => clearInterval(timer);
  }, [enabled, socketOpen, pollMs, watchRefreshMs, refresh]);

  // Re-render for staleness.
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  const run = useCallback(
    async (p: ReadinessPending, call: () => Promise<BringupResult>): Promise<BringupResult> => {
      setPending(p);
      setLastError(null);
      let result: BringupResult;
      try {
        result = await call();
      } catch (err) {
        result = { ok: false, status: 0, code: 'network', error: err instanceof Error ? err.message : String(err) };
      }
      setPending((cur) => (cur === p ? null : cur));
      if (!result.ok) setLastError({ action: p.action, code: result.code, error: result.error });
      void refresh();
      return result;
    },
    [refresh],
  );

  const actions: UseRobotReadinessReturn['actions'] = {
    start: () => run({ action: 'start' }, () => api.startBringup(robotId, 'read_only')),
    stop: () => run({ action: 'stop' }, () => api.stopBringup(robotId)),
    switchMode: (mode, grant) => run({ action: 'sidecar-mode' }, () => api.setSidecarMode(robotId, mode, grant)),
    adopt: (step) => run({ action: 'adopt', step }, () => api.adoptStep(robotId, step)),
    leave: (step) => run({ action: 'leave', step }, () => api.leaveStep(robotId, step)),
    lanUp: () => run({ action: 'lan-up' }, () => api.lanUp(robotId)),
  };

  const readiness = entry?.readiness ?? null;
  const stale = !entry || now - entry.receivedAt > staleMs;

  return { readiness, stale, readError, actions, pending, lastError, refresh };
}
