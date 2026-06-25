/**
 * @file useScanSession.ts
 * @description Drives a digital-twin scan session in the app.
 *
 * The SERVER now owns the authoritative capture: on Start we POST a
 * `/scan-sessions` (which kicks the agent scan + the server capture loop), and
 * we subscribe to `session:progress` for server-authoritative frame/progress
 * counts. Meanwhile the app keeps the live client-accumulated preview cloud —
 * it reuses the existing point-cloud stream, lifts each pose-stamped frame from
 * `base_link` into the shared world frame, and voxel-dedups it into one growing
 * world cloud so the room "fills in" live (and the sim demo still looks great
 * even if the server build never lands). On Stop we POST `/scan-sessions/:id/stop`.
 *
 * The heavy accumulated cloud is held in component state/refs here — never in an
 * immer store (immer can't draft a Float32Array).
 * @feature digitaltwin
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePointCloudStream } from '@/features/robots/hooks/usePointCloudStream';
import { robotsApi } from '@/features/robots/api/robotsApi';
import type { PointCloudFrame } from '@/features/robots/types/robots.types';
import { twinApi } from '../api/twinApi';
import { useTwinEvents } from './useTwinEvents';
import type { AccumulatedCloud, ScanStatus, TwinPose } from '../types/twin.types';

/** Voxel size (m) for accumulation dedup — room scale. */
const ACCUM_VOXEL = 0.1;
/** Safety cap on accumulated points (one BufferGeometry, room scale). */
const MAX_POINTS = 300_000;
/** Rough voxel target for the coverage estimate (~full room at ACCUM_VOXEL). */
const COVERAGE_TARGET_VOXELS = 16000;
/** Min world translation (m) before appending a new path node. */
const PATH_MIN_STEP = 0.15;

/**
 * Auto-sweep waypoints (local offsets, meters) — a loop inside the room so the
 * robot walks the space and the map fills in with one click. The robot is
 * anchored at the scan origin, so these are added to the start location.
 */
const SWEEP_OFFSETS: Array<[number, number]> = [
  [3.5, 2.5], [-3.5, 2.5], [-3.5, -2.5], [3.5, -2.5], [0, 0],
];
const SWEEP_LEG_MS = 4500;

interface Accumulator {
  positions: number[];
  intensities: number[];
  seen: Set<string>;
}

function emptyAccumulator(): Accumulator {
  return { positions: [], intensities: [], seen: new Set() };
}

/** Lift a base_link point into the world frame (yaw radians, about +z). */
function baseToWorld(px: number, py: number, pz: number, pose: TwinPose): [number, number, number] {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  return [pose.x + px * c - py * s, pose.y + px * s + py * c, pz];
}

export interface UseScanSessionReturn {
  status: ScanStatus;
  /** Server scan-session id (the system-of-record session). */
  sessionId: string | null;
  /** Server-authoritative frame count (from session:progress), falls back to the client count. */
  framesCaptured: number;
  coveragePct: number;
  /** Server build progress 0..100 (during processing); 0 while recording. */
  serverProgress: number;
  /** Server pipeline stage during processing, if any. */
  serverStage: string | null;
  /** Accumulated world cloud preview (null until the first frame). */
  cloud: AccumulatedCloud | null;
  /** True once `cloud` is the authoritative server-built cloud (not the preview). */
  isAuthoritative: boolean;
  /** Walked path in world XY + yaw. */
  path: TwinPose[];
  /** Latest robot world pose. */
  currentPose: TwinPose | null;
  isConnected: boolean;
  error: string | null;
  /** Start a sweep. Pass the robot's world location to auto-walk a fill-in loop. */
  start: (anchor?: { x: number; y: number }) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
}

