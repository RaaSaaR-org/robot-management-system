/**
 * @file liveState.ts
 * @description One live state per teleoperation session (TASK-408), built from
 *              whatever recorder holds the session's takes — the robot agent's,
 *              the server's SimFrameRecorder, or the ledger of a session whose
 *              frames a client posts. Every client renders the same object, so
 *              the operator in the headset and the assistant at the desk see
 *              the same take, the same counters and the same timer. Pure.
 * @feature datacollection
 */

import type {
  EpisodeConflictCode,
  EpisodeStopReason,
  LiveState,
  QuickCheck,
  RecordingProgress,
  TeleoperationStatus,
} from '../../types/teleoperation.types.js';
import type { AgentEpisodeReport, AgentRecordingStatus } from '../AgentRecordingService.js';
import type { TakeRecord } from './takeLedger.js';

/** Server path of a take's thumbnail. Only takes the robot said have one get it. */
export function thumbnailPath(sessionId: string, take: number): string {
  return `/api/teleoperation/sessions/${encodeURIComponent(sessionId)}/episodes/${take}/thumbnail`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The robot's report on one take, as the quick check every client shows. */
export function quickCheckFromReport(
  sessionId: string,
  report: AgentEpisodeReport,
  stopReason: EpisodeStopReason | null
): QuickCheck {
  return {
    take: report.episodeIndex,
    frames: report.frames,
    durationS: report.durationS,
    droppedFrames: report.dropped,
    fpsActual: report.fpsActual,
    jointsMoved: report.jointsMoved ?? [],
    groupsMoved: report.groupsMoved ?? [],
    warnings: report.warnings ?? [],
    thumbnailUrl: report.thumbnail ? thumbnailPath(sessionId, report.episodeIndex) : null,
    stopReason,
    discarded: report.discarded === true,
  };
}

/**
 * The quick check of a take the server recorded itself. It has no camera and
 * no per-joint ranges, so it says only what it can count.
 */
export function quickCheckFromTake(record: TakeRecord): QuickCheck {
  const durationS =
    record.endedAtMs !== null ? round2(Math.max(0, record.endedAtMs - record.startedAtMs) / 1000) : 0;
  return {
    take: record.take,
    frames: record.frames,
    durationS,
    droppedFrames: 0,
    fpsActual: durationS > 0 ? round2(record.frames / durationS) : 0,
    jointsMoved: [],
    groupsMoved: [],
    warnings: record.frames === 0 && !record.discarded ? ['no_frames'] : [],
    thumbnailUrl: null,
    stopReason: record.stopReason,
    discarded: record.discarded,
  };
}

export interface LiveBase {
  sessionId: string;
  status: TeleoperationStatus;
  /** The session's target rate (an integer). */
  fpsTarget: number;
  /** Per-take auto-stop the session asked for, or null. */
  autoStopS: number | null;
  nowMs: number;
}

/** A session with no live recorder (not started, ended, or a sidecar session). */
export function idleLive(base: LiveBase, counts?: { kept: number; discarded: number; take: number | null }): LiveState {
  return {
    sessionId: base.sessionId,
    status: base.status,
    phase: null,
    take: counts?.take ?? null,
    takeStartedAt: null,
    takeElapsedS: null,
    takeFrames: 0,
    totalFrames: 0,
    kept: counts?.kept ?? 0,
    discarded: counts?.discarded ?? 0,
    fpsTarget: base.fpsTarget,
    fpsActual: null,
    degraded: false,
    lastDropReason: null,
    elapsedS: null,
    autoStopS: base.autoStopS,
    lastTake: null,
    at: new Date(base.nowMs).toISOString(),
  };
}

/**
 * Live state of an agent-recorded session.
 *
 * `takeStartedAtMs` is the SERVER's stamp of when the take began (D5): the
 * agent's own `episodeStartedAtMs` is on the robot's clock, which on a real
 * robot is not this server's. When the caller has no stamp — the take was
 * begun before this process started — it is derived from the agent's elapsed
 * seconds on this server's clock.
 */
export function liveFromAgent(
  base: LiveBase,
  agent: AgentRecordingStatus,
  takeStartedAtMs: number | null
): LiveState {
  const phase: LiveState['phase'] = agent.phase ?? (agent.recording ? 'capturing' : null);
  const capturing = phase === 'capturing';
  const episodes = agent.episodes ?? [];
  const finished = capturing
    ? episodes.filter((e) => e.episodeIndex !== agent.episodeIndex)
    : episodes;
  const take = capturing ? agent.episodeIndex : (episodes[episodes.length - 1]?.episodeIndex ?? null);

  let startedAtMs: number | null = null;
  if (capturing) {
    startedAtMs =
      takeStartedAtMs ??
      (typeof agent.episodeElapsedS === 'number' ? base.nowMs - agent.episodeElapsedS * 1000 : null);
  }

  const last = finished[finished.length - 1] ?? null;
  const lastStop = agent.lastStop ?? null;
  const lastReason = last && lastStop && lastStop.episodeIndex === last.episodeIndex ? lastStop.reason : null;

  return {
    sessionId: base.sessionId,
    status: base.status,
    phase,
    take,
    takeStartedAt: startedAtMs !== null ? new Date(startedAtMs).toISOString() : null,
    takeElapsedS: startedAtMs !== null ? round2(Math.max(0, base.nowMs - startedAtMs) / 1000) : null,
    takeFrames: capturing ? agent.frames : 0,
    totalFrames: agent.totalFrames,
    kept: finished.filter((e) => e.discarded !== true && e.frames > 0).length,
    discarded: episodes.filter((e) => e.discarded === true).length,
    fpsTarget: base.fpsTarget,
    fpsActual: agent.fpsActual,
    degraded: agent.degraded,
    lastDropReason: agent.lastDropReason,
    elapsedS: agent.elapsedS ?? null,
    autoStopS: agent.autoStopS ?? base.autoStopS,
    lastTake: last ? quickCheckFromReport(base.sessionId, last, lastReason) : null,
    at: new Date(base.nowMs).toISOString(),
  };
}

export interface LedgerSnapshot {
  phase: 'between' | 'capturing';
  takes: TakeRecord[];
  totalFrames: number;
  fpsActual: number | null;
  degraded: boolean;
  elapsedS: number | null;
}

/** Live state of a session whose takes this server keeps (SimFrameRecorder or client frames). */
export function liveFromLedger(base: LiveBase, snap: LedgerSnapshot): LiveState {
  const capturing = snap.phase === 'capturing';
  const open = capturing ? snap.takes[snap.takes.length - 1] ?? null : null;
  const finished = capturing ? snap.takes.slice(0, -1) : snap.takes;
  const last = finished[finished.length - 1] ?? null;
  const latest = snap.takes[snap.takes.length - 1] ?? null;
  return {
    sessionId: base.sessionId,
    status: base.status,
    phase: snap.phase,
    take: latest?.take ?? null,
    takeStartedAt: open ? new Date(open.startedAtMs).toISOString() : null,
    takeElapsedS: open ? round2(Math.max(0, base.nowMs - open.startedAtMs) / 1000) : null,
    takeFrames: open?.frames ?? 0,
    totalFrames: snap.totalFrames,
    kept: finished.filter((t) => !t.discarded && t.frames > 0).length,
    discarded: finished.filter((t) => t.discarded).length,
    fpsTarget: base.fpsTarget,
    fpsActual: snap.fpsActual,
    degraded: snap.degraded,
    lastDropReason: null,
    elapsedS: snap.elapsedS,
    autoStopS: base.autoStopS,
    lastTake: last ? quickCheckFromTake(last) : null,
    at: new Date(base.nowMs).toISOString(),
  };
}

/**
 * The old `session:progress` payload, built from the live state so it is
 * always COMPLETE. A partial one — `{currentEpisode, running}` after a next —
 * replaced the other client's counters wholesale and wiped them for up to a
 * second; every field is now always present.
 */
export function progressFromLive(live: LiveState): Required<
  Pick<RecordingProgress, 'frameCount' | 'currentEpisode' | 'episodesDone' | 'fpsActual' | 'running' | 'degraded'>
> &
  Pick<RecordingProgress, 'elapsedS'> {
  return {
    frameCount: live.totalFrames,
    currentEpisode: live.take ?? 0,
    episodesDone: live.kept,
    fpsActual: live.fpsActual ?? 0,
    running: live.phase === 'capturing',
    degraded: live.degraded,
    ...(live.elapsedS !== null ? { elapsedS: live.elapsedS } : {}),
  };
}

/** The four episode actions a client can take (TASK-408). */
export type EpisodeOp = 'start' | 'stop' | 'next' | 'discard-last';

/**
 * Whether `op` may run against `live`, given the take the client believes is
 * live (`expectedTake`; `undefined` = do not check). Null when it may; else the
 * 409 code. The phase is checked first because it says more ("a take is
 * already running") than "your view is stale".
 */
export function guardEpisodeAction(
  op: EpisodeOp,
  live: LiveState,
  expectedTake: number | null | undefined
): EpisodeConflictCode | null {
  if (op === 'start' && live.phase === 'capturing') return 'already_capturing';
  if (op === 'stop' && live.phase !== 'capturing') return 'not_capturing';
  if (expectedTake !== undefined && expectedTake !== live.take) return 'episode_conflict';
  if (op === 'discard-last') {
    if (live.take === null) return 'no_take';
    if (live.phase !== 'capturing' && live.lastTake?.take === live.take && live.lastTake.discarded) {
      return 'already_discarded';
    }
  }
  return null;
}
