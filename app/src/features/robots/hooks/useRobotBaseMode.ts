/**
 * @file useRobotBaseMode.ts
 * @description The robot's MEASURED locomotion mode, polled at 1 Hz while
 *              mounted, and the mode change (limp / stand / balance) posted
 *              under the bound control lease (TASK-398).
 * @feature robots
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  baseModeApi as defaultApi,
  type BaseModeApi,
  type BaseModeCommand,
  type BaseModeResult,
  type BaseModeStatus,
} from '../api/baseModeApi';

export interface UseRobotBaseModeOptions {
  api?: BaseModeApi;
  /** Poll interval in ms; default 1000. */
  pollMs?: number;
  /** False pauses polling (e.g. a page that does not show the control). */
  enabled?: boolean;
  /** Wall clock; `Date.now` by default. */
  now?: () => number;
}

export interface UseRobotBaseModeReturn {
  status: BaseModeStatus | null;
  /** Why the last read failed, or null. */
  readError: string | null;
  /** `Date.now()` of the last successful read. */
  readAt: number | null;
  /** When this console first saw the robot measured in stand, for the settle hint. */
  standSince: number | null;
  /** The mode being requested right now, or null. */
  pending: BaseModeCommand | null;
  /** The answer to the last request, kept until the next one. */
  lastResult: BaseModeResult | null;
  /** Post a change. `grant` is the bound lease, read at click time. */
  request(mode: BaseModeCommand, grant: { leaseId: string; generation: number } | null): Promise<BaseModeResult>;
  refresh(): Promise<void>;
}

export function useRobotBaseMode(robotId: string, options: UseRobotBaseModeOptions = {}): UseRobotBaseModeReturn {
  const api = options.api ?? defaultApi;
  const pollMs = options.pollMs ?? 1000;
  const enabled = options.enabled ?? true;
  const nowRef = useRef(options.now ?? (() => Date.now()));
  nowRef.current = options.now ?? (() => Date.now());

  const [status, setStatus] = useState<BaseModeStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [standSince, setStandSince] = useState<number | null>(null);
  const [pending, setPending] = useState<BaseModeCommand | null>(null);
  const [lastResult, setLastResult] = useState<BaseModeResult | null>(null);
  const inFlightRef = useRef(false);
  const robotRef = useRef(robotId);
  robotRef.current = robotId;

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const forRobot = robotId;
    try {
      const next = await api.getBaseMode(forRobot);
      if (robotRef.current !== forRobot) return;
      const at = nowRef.current();
      setStatus(next);
      setReadError(null);
      setReadAt(at);
      const mode = next.base?.mode;
      setStandSince((prev) => (mode === 'stand' ? prev ?? at : null));
    } catch (err) {
      if (robotRef.current !== forRobot) return;
      setReadError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
    }
  }, [api, robotId]);

  useEffect(() => {
    setStatus(null);
    setReadAt(null);
    setStandSince(null);
    setLastResult(null);
    if (!enabled) return undefined;
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [enabled, pollMs, refresh]);

  const request = useCallback(
    async (mode: BaseModeCommand, grant: { leaseId: string; generation: number } | null) => {
      if (!grant) {
        const refused: BaseModeResult = {
          ok: false, status: 0, code: 'lease_required', error: 'Take control first.',
        };
        setLastResult(refused);
        return refused;
      }
      setPending(mode);
      setLastResult(null);
      let result: BaseModeResult;
      try {
        result = await api.setBaseMode(robotId, mode, grant);
      } catch (err) {
        result = {
          ok: false, status: 0, code: 'network', error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        setPending(null);
      }
      setLastResult(result);
      void refresh();
      return result;
    },
    [api, robotId, refresh],
  );

  return { status, readError, readAt, standSince, pending, lastResult, request, refresh };
}
