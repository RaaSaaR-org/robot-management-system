/**
 * @file ScanSessionService.ts
 * @description Server-of-record for digital-twin scan sweeps (TASK-170 Phase 2).
 *              Mirrors SensorScanService (singleton EventEmitter) and
 *              TeleoperationService (session start→recording, stop→processing).
 *              Drives the robot agent (scan/start, scan/stop) and runs a
 *              server-side capture loop that pulls posed full-res frames and
 *              persists them via SensorScanService.persistFrame.
 * @feature digitaltwin
 */

import { EventEmitter } from 'events';
import { robotManager } from './RobotManager.js';
import { HttpClient, HTTP_TIMEOUTS } from './HttpClient.js';
import { sensorScanService } from './SensorScanService.js';
import {
  scanSessionRepository,
  digitalTwinRepository,
  sensorScanRepository,
} from '../repositories/index.js';
import { scanSessionToDTO } from './twinDto.js';
import type { SensorScanSummary } from '../types/pointcloud.types.js';
import type {
  ScanSessionRecord,
  ScanSessionDTO,
  DigitalTwinEvent,
  DigitalTwinEventCallback,
} from '../types/twin.types.js';

// Interval between captured frames in a sweep (~1.5s, per contract).
const CAPTURE_INTERVAL_MS = 1500;

export class ScanSessionService extends EventEmitter {
  private static instance: ScanSessionService;

  /** Active capture loops keyed by sessionId. */
  private captureLoops = new Map<string, ReturnType<typeof setInterval>>();
  /** Next frame index per active session (monotonic within a sweep). */
  private frameCounters = new Map<string, number>();

  private constructor() {
    super();
  }

  static getInstance(): ScanSessionService {
    if (!ScanSessionService.instance) {
      ScanSessionService.instance = new ScanSessionService();
    }
    return ScanSessionService.instance;
  }

  // ==========================================================================
  // SESSION LIFECYCLE
  // ==========================================================================

  /**
   * Start a sweep: create a recording ScanSession, flip the twin to
   * 'recording', tell the agent to begin scanning, and start the capture loop.
   */
  async startSession(input: { robotId: string; twinId: string }): Promise<ScanSessionDTO> {
    const { robotId, twinId } = input;

    const twin = await digitalTwinRepository.findById(twinId);
    if (!twin) {
      throw new Error(`Digital twin ${twinId} not found`);
    }

    const session = await scanSessionRepository.create({
      robotId,
      twinId,
      status: 'recording',
      startedAt: new Date(),
    });

    await digitalTwinRepository.update(twinId, { status: 'recording' });

    // Tell the agent to start scanning (best-effort — simulation may not
    // implement it; the capture loop still pulls snapshots regardless).
    try {
      const registered = await robotManager.getRegisteredRobot(robotId);
      if (registered) {
        const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.MEDIUM);
        await httpClient.post(`/api/v1/robots/${robotId}/pointcloud/scan/start`, {
          sessionId: session.id,
        });
      }
    } catch (err) {
      console.warn('[ScanSessionService] agent scan/start failed (continuing):', err);
    }

    this.frameCounters.set(session.id, 0);
    this.startCaptureLoop(session.id, robotId);

    this.emitProgress(session);
    return this.toDTO(session);
  }

  /**
   * Stop a sweep: stop the capture loop, tell the agent to stop scanning, flip
   * the session to 'processing' (queuing the sidecar build) and leave the twin
   * in 'processing'. Emits a final session:progress.
   */
  async stopSession(sessionId: string): Promise<ScanSessionDTO> {
    const session = await scanSessionRepository.findById(sessionId);
    if (!session) {
      throw new Error(`Scan session ${sessionId} not found`);
    }

    this.stopCaptureLoop(sessionId);

    // Tell the agent to stop scanning (best-effort).
    try {
      const registered = await robotManager.getRegisteredRobot(session.robotId);
      if (registered) {
        const httpClient = new HttpClient(registered.baseUrl, HTTP_TIMEOUTS.MEDIUM);
        await httpClient.post(`/api/v1/robots/${session.robotId}/pointcloud/scan/stop`);
      }
    } catch (err) {
      console.warn('[ScanSessionService] agent scan/stop failed (continuing):', err);
    }

    // Sync the persisted frame count (the loop may have lagged the in-memory
    // counter on the final tick) before queuing the build.
    const frames = await sensorScanRepository.listBySession(sessionId);

    const updated = await scanSessionRepository.update(sessionId, {
      status: 'processing',
      frameCount: frames.length,
      endedAt: new Date(),
      progress: 0,
      stage: null,
    });
    await digitalTwinRepository.update(session.twinId, { status: 'processing' });

    const result = updated ?? session;
    this.emitProgress(result);
    return this.toDTO(result);
  }

  async getSession(sessionId: string): Promise<ScanSessionDTO | null> {
    const session = await scanSessionRepository.findById(sessionId);
    return session ? this.toDTO(session) : null;
  }

  /** List the recorded frames of a sweep as scan summaries. */
  async listFrames(sessionId: string): Promise<SensorScanSummary[]> {
    const records = await sensorScanRepository.listBySession(sessionId);
    return records.map((r) => sensorScanService.toScanSummary(r));
  }

  // ==========================================================================
  // CAPTURE LOOP
  // ==========================================================================

  private startCaptureLoop(sessionId: string, robotId: string): void {
    if (this.captureLoops.has(sessionId)) return;

    const tick = async () => {
      try {
        const frame = await sensorScanService.getLiveSnapshot(robotId, undefined, true);
        const frameIndex = this.frameCounters.get(sessionId) ?? 0;
        this.frameCounters.set(sessionId, frameIndex + 1);

        await sensorScanService.persistFrame({
          robotId,
          frame,
          sessionId,
          frameIndex,
          pose: frame.pose,
        });

        const updated = await scanSessionRepository.update(sessionId, {
          frameCount: frameIndex + 1,
        });
        if (updated) this.emitProgress(updated);
      } catch (err) {
        // Transient capture failures shouldn't kill the sweep — log and retry
        // on the next tick.
        console.warn(`[ScanSessionService] capture tick failed (session=${sessionId}):`, err);
      }
    };

    const loop = setInterval(() => {
      void tick();
    }, CAPTURE_INTERVAL_MS);
    loop.unref?.();
    this.captureLoops.set(sessionId, loop);
  }

  private stopCaptureLoop(sessionId: string): void {
    const loop = this.captureLoops.get(sessionId);
    if (loop) {
      clearInterval(loop);
      this.captureLoops.delete(sessionId);
    }
    this.frameCounters.delete(sessionId);
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  onDigitalTwinEvent(handler: DigitalTwinEventCallback): () => void {
    this.on('digital-twin:event', handler);
    return () => this.off('digital-twin:event', handler);
  }

  private emitProgress(session: ScanSessionRecord): void {
    const event: DigitalTwinEvent = {
      type: 'session:progress',
      sessionId: session.id,
      twinId: session.twinId,
      status: session.status,
      frameCount: session.frameCount,
      progress: session.progress,
      stage: session.stage,
      timestamp: new Date().toISOString(),
    };
    this.emit('digital-twin:event', event);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private toDTO(session: ScanSessionRecord): ScanSessionDTO {
    return scanSessionToDTO(session);
  }
}

export const scanSessionService = ScanSessionService.getInstance();
