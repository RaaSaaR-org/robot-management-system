/**
 * @file DigitalTwinService.ts
 * @description Sidecar build-job orchestrator for digital twins (TASK-170
 *              Phase 3). A TrainingOrchestrator clone operating on a
 *              ScanSession-as-job: the sidecar claims a 'processing' session,
 *              builds the twin (download → merge → occupancy → mesh → roadmap),
 *              reports progress/heartbeats, and writes artifacts back onto the
 *              linked DigitalTwin. Mirrors the heartbeat + stale-reaping
 *              semantics of TrainingOrchestrator.
 * @feature digitaltwin
 */

import { EventEmitter } from 'events';
import {
  scanSessionRepository,
  digitalTwinRepository,
  sensorScanRepository,
  simSceneRepository,
} from '../repositories/index.js';
import { sensorScanService } from './SensorScanService.js';
import { twinToDTO } from './twinDto.js';
import type {
  TwinBuildJob,
  TwinBuildJobFrame,
  TwinWorkerProgressRequest,
  TwinWorkerCompleteRequest,
  TwinWorkerFailedRequest,
  TwinWorkerHeartbeatRequest,
  DigitalTwinRecord,
  DigitalTwinDTO,
  DigitalTwinEvent,
  DigitalTwinEventCallback,
  ScanSessionRecord,
} from '../types/twin.types.js';

// A worker's heartbeat is "fresh" within this window; a session claimed by a
// worker that hasn't heartbeated in this long is reclaimable. Mirrors the
// generous 5-minute training-job threshold.
const HEARTBEAT_FRESH_MS = 5 * 60 * 1000;
// On boot, sessions stuck in 'processing' past this threshold are failed.
const STALE_RUNNING_MS = 5 * 60 * 1000;
// Periodic reaper cadence: at runtime a sidecar can die mid-build, leaving a
// 'processing' session with a stale heartbeat that the boot reaper won't catch
// until the next restart. Sweep for those on this interval.
const REAPER_INTERVAL_MS = 5 * 60 * 1000;

