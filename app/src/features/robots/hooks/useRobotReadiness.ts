/**
 * @file useRobotReadiness.ts
 * @description One robot's readiness (TASK-411): the merged supervisor + agent
 *              snapshot pushed as `robot:readiness` over the app's robot socket,
 *              a GET every 2 s while that socket is down, and a GET every 20 s
 *              while it is up — the GET is what keeps the server watching the
 *              robot (its watch window is 30 s). Also the robot-side actions:
 *              Start (always read-only), Stop, the sidecar mode switch,
 *              adopt / leave of a foreign process, and bringing the LAN up.
 *              TASK-430: Restart — Stop, wait until the supervisor reports
 *              stopped, then Start read-only — from the same calls.
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

export type ReadinessAction = 'start' | 'stop' | 'restart' | 'sidecar-mode' | 'adopt' | 'leave' | 'lan-up';

/**
 * How long a restart waits for the supervisor to report `stopped`. Its Stop
 * answers at once and works in the background: the disarm (5 s at most), the
 * agent (13 s), then the sidecar and the bridge.
 */
export const RESTART_STOP_WAIT_MS = 60_000;
export const RESTART_POLL_MS = 500;

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
  /** How long a restart waits for `stopped` (tests). */
  restartWaitMs?: number;
  restartPollMs?: number;
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
    /**
     * TASK-430: Stop, wait until the supervisor reports `stopped`, then Start
     * read-only. A refused stop, a stop that ends in `error` or the wait
     * running out never starts again.
     */
    restart(): Promise<BringupResult>;
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
  const restartWaitMs = options.restartWaitMs ?? RESTART_STOP_WAIT_MS;
  const restartPollMs = options.restartPollMs ?? RESTART_POLL_MS;

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

  /** Stop, wait for `stopped`, Start. Its refusals say which part refused. */
  const restartSequence = useCallback(async (): Promise<BringupResult> => {
    const refused = (code: string, error: string): BringupResult => ({ ok: false, status: 0, code, error });
    const stopped = await api.stopBringup(robotId);
    if (!stopped.ok) return { ...stopped, error: `Stop was refused: ${stopped.error}` };
    const deadline = Date.now() + restartWaitMs;
    for (;;) {
      const snap = await api.getReadiness(robotId).catch(() => null);
      if (snap && typeof snap === 'object') useReadinessStore.getState().put({ ...snap, robotId: snap.robotId ?? robotId });
      const overall = snap?.bringup?.overall ?? null;
      if (overall === 'stopped') break;
      if (overall === 'error') {
        return refused('stop_failed', 'The robot side did not stop cleanly, so it was not started again. See the logs.');
      }
      if (Date.now() >= deadline) {
        return refused('stop_timeout', `The robot side was still not stopped after ${Math.round(restartWaitMs / 1000)} s, so it was not started again.`);
      }
      await new Promise((r) => setTimeout(r, restartPollMs));
    }
    const started = await api.startBringup(robotId, 'read_only');
    return started.ok ? started : { ...started, error: `It stopped, but Start was refused: ${started.error}` };
  }, [api, robotId, restartWaitMs, restartPollMs]);

  const actions: UseRobotReadinessReturn['actions'] = {
    start: () => run({ action: 'start' }, () => api.startBringup(robotId, 'read_only')),
    stop: () => run({ action: 'stop' }, () => api.stopBringup(robotId)),
    restart: () => run({ action: 'restart' }, restartSequence),
    switchMode: (mode, grant) => run({ action: 'sidecar-mode' }, () => api.setSidecarMode(robotId, mode, grant)),
    adopt: (step) => run({ action: 'adopt', step }, () => api.adoptStep(robotId, step)),
    leave: (step) => run({ action: 'leave', step }, () => api.leaveStep(robotId, step)),
    lanUp: () => run({ action: 'lan-up' }, () => api.lanUp(robotId)),
  };

  const readiness = entry?.readiness ?? null;
  const stale = !entry || now - entry.receivedAt > staleMs;

  return { readiness, stale, readError, actions, pending, lastError, refresh };
}
