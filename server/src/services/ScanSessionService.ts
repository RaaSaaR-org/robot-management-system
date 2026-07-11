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
import {
  parsePointCloudFile,
  normalizeFloorToZero,
  PointCloudParseError,
} from '../storage/pointcloud-parse.js';
import type { PointCloudFrame, SensorScanSummary } from '../types/pointcloud.types.js';
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

  /**
   * Import a recorded point-cloud file (PLY or PCD) as a complete one-frame
   * sweep: parse the file, persist it as a single identity-pose SensorScan,
   * and create a ScanSession directly in 'processing' so the twin-builder
   * sidecar claims and builds it exactly like a live sweep. This is the
   * ingestion path for real captures taken outside the platform (e.g. a
   * Livox MID-360 dump from the real G1).
   */
  async importScan(input: {
    twinId: string;
    buffer: Buffer;
    filename: string;
    /** Robot to attribute the scan to; defaults to the twin's robot. */
    robotId?: string;
    /** Shift the cloud so the floor sits at z=0 (default true). */
    normalizeFloor?: boolean;
  }): Promise<ScanSessionDTO> {
    const { twinId, buffer, filename } = input;

    const twin = await digitalTwinRepository.findById(twinId);
    if (!twin) {
      throw new Error(`Digital twin ${twinId} not found`);
    }
    if (twin.status === 'recording' || twin.status === 'processing') {
      throw new PointCloudParseError(
        `Twin is ${twin.status} — wait for the current scan/build to finish before importing`,
      );
    }
    const robotId = input.robotId ?? twin.robotId;
    if (!robotId) {
      throw new PointCloudParseError(
        'No robot to attribute the scan to — pass robotId or assign one to the twin',
      );
    }

    // Parse BEFORE creating any rows so a bad file leaves no residue.
    const cloud = parsePointCloudFile(buffer, filename);
    let floorOffset = 0;
    if (input.normalizeFloor !== false) {
      floorOffset = normalizeFloorToZero(cloud);
    }

    const session = await scanSessionRepository.create({
      robotId,
      twinId,
      status: 'processing',
      startedAt: new Date(),
    });

    try {
      const frame: PointCloudFrame = {
        robotId,
        sensor: 'imported-file',
        sensorType: 'lidar',
        frame: 'sensor',
        pointCount: cloud.pointCount,
        positions: cloud.positions,
        intensities: cloud.intensities,
        hasIntensity: cloud.hasIntensity,
        sequence: 0,
        // The file is already one world-frame cloud — identity pose.
        pose: { x: 0, y: 0, z: 0, yaw: 0 },
        source: 'import',
        sourceLabel: filename,
        timestamp: new Date().toISOString(),
      };
      await sensorScanService.persistFrame({
        robotId,
        frame,
        sessionId: session.id,
        frameIndex: 0,
        pose: frame.pose,
      });
    } catch (err) {
      // Never leave a frameless 'processing' session for the sidecar to chew on.
      await scanSessionRepository.failIfActive(
        session.id,
        `import failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const updated = await scanSessionRepository.update(session.id, {
      frameCount: 1,
      endedAt: new Date(),
    });
    await digitalTwinRepository.update(twinId, { status: 'processing' });

    console.log(
      `[ScanSessionService] Imported ${cloud.format.toUpperCase()} "${filename}" ` +
        `(${cloud.pointCount} points${floorOffset ? `, floor normalized by ${floorOffset.toFixed(3)}m` : ''}) ` +
        `as session ${session.id} — queued for twin build`,
    );

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