export class DigitalTwinService extends EventEmitter {
  private static instance: DigitalTwinService;
  private initialized = false;
  private reaperInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    super();
  }

  static getInstance(): DigitalTwinService {
    if (!DigitalTwinService.instance) {
      DigitalTwinService.instance = new DigitalTwinService();
    }
    return DigitalTwinService.instance;
  }

  /**
   * Boot-time init: reap orphaned sessions from a prior run — both build jobs
   * stuck in 'processing' (stale heartbeat) and sweeps stuck in 'recording'
   * (their in-memory capture loop did not survive the restart) — then start the
   * periodic reaper for sidecars that die mid-build at runtime.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const reapedProcessing = await this.reapStaleRunningJobs();
      const reapedRecording = await this.reapOrphanedRecordingSessions();
      const total = reapedProcessing + reapedRecording;
      if (total > 0) {
        console.log(
          `[DigitalTwinService] Reaped ${total} orphaned session(s) on boot ` +
            `(${reapedProcessing} stale build, ${reapedRecording} interrupted recording)`,
        );
      }
    } catch (err) {
      console.error('[DigitalTwinService] Failed to reap orphaned sessions:', err);
    }
    this.startReaper();
    this.initialized = true;
    console.log('[DigitalTwinService] Initialized');
  }

  /** Whether to prune raw per-frame scans after a build completes (default on;
   *  set TWIN_PRUNE_RAW_FRAMES=false to keep them for debugging). Read per-call
   *  so the policy can be toggled without a restart. */
  private shouldPruneFrames(): boolean {
    return process.env.TWIN_PRUNE_RAW_FRAMES !== 'false';
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ==========================================================================
  // JOB LIFECYCLE — CLAIM
  // ==========================================================================

  /**
   * Claim the next pending build job for a sidecar worker. Picks the oldest
   * 'processing' ScanSession with no fresh heartbeat, stamps it with the
   * worker id + heartbeat, and returns a TwinBuildJob (twin world frame +
   * the ordered frame list). Returns null when nothing is waiting.
   */
  async claimNextPendingJob(workerId: string): Promise<TwinBuildJob | null> {
    const fresh = new Date(Date.now() - HEARTBEAT_FRESH_MS);
    const claimable = await scanSessionRepository.listClaimable(fresh);
    if (claimable.length === 0) return null;

    const session = claimable[0]; // oldest-first
    const updated = await scanSessionRepository.update(session.id, {
      workerId,
      lastHeartbeat: new Date(),
      stage: 'downloading',
    });
    if (!updated) return null;

    const twin = await digitalTwinRepository.findById(session.twinId);
    const resolution = twin?.resolution ?? 0.05;
    const worldOrigin = {
      x: twin?.worldOriginX ?? 0,
      y: twin?.worldOriginY ?? 0,
      z: twin?.worldOriginZ ?? 0,
    };

    const scans = await sensorScanRepository.listBySession(session.id);
    const frames: TwinBuildJobFrame[] = scans.map((s, i) => ({
      scanId: s.id,
      frameIndex: s.frameIndex ?? i,
      pose: {
        x: s.pose.x,
        y: s.pose.y,
        z: s.pose.z,
        qx: s.pose.qx,
        qy: s.pose.qy,
        qz: s.pose.qz,
        qw: s.pose.qw,
      },
      pointCount: s.pointCount,
    }));

    console.log(`[DigitalTwinService] Job ${session.id} claimed by worker ${workerId}`);
    return {
      sessionId: session.id,
      twinId: session.twinId,
      robotId: session.robotId,
      resolution,
      worldOrigin,
      frameCount: frames.length,
      frames,
    };
  }

  // ==========================================================================
  // JOB LIFECYCLE — PROGRESS / HEARTBEAT
  // ==========================================================================

  /**
   * Update build progress. Emits session:progress and returns whether the
   * worker should continue or cancel (session deleted/failed externally).
   */
  async updateProgress(
    req: TwinWorkerProgressRequest,
  ): Promise<{ status: 'continue' | 'cancel' }> {
    const session = await scanSessionRepository.findById(req.sessionId);
    if (!session) return { status: 'cancel' };
    if (session.status === 'failed' || session.status === 'complete') {
      return { status: 'cancel' };
    }

    const progress = Math.max(0, Math.min(100, Math.round(req.progress)));
    const updated = await scanSessionRepository.update(req.sessionId, {
      progress,
      stage: req.stage ?? session.stage,
      lastHeartbeat: new Date(),
    });

    if (updated) this.emitProgress(updated);
    return { status: 'continue' };
  }

  /**
   * Record a worker heartbeat. Returns 'stop' if the session no longer exists
   * or has been cancelled/failed, else 'continue'.
   */
  async recordHeartbeat(
    req: TwinWorkerHeartbeatRequest,
  ): Promise<{ status: 'continue' | 'stop' }> {
    const session = await scanSessionRepository.findById(req.sessionId);
    if (!session) return { status: 'stop' };
    if (session.status === 'failed' || session.status === 'complete') {
      return { status: 'stop' };
    }
    await scanSessionRepository.update(req.sessionId, {
      workerId: req.workerId,
      lastHeartbeat: new Date(),
    });
    return { status: 'continue' };
  }

  // ==========================================================================
  // JOB LIFECYCLE — COMPLETE / FAIL
  // ==========================================================================

  /**
   * Complete a build job: persist artifact keys + bounds + pointCount onto the
   * DigitalTwin (status 'ready'), mark the session 'complete', emit twin:ready.
   */
  async completeJob(req: TwinWorkerCompleteRequest): Promise<{ ok: boolean }> {
    const session = await scanSessionRepository.findById(req.sessionId);
    if (!session) {
      console.error(`[DigitalTwinService] complete: session not found ${req.sessionId}`);
      return { ok: false };
    }

    // Atomically claim the terminal transition BEFORE touching the twin or
    // irreversibly pruning frames. If the session already left 'processing'
    // (a concurrent reaper failed it, an external cancel, or a double-complete)
    // this returns false and we bail — never resurrect a cancelled session and
    // never prune behind the reaper's back.
    const claimed = await scanSessionRepository.completeIfProcessing(req.sessionId);
    if (!claimed) {
      console.warn(
        `[DigitalTwinService] complete: session ${req.sessionId} is no longer 'processing' ` +
          `(status=${session.status}); ignoring completion`,
      );
      return { ok: false };
    }

    const [minX, minY, minZ, maxX, maxY, maxZ] = req.bounds;
    const simSceneKey = req.artifacts.simSceneKey ?? null;
    const twin = await digitalTwinRepository.update(session.twinId, {
      status: 'ready',
      storageBackend: req.storageBackend,
      pointCount: req.pointCount,
      minX, minY, minZ, maxX, maxY, maxZ,
      cloudKey: req.artifacts.cloudKey ?? null,
      meshKey: req.artifacts.meshKey ?? null,
      occupancyPgmKey: req.artifacts.occupancyPgmKey ?? null,
      occupancyYamlKey: req.artifacts.occupancyYamlKey ?? null,
      roadmapKey: req.artifacts.roadmapKey ?? null,
      simSceneKey,
      simSceneBackend: simSceneKey ? 'mujoco' : null,
      errorMessage: null,
    });

    // Real→Sim (TASK-171): a completed twin carrying a physics scene becomes a
    // first-class, simulatable environment in the SimScene registry.
    if (twin && simSceneKey) {
      try {
        await simSceneRepository.upsertForTwin({
          twinId: twin.id,
          name: `${twin.name} (scanned room)`,
          description: 'Twin-derived MuJoCo scene — Unitree G1 in the scanned room',
          embodimentTag: 'g1',
          backend: 'mujoco',
          mjcfKey: simSceneKey,
          bounds: { minX, minY, minZ, maxX, maxY, maxZ },
          status: 'ready',
        });
        console.log(`[DigitalTwinService] Registered SimScene for twin ${twin.id}`);
      } catch (err) {
        console.error(`[DigitalTwinService] Failed to upsert SimScene for twin ${twin.id}:`, err);
      }
    }

    if (twin) {
      this.emit('digital-twin:event', {
        type: 'twin:ready',
        twinId: twin.id,
        sessionId: session.id,
        twin: this.toDTO(twin),
        timestamp: new Date().toISOString(),
      } satisfies DigitalTwinEvent);
    }

    // Prune the now-redundant raw frames: the merged cloud/occupancy/mesh are
    // the durable artifacts, so the per-frame SensorScans only bloat storage.
    // Gated on `twin` so we never delete the raw inputs when the artifact write
    // itself failed. Best-effort — a prune failure must never fail a good build.
    if (twin && this.shouldPruneFrames()) {
      try {
        const pruned = await sensorScanService.pruneSessionFrames(req.sessionId);
        if (pruned > 0) {
          console.log(
            `[DigitalTwinService] Pruned ${pruned} raw frame(s) for session ${req.sessionId}`,
          );
        }
      } catch (err) {
        console.error(`[DigitalTwinService] Frame prune failed for ${req.sessionId}:`, err);
      }
    }

    console.log(`[DigitalTwinService] Job completed: ${req.sessionId}`);
    return { ok: true };
  }

  /**
   * Mark a build job as failed: session + twin → 'failed', emit twin:failed.
   */
  async failJob(req: TwinWorkerFailedRequest): Promise<{ ok: boolean }> {
    const session = await scanSessionRepository.findById(req.sessionId);
    if (!session) return { ok: false };

    // Atomically fail ONLY a still-active session. If it already reached a
    // terminal state (e.g. a concurrent completeJob just finished and pruned
    // its frames), do not clobber it to 'failed' — leave the good twin alone.
    const failed = await scanSessionRepository.failIfActive(req.sessionId, req.error);
    if (!failed) {
      return { ok: false };
    }

    await digitalTwinRepository.update(session.twinId, {
      status: 'failed',
      errorMessage: req.error,
    });

    this.emit('digital-twin:event', {
      type: 'twin:failed',
      twinId: session.twinId,
      sessionId: session.id,
      error: req.error,
      timestamp: new Date().toISOString(),
    } satisfies DigitalTwinEvent);

    console.log(`[DigitalTwinService] Job failed: ${req.sessionId} - ${req.error}`);
    return { ok: true };
  }

  /**
   * Fail sessions stuck in 'processing' whose worker heartbeat went stale.
   * Called on boot. Returns the number reaped.
   */
  async reapStaleRunningJobs(thresholdMs = STALE_RUNNING_MS): Promise<number> {
    const cutoff = new Date(Date.now() - thresholdMs);
    const stuck = await scanSessionRepository.listStuck(cutoff);
    let reaped = 0;
    for (const session of stuck) {
      // Distinguish "a worker claimed it then went silent" (genuine timeout)
      // from "no worker ever picked it up" (common in dev with no sidecar) —
      // this error is broadcast to the app, so it must name the real cause.
      const neverClaimed = session.lastHeartbeat == null;
      const error = neverClaimed
        ? 'no build worker claimed this job within 5m (is the twin-builder sidecar running?)'
        : 'worker timeout: no heartbeat/progress for >5m (reaped)';
      const result = await this.failJob({
        sessionId: session.id,
        workerId: session.workerId ?? 'reaper',
        error,
      });
      // failJob no-ops (returns ok:false) if the session reached a terminal
      // state between our snapshot and now — only count real reaps.
      if (result.ok) reaped++;
    }
    return reaped;
  }

  /**
   * Fail sweeps left in 'recording' by a process restart. The capture loop is
   * an in-memory interval (ScanSessionService) that cannot survive a restart,
   * so every 'recording' session at boot is orphaned with no way to resume.
   * Call on boot ONLY — at runtime a 'recording' session has a live loop and
   * must be left alone. Returns the number reaped.
   */
  async reapOrphanedRecordingSessions(): Promise<number> {
    const orphans = await scanSessionRepository.listOrphanedRecording();
    let reaped = 0;
    for (const session of orphans) {
      const result = await this.failJob({
        sessionId: session.id,
        workerId: session.workerId ?? 'reaper',
        error: 'recording interrupted by server restart (capture loop lost); re-scan to retry',
      });
      if (result.ok) reaped++;
    }
    return reaped;
  }

  /**
   * Start the periodic reaper. A sidecar can die mid-build at runtime, leaving a
   * 'processing' session with a stale heartbeat that the boot reaper won't catch
   * until the next restart; this sweep fails those on an interval. Reaps only
   * stale 'processing' jobs (NOT 'recording', which has a live capture loop at
   * runtime). Idempotent; the timer is unref'd so it never holds the process up.
   */
  startReaper(intervalMs = REAPER_INTERVAL_MS): void {
    if (this.reaperInterval) return;
    const timer = setInterval(() => {
      this.reapStaleRunningJobs()
        .then((n) => {
          if (n > 0) {
            console.log(`[DigitalTwinService] Periodic reaper failed ${n} stale build job(s)`);
          }
        })
        .catch((err) => console.error('[DigitalTwinService] Periodic reaper error:', err));
    }, intervalMs);
    timer.unref?.();
    this.reaperInterval = timer;
  }

  /** Stop the periodic reaper (graceful shutdown). */
  stopReaper(): void {
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = null;
    }
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  onDigitalTwinEvent(handler: DigitalTwinEventCallback): () => void {
    this.on('digital-twin:event', handler);
    return () => this.off('digital-twin:event', handler);
  }

  private emitProgress(session: ScanSessionRecord): void {
    this.emit('digital-twin:event', {
      type: 'session:progress',
      sessionId: session.id,
      twinId: session.twinId,
      status: session.status,
      frameCount: session.frameCount,
      progress: session.progress,
      stage: session.stage,
      timestamp: new Date().toISOString(),
    } satisfies DigitalTwinEvent);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private toDTO(twin: DigitalTwinRecord): DigitalTwinDTO {
    return twinToDTO(twin);
  }
}

export const digitalTwinService = DigitalTwinService.getInstance();