export function useScanSession(
  robotId: string,
  twinId: string,
  /** When opening an already-built twin, load its authoritative cloud on mount. */
  initialBuilt = false,
): UseScanSessionReturn {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clientFrames, setClientFrames] = useState(0);
  const [serverFrames, setServerFrames] = useState(0);
  const [coveragePct, setCoveragePct] = useState(0);
  const [serverProgress, setServerProgress] = useState(0);
  const [serverStage, setServerStage] = useState<string | null>(null);
  const [cloud, setCloud] = useState<AccumulatedCloud | null>(null);
  const [isAuthoritative, setIsAuthoritative] = useState(false);
  const [path, setPath] = useState<TwinPose[]>([]);
  const [currentPose, setCurrentPose] = useState<TwinPose | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accRef = useRef<Accumulator>(emptyAccumulator());
  const sessionIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef<number>(-1);
  const lastPathRef = useRef<TwinPose | null>(null);
  const sweepTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearSweep = useCallback(() => {
    sweepTimers.current.forEach(clearTimeout);
    sweepTimers.current = [];
  }, []);

  // Reuse the existing point-cloud stream; only active while scanning.
  const { frame, isConnected } = usePointCloudStream(robotId, {
    enabled: status === 'scanning',
    updateInterval: 700,
  });

  const ingest = useCallback((f: PointCloudFrame) => {
    const pose = f.pose;
    if (!pose) return;
    const acc = accRef.current;
    const src = f.positions instanceof Float32Array ? f.positions : new Float32Array(f.positions);
    const inten = f.intensities instanceof Float32Array ? f.intensities : new Float32Array(f.intensities);
    const n = f.pointCount;

    for (let i = 0; i < n; i++) {
      if (acc.positions.length / 3 >= MAX_POINTS) break;
      const [wx, wy, wz] = baseToWorld(src[i * 3], src[i * 3 + 1], src[i * 3 + 2], pose);
      const key = `${Math.floor(wx / ACCUM_VOXEL)},${Math.floor(wy / ACCUM_VOXEL)},${Math.floor(wz / ACCUM_VOXEL)}`;
      if (acc.seen.has(key)) continue;
      acc.seen.add(key);
      acc.positions.push(wx, wy, wz);
      acc.intensities.push(inten[i] ?? 0);
    }

    setCloud({
      positions: new Float32Array(acc.positions),
      intensities: new Float32Array(acc.intensities),
      pointCount: acc.positions.length / 3,
    });
    setCoveragePct(Math.min(100, Math.round((acc.seen.size / COVERAGE_TARGET_VOXELS) * 100)));
    setClientFrames((c) => c + 1);

    const cur: TwinPose = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw };
    setCurrentPose(cur);
    const last = lastPathRef.current;
    if (!last || Math.hypot(cur.x - last.x, cur.y - last.y) >= PATH_MIN_STEP) {
      lastPathRef.current = cur;
      setPath((p) => [...p, cur]);
    }
  }, []);

  // Accumulate each new pose-stamped frame for our session.
  useEffect(() => {
    if (status !== 'scanning' || !frame || !frame.pose) return;
    if (frame.scanSessionId && sessionIdRef.current && frame.scanSessionId !== sessionIdRef.current) return;
    if (frame.sequence === lastSeqRef.current) return;
    lastSeqRef.current = frame.sequence;
    ingest(frame);
  }, [frame, status, ingest]);

  /** Fetch + swap in the authoritative server-built cloud. Degrades gracefully. */
  const swapToAuthoritative = useCallback(async () => {
    try {
      const buffer = await twinApi.getTwinCloud(twinId);
      // Lazy import to keep the parser out of the initial chunk.
      const { parsePcdBinary } = await import('@/features/robots/utils/pointcloud');
      const parsed = parsePcdBinary(buffer);
      if (parsed.pointCount > 0) {
        setCloud({
          positions: parsed.positions,
          intensities: parsed.intensities,
          pointCount: parsed.pointCount,
        });
        setIsAuthoritative(true);
      }
    } catch {
      // Artifact not reachable yet (or no S3) — keep showing the live preview.
    }
  }, [twinId]);

  // Opening an already-built twin (status 'ready'): load its authoritative cloud
  // once on mount. No twin:ready event fires for an existing build, so without
  // this the backdrop would be empty until a re-scan.
  useEffect(() => {
    if (initialBuilt) void swapToAuthoritative();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBuilt, twinId]);

  // Subscribe to server-authoritative session/twin events for this twin.
  useTwinEvents({
    twinId,
    onSessionProgress: (e) => {
      if (sessionIdRef.current && e.sessionId !== sessionIdRef.current) return;
      setServerFrames(e.frameCount);
      setServerProgress(e.progress);
      setServerStage(e.stage ?? null);
      if (e.status === 'processing') setStatus('finalizing');
    },
    onTwinReady: (e) => {
      if (sessionIdRef.current && e.sessionId !== sessionIdRef.current) return;
      setServerProgress(100);
      setServerStage(null);
      setStatus('done');
      void swapToAuthoritative();
    },
    onTwinFailed: (e) => {
      if (sessionIdRef.current && e.sessionId !== sessionIdRef.current) return;
      setError(e.error || 'Twin build failed');
      setStatus('error');
    },
  });

  const reset = useCallback(() => {
    clearSweep();
    accRef.current = emptyAccumulator();
    sessionIdRef.current = null;
    lastSeqRef.current = -1;
    lastPathRef.current = null;
    setStatus('idle');
    setSessionId(null);
    setClientFrames(0);
    setServerFrames(0);
    setCoveragePct(0);
    setServerProgress(0);
    setServerStage(null);
    setCloud(null);
    setIsAuthoritative(false);
    setPath([]);
    setCurrentPose(null);
    setError(null);
  }, [clearSweep]);

  const start = useCallback(
    async (anchor?: { x: number; y: number }) => {
      try {
        reset();
        // Server drives the authoritative capture; this also kicks the agent scan.
        const session = await twinApi.createSession({ robotId, twinId });
        sessionIdRef.current = session.id;
        setSessionId(session.id);
        setStatus('scanning');

        // One-click auto-sweep: walk a loop inside the room so it fills in.
        if (anchor) {
          SWEEP_OFFSETS.forEach(([ox, oy], i) => {
            const t = setTimeout(() => {
              void robotsApi
                .sendCommand(robotId, { type: 'move', payload: { destination: { x: anchor.x + ox, y: anchor.y + oy } } })
                .catch(() => {});
            }, i * SWEEP_LEG_MS);
            sweepTimers.current.push(t);
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to start scan');
        setStatus('error');
      }
    },
    [robotId, twinId, reset],
  );

  const stop = useCallback(async (): Promise<void> => {
    clearSweep();
    setStatus('finalizing');
    try {
      const id = sessionIdRef.current;
      if (id) {
        await twinApi.stopSession(id);
      } else {
        // No server session (degraded) — fall back to the agent stop proxy.
        await twinApi.agentStopScan(robotId).catch(() => {});
      }
      // Stay in 'finalizing' until a twin:ready event flips us to 'done'. If the
      // server never builds (sim/degraded), surface the captured preview anyway.
      setTimeout(() => {
        setStatus((s) => (s === 'finalizing' ? 'done' : s));
      }, 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop scan');
      setStatus('error');
    }
  }, [robotId, clearSweep]);

  const framesCaptured = serverFrames > 0 ? serverFrames : clientFrames;

  return useMemo(
    () => ({
      status, sessionId, framesCaptured, coveragePct, serverProgress, serverStage,
      cloud, isAuthoritative, path, currentPose, isConnected, error, start, stop, reset,
    }),
    [status, sessionId, framesCaptured, coveragePct, serverProgress, serverStage,
     cloud, isAuthoritative, path, currentPose, isConnected, error, start, stop, reset],
  );
}
