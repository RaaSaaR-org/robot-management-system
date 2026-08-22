/**
 * @file TeleoperationService.ts
 * @description Service for managing teleoperation data collection sessions
 * @feature datacollection
 */

import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type {
  TeleoperationSession,
  TeleoperationFrame,
  EpisodeSummary,
  CreateSessionDto,
  RecordFrameDto,
  BatchRecordFramesDto,
  UpdateSessionDto,
  AnnotateSessionDto,
  ExportSessionDto,
  SessionResponse,
  SessionListQuery,
  SessionListResponse,
  QualityFeedback,
  QualityThresholds,
  ExportResultResponse,
  TeleoperationEvent,
} from '../types/teleoperation.types.js';
import { DEFAULT_QUALITY_THRESHOLDS } from '../types/teleoperation.types.js';
import { dataQualityService } from './DataQualityService.js';
import { LeRobotExportService } from './LeRobotExportService.js';
import { RustFSClient } from '../storage/rustfs-client.js';
import { datasetRepository, robotTypeRepository } from '../repositories/index.js';
import type { CreateDatasetInput } from '../types/vla.types.js';
import type { FrameRow } from './LeRobotExportService.js';
import {
  agentRecordingService,
  AgentRecordingRefused,
  type AgentEpisodeReport,
} from './AgentRecordingService.js';
import {
  SimFrameRecorder,
  type RecordedFrame,
  type RecorderProgress,
  type RecorderTelemetry,
} from './SimFrameRecorder.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_FPS = 30;

/**
 * How often the session page is told what the robot's recorder is doing.
 * Matched to the sim recorder's own 1 Hz progress emit — faster would only
 * make the number flicker.
 */
const AGENT_PROGRESS_POLL_MS = 1000;
const MAX_BATCH_SIZE = 100;

// ============================================================================
// TELEOPERATION SERVICE
// ============================================================================

/**
 * Service for teleoperation session management and data collection
 */
/**
 * How an episode's retargeting modes are stored: '+'-joined, or null when the
 * robot did not say.
 *
 * Null and the empty string are different answers and both are real. Null is an
 * older agent that has no idea; the empty string is a take nobody drove. Neither
 * may be turned into 'orientation', which is what a plain `?? ''` would do to
 * the first of them — labelling every pre-TASK-216 episode with a mode nothing
 * observed is exactly the trap the field exists to close.
 */
function joinModes(modes: readonly string[] | undefined): string | null {
  return modes === undefined ? null : modes.join('+');
}

/**
 * The inverse. `undefined` for a row that predates the column.
 *
 * Accepts `undefined` as well as `null`, and that is not defensive padding: a
 * row read back before the column existed — from an older Prisma client, or
 * from any of the many places a `TeleoperationEpisode` is constructed without
 * it — has the property MISSING rather than null, and `null` alone let a
 * `.split` of undefined escape into `listEpisodes` and 500 the episode list of
 * every pre-TASK-216 session. Both spellings mean the same thing: nobody
 * recorded a mode.
 */
function splitModes(stored: string | null | undefined): string[] | undefined {
  if (stored === null || stored === undefined) return undefined;
  return stored === '' ? [] : stored.split('+');
}

export class TeleoperationService extends EventEmitter {
  private static instance: TeleoperationService;

  private prisma: PrismaClient;
  private qualityThresholds: QualityThresholds;

  private constructor() {
    super();
    this.prisma = new PrismaClient();
    this.qualityThresholds = { ...DEFAULT_QUALITY_THRESHOLDS };
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TeleoperationService {
    if (!TeleoperationService.instance) {
      TeleoperationService.instance = new TeleoperationService();
    }
    return TeleoperationService.instance;
  }

  /**
   * Set quality thresholds for real-time feedback
   */
  setQualityThresholds(thresholds: Partial<QualityThresholds>): void {
    this.qualityThresholds = { ...this.qualityThresholds, ...thresholds };
  }

  // ============================================================================
  // SESSION CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new teleoperation session
   */
  async createSession(dto: CreateSessionDto): Promise<SessionResponse> {
    const session = await this.prisma.teleoperationSession.create({
      data: {
        operatorId: dto.operatorId,
        robotId: dto.robotId,
        type: dto.type,
        status: 'created',
        frameCount: 0,
        fps: dto.fps ?? DEFAULT_FPS,
        languageInstr: dto.languageInstr ?? null,
        numEpisodes: dto.numEpisodes ?? null,
        episodeTimeS: dto.episodeTimeS ?? null,
        datasetRepoId: dto.datasetRepoId ?? null,
      },
    });

    this.emitEvent({
      type: 'session:created',
      sessionId: session.id,
      session: this.toSessionResponse(session as TeleoperationSession),
      timestamp: new Date(),
    });

    return this.toSessionResponse(session as TeleoperationSession);
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<SessionResponse | null> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });
    return session ? this.toSessionResponse(session as TeleoperationSession) : null;
  }

  /**
   * List sessions with filters
   */
  async listSessions(query: SessionListQuery): Promise<SessionListResponse> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {};

    if (query.operatorId) {
      where.operatorId = query.operatorId;
    }
    if (query.robotId) {
      where.robotId = query.robotId;
    }
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      where.type = { in: types };
    }
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      where.status = { in: statuses };
    }
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        (where.createdAt as Record<string, Date>).gte = query.startDate;
      }
      if (query.endDate) {
        (where.createdAt as Record<string, Date>).lte = query.endDate;
      }
    }

    const [sessions, total] = await Promise.all([
      this.prisma.teleoperationSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.teleoperationSession.count({ where }),
    ]);

    return {
      sessions: sessions.map((s) => this.toSessionResponse(s as TeleoperationSession)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update session metadata
   */
  async updateSession(
    sessionId: string,
    dto: UpdateSessionDto
  ): Promise<SessionResponse | null> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return null;
    }

    const updateData: Record<string, unknown> = {};
    if (dto.languageInstr !== undefined) {
      updateData.languageInstr = dto.languageInstr;
    }
    if (dto.fps !== undefined) {
      updateData.fps = dto.fps;
    }

    const updated = await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: updateData,
    });

    return this.toSessionResponse(updated as TeleoperationSession);
  }

  /**
   * Delete session and all frames
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      // Stop any live recording machinery for this session first
      const recorder = this.simRecorders.get(sessionId);
      if (recorder) {
        await recorder.stop();
        this.simRecorders.delete(sessionId);
      }
      this.stopSidecarProgressPoller(sessionId);
      this.stopAgentProgressPoller(sessionId);

      // A robot recording a session that is being deleted has to be told. It
      // has no other way to find out: nothing else stops its tick, and it would
      // keep filming — and refuse the next session as "busy" — until the agent
      // is restarted.
      const doomed = await this.prisma.teleoperationSession.findUnique({
        where: { id: sessionId },
      });
      if (doomed?.recorderKind === 'agent') {
        await agentRecordingService.stop(doomed.robotId).catch(() => null);
      }

      this.lastQualityFeedback.delete(sessionId);
      this.clientEpisodeIndex.delete(sessionId);
      this.progressTicks.delete(sessionId);

      await this.prisma.teleoperationSession.delete({
        where: { id: sessionId },
      });
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // SESSION LIFECYCLE
  // ============================================================================

  /**
   * Start recording a session.
   * If the robot has a sidecar URL (real SO-101 hardware), triggers
   * `POST /record/start` on the sidecar to spawn `lerobot-record`.
   */
  async startSession(sessionId: string): Promise<SessionResponse> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'created' && session.status !== 'paused') {
      throw new Error(
        `Cannot start session in status: ${session.status}. Must be 'created' or 'paused'.`
      );
    }

    // Check if the robot has a hardware sidecar (real SO-101)
    const sidecarUrl = await this.resolveSidecarUrl(session.robotId);
    let sidecarDatasetPath: string | null = null;
    let sidecarStarted = false;

    if (sidecarUrl) {
      const repoId = session.datasetRepoId ?? `robot0/session-${sessionId.slice(0, 8)}`;
      const numEpisodes = session.numEpisodes ?? 1;
      const episodeTimeS = session.episodeTimeS ?? 60;

      try {
        const resp = await fetch(`${sidecarUrl}/record/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo_id: repoId,
            task: session.languageInstr ?? 'manipulate object',
            num_episodes: numEpisodes,
            episode_time_s: episodeTimeS,
            fps: session.fps,
          }),
        });
        const result = await resp.json() as { ok?: boolean; dataset_path?: string; error?: string };
        if (!result.ok) {
          throw new Error(result.error ?? 'Sidecar /record/start failed');
        }
        sidecarDatasetPath = result.dataset_path ?? null;
        sidecarStarted = true;
        console.log(`[TeleoperationService] sidecar recording started → ${sidecarDatasetPath}`);

        // Start polling sidecar for progress
        this.startSidecarProgressPoller(sessionId, sidecarUrl);
      } catch (err) {
        console.error(`[TeleoperationService] sidecar start failed:`, err);
        // Don't block — start session anyway, just without hardware recording
      }
    }

    // No hardware sidecar. Ask the robot agent to record the episode itself
    // (TASK-215): it holds the commanded pose and is one hop from the cameras,
    // so it can write a LeRobot v3.0 tree WITH VIDEO and with `action` and
    // `observation.state` genuinely distinct. The server-side SimFrameRecorder
    // can do neither — it polls telemetry, which carries only the measured pose
    // and no pictures at all.
    //
    // A robot whose agent predates these routes, or does not answer, falls back
    // to SimFrameRecorder. Which path was taken is written to the session,
    // because endSession has to ask the same recorder to stop and a server
    // restart in between must not lose that.
    let recorderKind: 'agent' | 'sim' | 'sidecar' | null = sidecarStarted ? 'sidecar' : null;

    if (!sidecarStarted && !session.sidecarDatasetPath) {
      let agentStatus;
      try {
        agentStatus = await agentRecordingService.start(session.robotId, {
          sessionId,
          fps: session.fps,
          ...(session.languageInstr ? { task: session.languageInstr } : {}),
          inputMode: session.type,
        });
      } catch (err) {
        // The robot understood and said no. That is a state on the robot the
        // operator has to clear — most often a recording left running by a
        // session that ended badly — and quietly falling back to the joints-only
        // recorder would hide it behind a dataset with no video.
        if (err instanceof AgentRecordingRefused) {
          throw new Error(
            `The robot refused to record this session: ${err.message}. ` +
              `Stop the recording on ${session.robotId} and start the session again.`
          );
        }
        throw err;
      }
      if (agentStatus) {
        recorderKind = 'agent';
        console.log(
          `[TeleoperationService] agent-side recording started on ${session.robotId}: ` +
            `${agentStatus.cameras.map((c) => c.key).join(', ') || 'no cameras'} @ ${agentStatus.fpsTarget} fps`
        );
        this.startAgentProgressPoller(sessionId, session.robotId);
      } else {
        recorderKind = 'sim';
        console.log(
          `[TeleoperationService] ${session.robotId} cannot record on the agent — ` +
            'falling back to the server-side SimFrameRecorder (joints only, no video)'
        );
        await this.startSimRecorder(session as TeleoperationSession);
      }
    }

    const updated = await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: {
        status: 'recording',
        startedAt: session.startedAt ?? new Date(),
        ...(sidecarDatasetPath ? { sidecarDatasetPath } : {}),
        ...(recorderKind ? { recorderKind } : {}),
      },
    });

    this.emitEvent({
      type: 'session:started',
      sessionId,
      session: this.toSessionResponse(updated as TeleoperationSession),
      timestamp: new Date(),
    });

    return this.toSessionResponse(updated as TeleoperationSession);
  }

  /**
   * Pause recording
   */
  async pauseSession(sessionId: string): Promise<SessionResponse> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'recording') {
      throw new Error(
        `Cannot pause session in status: ${session.status}. Must be 'recording'.`
      );
    }

    // Sim frame recorder: stop sampling while paused (no frames while paused)
    this.simRecorders.get(sessionId)?.pause();

    // …and the agent's recorder, which holds the frames for an agent-recorded
    // session. Without this the dataset kept growing while the console said the
    // session was parked, and the pause landed in the data as a stretch of
    // whatever the robot happened to be doing while nobody was driving it.
    if (session.recorderKind === 'agent') {
      await agentRecordingService.pause(session.robotId);
      this.stopAgentProgressPoller(sessionId);
    }

    const updated = await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: { status: 'paused' },
    });

    this.emitEvent({
      type: 'session:paused',
      sessionId,
      session: this.toSessionResponse(updated as TeleoperationSession),
      timestamp: new Date(),
    });

    return this.toSessionResponse(updated as TeleoperationSession);
  }

  /**
   * Resume paused recording
   */
  async resumeSession(sessionId: string): Promise<SessionResponse> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'paused') {
      throw new Error(
        `Cannot resume session in status: ${session.status}. Must be 'paused'.`
      );
    }

    // Sim frame recorder: resume sampling. If the recorder is gone (e.g. the
    // server restarted mid-session) and this is a frame-based session,
    // restart one initialized from the persisted frames.
    if (session.recorderKind === 'agent') {
      // The agent owns this session's frames. Starting a SimFrameRecorder here
      // — which is what the `else` below used to do, because there is never a
      // `simRecorders` entry for an agent session — would run a second,
      // joints-only recorder alongside it, writing TeleoperationFrame rows that
      // then look like a frame-based session to `endSession`.
      await agentRecordingService.resume(session.robotId);
      this.startAgentProgressPoller(sessionId, session.robotId);
    } else {
      const existingRecorder = this.simRecorders.get(sessionId);
      if (existingRecorder) {
        existingRecorder.resume();
      } else if (!session.sidecarDatasetPath) {
        await this.startSimRecorder(session as TeleoperationSession);
      }
    }

    const updated = await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: { status: 'recording' },
    });

    this.emitEvent({
      type: 'session:resumed',
      sessionId,
      session: this.toSessionResponse(updated as TeleoperationSession),
      timestamp: new Date(),
    });

    return this.toSessionResponse(updated as TeleoperationSession);
  }

  /**
   * End recording session.
   * If a sidecar recording is running, sends SIGINT to lerobot-record
   * via `POST /record/stop`.
   */
  async endSession(sessionId: string): Promise<SessionResponse> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'recording' && session.status !== 'paused') {
      throw new Error(
        `Cannot end session in status: ${session.status}. Must be 'recording' or 'paused'.`
      );
    }

    // Stop progress poller
    this.stopSidecarProgressPoller(sessionId);
    this.stopAgentProgressPoller(sessionId);

    // Stop the sim frame recorder (if any) and flush remaining frames
    const recorder = this.simRecorders.get(sessionId);
    if (recorder) {
      await recorder.stop();
      this.simRecorders.delete(sessionId);
    }

    // Stop the agent-side recorder. This is where the encode happens, so it can
    // take a while; the result carries the dataset it wrote or the reason there
    // is none.
    let agentResult: Awaited<ReturnType<typeof agentRecordingService.stop>> = null;
    if (session.recorderKind === 'agent') {
      agentResult = await agentRecordingService.stop(session.robotId);
      if (agentResult?.ok) {
        console.log(
          `[TeleoperationService] agent recording stopped: ${agentResult.totalFrames} frames, ` +
            `${agentResult.totalDropped} dropped, ${agentResult.fpsActual} fps → ${agentResult.datasetPath}`
        );
      } else {
        console.warn(
          `[TeleoperationService] agent recording produced no dataset: ` +
            `${agentResult?.error ?? 'the robot did not answer'}`
        );
      }
      await this.persistEpisodeSummaries(sessionId, agentResult?.episodes ?? []);
    }
    this.lastQualityFeedback.delete(sessionId);
    this.clientEpisodeIndex.delete(sessionId);
    this.progressTicks.delete(sessionId);

    // Stop sidecar recording if it was started
    const sidecarUrl = await this.resolveSidecarUrl(session.robotId);
    let episodesRecorded = 0;
    let s3Path: string | null = null;

    if (sidecarUrl && session.sidecarDatasetPath) {
      try {
        // Stop recording → triggers auto-upload on the sidecar
        const resp = await fetch(`${sidecarUrl}/record/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const result = await resp.json() as { ok?: boolean; episodes_recorded?: number; exit_code?: number };
        episodesRecorded = result.episodes_recorded ?? 0;
        console.log(`[TeleoperationService] sidecar recording stopped, episodes=${episodesRecorded} exit=${result.exit_code}`);

        // Only poll for upload if recording actually produced data
        if (episodesRecorded > 0 || result.exit_code === 0) {
          s3Path = await this.waitForSidecarUpload(sidecarUrl, 60_000);
        } else {
          console.log('[TeleoperationService] Recording failed (0 episodes), skipping upload poll');
        }
      } catch (err) {
        console.error('[TeleoperationService] sidecar stop/upload failed:', err);
      }
    }

    const endedAt = new Date();
    const duration = session.startedAt
      ? (endedAt.getTime() - session.startedAt.getTime()) / 1000
      : 0;

    const qualityScore = await this.computeSessionQuality(sessionId);

    // Read actual frame count from sidecar (parsed from LeRobot's info.json)
    let totalFrames = 0;
    let totalEpisodes = episodesRecorded;
    if (sidecarUrl && session.sidecarDatasetPath) {
      try {
        const statusResp = await fetch(`${sidecarUrl}/record/status`);
        const finalStatus = await statusResp.json() as {
          total_frames?: number; total_episodes?: number; episodes_done?: number;
        };
        totalFrames = finalStatus.total_frames ?? 0;
        totalEpisodes = finalStatus.total_episodes ?? finalStatus.episodes_done ?? episodesRecorded;
      } catch { /* use defaults */ }
    }

    // Frame-based sessions: the DB is the source of truth for the frame count.
    // An agent-recorded session is NOT frame-based — its frames are a parquet
    // file on the robot, and auto-exporting the (empty) TeleoperationFrame
    // table for it would produce a second, hollow dataset next to the real one.
    const isFrameBased = !session.sidecarDatasetPath && !s3Path && session.recorderKind !== 'agent';
    const dbFrameCount = isFrameBased
      ? await this.prisma.teleoperationFrame.count({ where: { sessionId } })
      : 0;

    // Auto-create Dataset record if upload succeeded
    let exportedDatasetId: string | null = null;
    if (s3Path) {
      try {
        // Use task description as dataset name (slugified), not session ID
        const datasetName = session.datasetRepoId
          ?? session.languageInstr?.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50)
          ?? `teleop-${sessionId.slice(0, 8)}`;
        const robotTypeId = await this.resolveRobotTypeIdFromSession(session.robotId);

        // Normalize storagePath to always have trailing slash
        const normalizedPath = s3Path.endsWith('/') ? s3Path : `${s3Path}/`;

        // Try to read LeRobot info.json from RustFS for camera metadata
        let infoJsonObj: Record<string, unknown> = {};
        try {
          const { isRustFSInitialized, getRustFSClient } = await import('../storage/rustfs-client.js');
          if (isRustFSInitialized()) {
            const infoKey = `${normalizedPath}meta/info.json`;
            const rustfs = getRustFSClient();
            // Try both buckets (new 'training-datasets' and legacy 'datasets')
            for (const bucket of ['training-datasets', 'datasets']) {
              try {
                const stream = await rustfs.getStream(bucket, infoKey);
                const chunks: Buffer[] = [];
                for await (const chunk of stream) chunks.push(Buffer.from(chunk));
                infoJsonObj = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                console.log(`[TeleoperationService] Read info.json from RustFS bucket=${bucket}: ${infoKey}`);
                break;
              } catch { /* try next bucket */ }
            }
          }
        } catch {
          console.log('[TeleoperationService] Could not read info.json from RustFS, using default');
        }

        const dataset = await datasetRepository.create({
          name: datasetName,
          description: `Teleoperation: ${session.languageInstr ?? sessionId}`,
          robotTypeId,
          storagePath: normalizedPath,
          lerobotVersion: 'v3.0',
          fps: session.fps,
          totalFrames,
          totalDuration: duration,
          demonstrationCount: totalEpisodes || session.numEpisodes || 1,
          status: 'ready',
          infoJson: infoJsonObj as import('../types/vla.types.js').LeRobotInfo,
        });
        exportedDatasetId = dataset.id;
        console.log(`[TeleoperationService] Auto-created Dataset: ${dataset.id} (${datasetName}) ${totalFrames} frames`);
      } catch (err) {
        console.error('[TeleoperationService] auto-create Dataset failed:', err);
      }
    }

    // Register the dataset the robot wrote. `storagePath` is a directory on
    // the robot's disk, which for a simulated robot on this box is a directory
    // this server can read — `isLocalDataset()` in datasets.routes.ts already
    // serves episodes, frames and video straight out of one.
    if (agentResult?.ok && agentResult.datasetPath) {
      try {
        exportedDatasetId = await this.registerAgentDataset(
          session as TeleoperationSession,
          agentResult,
          duration
        );
      } catch (err) {
        console.error('[TeleoperationService] registering the agent dataset failed:', err);
      }
    }

    // Zero-frame frame-based sessions: complete with a clear warning, no dataset
    const zeroFrameWarning =
      isFrameBased && dbFrameCount === 0
        ? 'No frames were recorded — the robot agent produced no telemetry during the session. No dataset was created.'
        : null;

    // An agent session that recorded nothing says WHY, in the robot's own
    // words: "teleop is not engaged" and "an emergency stop is latched" are
    // different problems with different fixes, and the operator needs the
    // difference.
    const agentWarning =
      session.recorderKind === 'agent' && !agentResult?.ok
        ? `No dataset was recorded on the robot: ${agentResult?.error ?? 'the robot did not answer the stop'}`
        : null;

    let updated = await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        endedAt,
        duration,
        qualityScore,
        frameCount: agentResult?.ok
          ? agentResult.totalFrames
          : isFrameBased
            ? dbFrameCount
            : (totalFrames || episodesRecorded),
        ...(exportedDatasetId ? { exportedDatasetId } : {}),
        ...(s3Path ? { sidecarDatasetPath: s3Path } : {}),
        ...(agentResult?.datasetPath ? { agentDatasetPath: agentResult.datasetPath } : {}),
        ...(agentWarning ? { errorMessage: agentWarning } : {}),
        ...(zeroFrameWarning ? { errorMessage: zeroFrameWarning } : {}),
      },
    });

    // Frame-based sessions with data: auto-export to LeRobot so the dataset
    // appears immediately after the session ends (same UX as the sidecar path).
    if (isFrameBased && dbFrameCount > 0) {
      try {
        await this.exportToLeRobot(sessionId, {});
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.error(`[TeleoperationService] Auto-export failed for ${sessionId}:`, err);
        updated = await this.prisma.teleoperationSession.update({
          where: { id: sessionId },
          data: { errorMessage: `Auto-export to LeRobot failed: ${message}` },
        });
      }
      // Re-read so the response carries exportedDatasetId set by the export
      const refreshed = await this.prisma.teleoperationSession.findUnique({
        where: { id: sessionId },
      });
      if (refreshed) updated = refreshed;
    }

    this.emitEvent({
      type: 'session:completed',
      sessionId,
      session: this.toSessionResponse(updated as TeleoperationSession),
      timestamp: new Date(),
    });

    return this.toSessionResponse(updated as TeleoperationSession);
  }

  // ============================================================================
  // EPISODES WITHIN A SESSION
  // ============================================================================

  /**
   * Advance the session's recording to the next episode.
   * Only valid while the session is recording.
   */
  async nextEpisode(sessionId: string): Promise<{ episodeIndex: number }> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (session.status !== 'recording') {
      throw new Error(
        `Cannot advance episode: session status is ${session.status}, expected 'recording'`
      );
    }
    if (session.sidecarDatasetPath) {
      throw new Error('Episodes are managed by the hardware sidecar for this session');
    }

    // Agent-recorded sessions: the episode boundary lives in the recorder that
    // holds the frames, so it has to be drawn there. Doing it here as well
    // would put the boundary in the database and nowhere in the dataset.
    if (session.recorderKind === 'agent') {
      const agentIndex = await agentRecordingService.nextEpisode(session.robotId);
      if (agentIndex === null) {
        throw new Error(
          'The robot is recording this session but did not accept the episode boundary'
        );
      }
      this.emitEvent({
        type: 'session:progress',
        sessionId,
        recordingProgress: { currentEpisode: agentIndex, running: true },
        timestamp: new Date(),
      });
      return { episodeIndex: agentIndex };
    }

    const recorder = this.simRecorders.get(sessionId);
    let episodeIndex: number;
    if (recorder) {
      episodeIndex = recorder.nextEpisode();
    } else {
      // No live recorder (e.g. client-posted frames): derive from stored frames
      const agg = await this.prisma.teleoperationFrame.aggregate({
        where: { sessionId },
        _max: { episodeIndex: true },
      });
      episodeIndex = (agg._max.episodeIndex ?? 0) + 1;
      this.clientEpisodeIndex.set(sessionId, episodeIndex);
    }

    this.emitEvent({
      type: 'session:progress',
      sessionId,
      recordingProgress: { currentEpisode: episodeIndex, running: true },
      timestamp: new Date(),
    });

    return { episodeIndex };
  }

  /**
   * Summarize the session's episodes from its persisted frames.
   */
  async listEpisodes(sessionId: string): Promise<EpisodeSummary[]> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Persisted summaries win when they exist. They carry two numbers that
    // cannot be derived from frames at all: the ticks the recorder LOST (a
    // missing frame leaves no row to count) and the rate it really achieved.
    const persisted = await this.prisma.teleoperationEpisode.findMany({
      where: { sessionId },
      orderBy: { episodeIndex: 'asc' },
    });
    if (persisted.length > 0) {
      // `startTime` is where the episode begins in the SESSION's timeline, and
      // for an agent-recorded session that is the sum of what came before it —
      // the recorder reports each episode's own duration, not an offset. Every
      // row read 0.0s before this, which the review table renders as a column
      // of zeroes that looks like a bug in the recorder rather than in the sum.
      let cursor = 0;
      return persisted.map((e) => {
        const startTime = Math.round(cursor * 100) / 100;
        cursor += e.durationS;
        return {
          episodeIndex: e.episodeIndex,
          frameCount: e.frameCount,
          startTime,
          endTime: Math.round(cursor * 100) / 100,
          durationS: Math.round(e.durationS * 100) / 100,
          droppedFrames: e.droppedFrames,
          fpsActual: Math.round(e.fpsActual * 100) / 100,
          retargetModes: splitModes(e.retargetModes),
        };
      });
    }

    // A live agent-recorded session has no rows yet — they are written when it
    // stops — so ask the robot what it has so far.
    //
    // NOT gated on `status === 'recording'`: a PAUSED session still has
    // episodes, and gating on the status made the panel go empty the moment an
    // operator paused, which reads as "your takes are gone".
    if (session.recorderKind === 'agent') {
      const live = await agentRecordingService.status(session.robotId);
      if (live) {
        let cursor = 0;
        return live.episodes.map((e) => {
          const startTime = Math.round(cursor * 100) / 100;
          cursor += e.durationS;
          return {
            episodeIndex: e.episodeIndex,
            frameCount: e.frames,
            startTime,
            endTime: Math.round(cursor * 100) / 100,
            durationS: e.durationS,
            droppedFrames: e.dropped,
            fpsActual: e.fpsActual,
            retargetModes: e.retargetModes,
          };
        });
      }
    }

    const groups = await this.prisma.teleoperationFrame.groupBy({
      by: ['episodeIndex'],
      where: { sessionId },
      _count: { _all: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
      orderBy: { episodeIndex: 'asc' },
    });

    return groups.map((g) => {
      const startTime = g._min.timestamp ?? 0;
      const endTime = g._max.timestamp ?? startTime;
      return {
        episodeIndex: g.episodeIndex,
        frameCount: g._count._all,
        startTime,
        endTime,
        durationS: Math.max(0, Math.round((endTime - startTime) * 100) / 100),
      };
    });
  }

  /**
   * Discard an episode: delete its frames and update the session frame count.
   * Only valid before export (created/recording/paused).
   */
  async discardEpisode(
    sessionId: string,
    episodeIndex: number
  ): Promise<{ episodeIndex: number; deletedFrames: number; frameCount: number }> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (!['created', 'recording', 'paused'].includes(session.status)) {
      throw new Error(
        `Cannot discard episode: session status is ${session.status}. Episodes can only be discarded before the session is completed.`
      );
    }

    // Drop any not-yet-persisted frames of this episode from the live recorder
    // and wait for an in-flight persist batch, so no frame of this episode can
    // land in the DB after the delete below.
    const liveRecorder = this.simRecorders.get(sessionId);
    if (liveRecorder) {
      await liveRecorder.discardEpisode(episodeIndex);
    }
    if (session.recorderKind === 'agent') {
      // The frames are on the robot, not in this database, so the delete has to
      // happen there. The deleteMany below is still correct and still runs — it
      // is a no-op for an agent-recorded session, and it is what cleans up a
      // session that fell back to the sim recorder partway through.
      await agentRecordingService.discardEpisode(session.robotId, episodeIndex);
      await this.prisma.teleoperationEpisode.deleteMany({
        where: { sessionId, episodeIndex },
      });
    }

    const deleted = await this.prisma.teleoperationFrame.deleteMany({
      where: { sessionId, episodeIndex },
    });

    const frameCount = await this.prisma.teleoperationFrame.count({ where: { sessionId } });
    await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: { frameCount },
    });

    return { episodeIndex, deletedFrames: deleted.count, frameCount };
  }

  // ============================================================================
  // FRAME RECORDING
  // ============================================================================

  /**
   * Record a single frame
   */
  async recordFrame(
    sessionId: string,
    dto: RecordFrameDto
  ): Promise<TeleoperationFrame> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'recording') {
      throw new Error(
        `Cannot record frame: session status is ${session.status}, expected 'recording'`
      );
    }

    const frameIndex = session.frameCount;

    const frame = await this.prisma.teleoperationFrame.create({
      data: {
        sessionId,
        frameIndex,
        episodeIndex: dto.episodeIndex ?? this.clientEpisodeIndex.get(sessionId) ?? 0,
        timestamp: dto.timestamp,
        jointPositions: dto.jointPositions,
        jointVelocities: dto.jointVelocities,
        action: dto.action,
        isIntervention: dto.isIntervention ?? false,
      },
    });

    await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: { frameCount: frameIndex + 1 },
    });

    // Compute quality feedback
    const feedback = await this.computeQualityFeedback(sessionId, dto);
    if (feedback.isJerky || feedback.warningMessage) {
      this.emitEvent({
        type: 'quality:warning',
        sessionId,
        qualityFeedback: feedback,
        timestamp: new Date(),
      });
    }

    return {
      id: frame.id,
      sessionId: frame.sessionId,
      frameIndex: frame.frameIndex,
      episodeIndex: frame.episodeIndex,
      timestamp: frame.timestamp,
      jointPositions: frame.jointPositions as number[],
      jointVelocities: frame.jointVelocities as number[] | null,
      action: frame.action as number[],
      imagePath: frame.imagePath,
      depthImagePath: frame.depthImagePath,
      isIntervention: frame.isIntervention,
    };
  }

  /**
   * Record multiple frames in a batch
   */
  async recordFramesBatch(
    sessionId: string,
    dto: BatchRecordFramesDto
  ): Promise<{ recorded: number; firstIndex: number; lastIndex: number }> {
    if (dto.frames.length === 0) {
      return { recorded: 0, firstIndex: 0, lastIndex: 0 };
    }

    if (dto.frames.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size exceeds maximum of ${MAX_BATCH_SIZE}`);
    }

    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'recording') {
      throw new Error(
        `Cannot record frames: session status is ${session.status}`
      );
    }

    const firstIndex = session.frameCount;

    const defaultEpisode = this.clientEpisodeIndex.get(sessionId) ?? 0;
    const frameData = dto.frames.map((f, i) => ({
      sessionId,
      frameIndex: firstIndex + i,
      episodeIndex: f.episodeIndex ?? defaultEpisode,
      timestamp: f.timestamp,
      jointPositions: f.jointPositions,
      jointVelocities: f.jointVelocities,
      action: f.action,
      isIntervention: f.isIntervention ?? false,
    }));

    await this.prisma.teleoperationFrame.createMany({
      data: frameData,
    });

    await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: { frameCount: firstIndex + dto.frames.length },
    });

    const lastIndex = firstIndex + dto.frames.length - 1;

    return {
      recorded: dto.frames.length,
      firstIndex,
      lastIndex,
    };
  }

  /**
   * Get frames for a session
   */
  async getFrames(
    sessionId: string,
    startIndex?: number,
    limit?: number
  ): Promise<TeleoperationFrame[]> {
    const where: Record<string, unknown> = { sessionId };

    if (startIndex !== undefined) {
      where.frameIndex = { gte: startIndex };
    }

    const frames = await this.prisma.teleoperationFrame.findMany({
      where,
      orderBy: { frameIndex: 'asc' },
      take: limit,
    });

    return frames.map((f) => ({
      id: f.id,
      sessionId: f.sessionId,
      frameIndex: f.frameIndex,
      episodeIndex: f.episodeIndex,
      timestamp: f.timestamp,
      jointPositions: f.jointPositions as number[],
      jointVelocities: f.jointVelocities as number[] | null,
      action: f.action as number[],
      imagePath: f.imagePath,
      depthImagePath: f.depthImagePath,
      isIntervention: f.isIntervention,
    }));
  }

  // ============================================================================
  // ANNOTATION
  // ============================================================================

  /**
   * Annotate session with language instruction
   */
  async annotateSession(
    sessionId: string,
    dto: AnnotateSessionDto
  ): Promise<SessionResponse> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updated = await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: { languageInstr: dto.languageInstr },
    });

    return this.toSessionResponse(updated as TeleoperationSession);
  }

  // ============================================================================
  // QUALITY COMPUTATION
  // ============================================================================

  /**
   * Compute quality score for a session
   */
  async computeSessionQuality(sessionId: string): Promise<number> {
    const frames = await this.prisma.teleoperationFrame.findMany({
      where: { sessionId },
      orderBy: { frameIndex: 'asc' },
    });

    if (frames.length < 2) {
      return 50; // Neutral score for insufficient data
    }

    // Extract positions
    const positions = frames.map((f) => f.jointPositions as number[]);
    const timestamps = frames.map((f) => f.timestamp);

    // Compute smoothness metrics
    const smoothness = dataQualityService.computeSmoothnessMetrics(
      positions,
      timestamps
    );

    // Score based on jerk (lower is better)
    const jerkScore = Math.max(0, Math.min(100, 100 - smoothness.rmsJerk / 10));

    // Penalize for interventions
    const interventionCount = frames.filter((f) => f.isIntervention).length;
    const interventionPenalty = Math.min(30, interventionCount * 5);

    // Final score
    const score = Math.max(0, Math.min(100, jerkScore - interventionPenalty));

    return Math.round(score);
  }

  /**
   * Compute real-time quality feedback for a frame
   */
  async computeQualityFeedback(
    sessionId: string,
    frame: RecordFrameDto
  ): Promise<QualityFeedback> {
    const recentFrames = await this.prisma.teleoperationFrame.findMany({
      where: { sessionId },
      orderBy: { frameIndex: 'desc' },
      take: 10,
    });

    // Reverse to get chronological order
    recentFrames.reverse();

    let currentSmoothnessScore = 100;
    let isJerky = false;
    let warningMessage: string | undefined;
    const suggestions: string[] = [];

    if (recentFrames.length >= 2) {
      const positions = [
        ...recentFrames.map((f) => f.jointPositions as number[]),
        frame.jointPositions,
      ];
      const timestamps = [
        ...recentFrames.map((f) => f.timestamp),
        frame.timestamp,
      ];

      const dt =
        timestamps.length > 1
          ? (timestamps[timestamps.length - 1] - timestamps[0]) / (timestamps.length - 1)
          : 0.033;

      // Check velocity
      if (frame.jointVelocities) {
        const maxVel = Math.max(...frame.jointVelocities.map(Math.abs));
        if (maxVel > this.qualityThresholds.maxVelocity) {
          isJerky = true;
          warningMessage = `High velocity detected: ${maxVel.toFixed(2)} rad/s`;
          suggestions.push('Slow down movements');
        }
      }

      // Compute jerk for smoothness
      const rmsJerk = dataQualityService.computeRMSJerk(positions, dt);
      currentSmoothnessScore = Math.max(0, Math.min(100, 100 - rmsJerk / 10));

      if (rmsJerk > this.qualityThresholds.maxJerk) {
        isJerky = true;
        warningMessage = warningMessage ?? 'Jerky movement detected';
        suggestions.push('Move more smoothly');
      }

      if (currentSmoothnessScore < this.qualityThresholds.minPathSmoothness * 100) {
        suggestions.push('Try to maintain consistent speed');
      }
    }

    return {
      sessionId,
      currentSmoothnessScore,
      isJerky,
      warningMessage,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }

  // ============================================================================
  // LEROBOT EXPORT
  // ============================================================================

  /**
   * Export session to LeRobot v3 format (Parquet + metadata → RustFS)
   */
  async exportToLeRobot(
    sessionId: string,
    dto: ExportSessionDto
  ): Promise<ExportResultResponse> {
    const session = await this.prisma.teleoperationSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'completed') {
      throw new Error(
        `Cannot export session: status is ${session.status}, expected 'completed'`
      );
    }

    // ---------------------------------------------------------------
    // Sidecar-backed sessions: dataset already exists on the pi in
    // LeRobot format. Just create a Dataset record pointing to it.
    // ---------------------------------------------------------------
    if (session.sidecarDatasetPath) {
      const datasetName = dto.datasetName ?? session.datasetRepoId ?? `teleop_${sessionId.slice(0, 8)}`;
      const robotTypeId = await this.resolveRobotTypeIdFromSession(session.robotId);
      const datasetInput: CreateDatasetInput = {
        name: datasetName,
        description: dto.description ?? `Teleoperation: ${session.languageInstr ?? sessionId}`,
        robotTypeId,
        storagePath: session.sidecarDatasetPath,
        lerobotVersion: 'v3.0',
        fps: session.fps,
        totalFrames: session.frameCount || 150, // fallback estimate
        totalDuration: session.duration ?? 0,
        demonstrationCount: session.numEpisodes ?? 1,
        status: 'ready',
      };
      const dataset = await datasetRepository.create(datasetInput);
      await this.prisma.teleoperationSession.update({
        where: { id: sessionId },
        data: { exportedDatasetId: dataset.id },
      });
      this.emitEvent({ type: 'session:exported', sessionId, timestamp: new Date() });
      return {
        sessionId,
        datasetId: dataset.id,
        datasetName,
        trajectoryCount: session.numEpisodes ?? 1,
        totalFrames: session.frameCount || 150,
        storagePath: session.sidecarDatasetPath,
      };
    }

    // ---------------------------------------------------------------
    // Frame-based sessions: export from DB frames → LeRobot format
    // ---------------------------------------------------------------
    const dbFrames = await this.prisma.teleoperationFrame.findMany({
      where: { sessionId },
      orderBy: { frameIndex: 'asc' },
    });

    if (dbFrames.length === 0) {
      throw new Error('Cannot export session with no frames');
    }

    // Map DB rows → FrameRow for the export service (grouped by episodeIndex)
    const frames: FrameRow[] = dbFrames.map((f) => ({
      frameIndex: f.frameIndex,
      episodeIndex: f.episodeIndex,
      timestamp: f.timestamp,
      jointPositions: f.jointPositions as number[],
      action: f.action as number[],
      isIntervention: f.isIntervention,
    }));

    // Create a RustFS client for the export
    const storage = new RustFSClient({
      endpoint: process.env.RUSTFS_ENDPOINT ?? 'http://localhost:9000',
      accessKeyId: process.env.RUSTFS_ACCESS_KEY ?? 'rustfsadmin',
      secretAccessKey: process.env.RUSTFS_SECRET_KEY ?? 'rustfsadmin',
    });

    // Robot type + joint names for the LeRobot metadata (joint names come from
    // a live telemetry snapshot if the agent is reachable — best-effort).
    const robot = await this.prisma.robot.findUnique({ where: { id: session.robotId } });
    const jointNames = await this.resolveJointNames(session.robotId, robot?.a2aAgentUrl ?? null);

    const exportService = new LeRobotExportService(storage);
    const { storagePath, episodeCount } = await exportService.exportSession(frames, {
      sessionFps: session.fps,
      robotType: robot?.model ?? undefined,
      jointNames: jointNames ?? undefined,
      task: session.languageInstr ?? undefined,
    });

    const datasetName = dto.datasetName ?? `teleop_${sessionId.slice(0, 8)}`;

    // Resolve robotTypeId from session's robot
    const robotTypeId = await this.resolveRobotTypeIdFromSession(session.robotId);

    // Create a Dataset record so the export is visible in the UI
    const totalFrames = dbFrames.length;
    const totalDuration = session.duration ?? (totalFrames / session.fps);
    const infoJson = exportService.buildInfo(frames, episodeCount, {
      sessionFps: session.fps,
      robotType: robot?.model ?? undefined,
      jointNames: jointNames ?? undefined,
      task: session.languageInstr ?? undefined,
    });
    const datasetInput: CreateDatasetInput = {
      name: datasetName,
      description: dto.description ?? `Teleoperation: ${session.languageInstr ?? sessionId}`,
      robotTypeId,
      storagePath,
      // The export writer emits the LeRobot v3.0 chunked layout
      lerobotVersion: 'v3.0',
      fps: session.fps,
      totalFrames,
      totalDuration,
      demonstrationCount: episodeCount,
      status: 'ready',
      infoJson: infoJson as unknown as import('../types/vla.types.js').LeRobotInfo,
    };
    const dataset = await datasetRepository.create(datasetInput);

    // Persist the dataset ID on the session
    await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: { exportedDatasetId: dataset.id },
    });

    const response: ExportResultResponse = {
      sessionId,
      datasetId: dataset.id,
      datasetName,
      trajectoryCount: episodeCount,
      totalFrames,
      storagePath,
    };

    this.emitEvent({
      type: 'session:exported',
      sessionId,
      timestamp: new Date(),
    });

    return response;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  // ============================================================================
  // SIDECAR INTEGRATION HELPERS
  // ============================================================================

  /** Poller interval handles, keyed by sessionId. */
  private sidecarPollers = new Map<string, ReturnType<typeof setInterval>>();

  /** Live sim frame recorders, keyed by sessionId. */
  private simRecorders = new Map<string, SimFrameRecorder>();

  /** Progress pollers for agent-side recordings, one per live session. */
  private agentPollers = new Map<string, ReturnType<typeof setInterval>>();

  /** Latest computed quality feedback per session (attached to progress events). */
  private lastQualityFeedback = new Map<string, QualityFeedback>();

  /** Current episode index for client-posted frame sessions (no live recorder). */
  private clientEpisodeIndex = new Map<string, number>();

  /** Progress ticks per session (quality is recomputed every few ticks). */
  private progressTicks = new Map<string, number>();

  // ============================================================================
  // SIM FRAME RECORDER (frame-based sessions — sim robots without a sidecar)
  // ============================================================================

  /**
   * Start a SimFrameRecorder for a frame-based session. The recorder samples
   * robot-agent telemetry at the session FPS and persists batched frames.
   * Never throws — a recorder that can't reach the agent starts degraded and
   * keeps retrying.
   */
  private async startSimRecorder(session: TeleoperationSession): Promise<void> {
    const sessionId = session.id;

    // Idempotent: a paused session restarted via startSession resumes its recorder
    const existing = this.simRecorders.get(sessionId);
    if (existing) {
      existing.resume();
      return;
    }

    const robot = await this.prisma.robot.findUnique({ where: { id: session.robotId } });
    const agentBase = robot?.a2aAgentUrl?.replace(/\/$/, '') ?? null;
    const robotId = session.robotId;

    const fetchTelemetry = async (): Promise<RecorderTelemetry> => {
      // Prefer the RobotManager's registered-endpoint helper (lazy import to
      // keep this service testable without the full manager graph).
      try {
        const { robotManager } = await import('./RobotManager.js');
        return (await robotManager.getTelemetry(robotId)) as RecorderTelemetry;
      } catch (err) {
        if (!agentBase) {
          throw err instanceof Error ? err : new Error('Telemetry fetch failed');
        }
      }
      // Fallback: hit the agent's REST API directly via its a2aAgentUrl
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const resp = await fetch(`${agentBase}/api/v1/robots/${robotId}/telemetry`, {
          signal: controller.signal,
        });
        if (!resp.ok) {
          throw new Error(`Telemetry HTTP ${resp.status}`);
        }
        return (await resp.json()) as RecorderTelemetry;
      } finally {
        clearTimeout(timer);
      }
    };

    const persistFrames = async (frames: RecordedFrame[]): Promise<void> => {
      await this.prisma.teleoperationFrame.createMany({
        data: frames.map((f) => ({
          sessionId,
          frameIndex: f.frameIndex,
          episodeIndex: f.episodeIndex,
          timestamp: f.timestamp,
          jointPositions: f.jointPositions,
          jointVelocities: f.jointVelocities ?? undefined,
          action: f.action,
          isIntervention: f.isIntervention,
        })),
      });
      const frameCount = await this.prisma.teleoperationFrame.count({ where: { sessionId } });
      await this.prisma.teleoperationSession.update({
        where: { id: sessionId },
        data: { frameCount },
      });
    };

    // Resume support: continue frame/episode numbering from persisted frames
    const agg = await this.prisma.teleoperationFrame.aggregate({
      where: { sessionId },
      _max: { frameIndex: true, episodeIndex: true },
    });
    const initialFrameIndex = agg._max.frameIndex !== null ? agg._max.frameIndex + 1 : 0;
    const initialEpisodeIndex = agg._max.episodeIndex ?? 0;

    const recorder = new SimFrameRecorder({
      sessionId,
      fps: session.fps,
      initialFrameIndex,
      initialEpisodeIndex,
      fetchTelemetry,
      persistFrames,
      onProgress: (progress: RecorderProgress) => {
        const ticks = (this.progressTicks.get(sessionId) ?? 0) + 1;
        this.progressTicks.set(sessionId, ticks);
        this.emitEvent({
          type: 'session:progress',
          sessionId,
          recordingProgress: { ...progress },
          qualityFeedback: this.lastQualityFeedback.get(sessionId),
          timestamp: new Date(),
        });
        // Recompute quality feedback every ~3s (best-effort, async)
        if (ticks % 3 === 0 && progress.running) {
          void this.refreshQualityFeedback(sessionId);
        }
      },
      onDegraded: (message: string) => {
        this.emitEvent({
          type: 'quality:warning',
          sessionId,
          qualityFeedback: {
            sessionId,
            currentSmoothnessScore: 0,
            isJerky: false,
            warningMessage: message,
          },
          timestamp: new Date(),
        });
      },
    });

    this.simRecorders.set(sessionId, recorder);
    recorder.start();
    console.log(
      `[TeleoperationService] SimFrameRecorder started for session ${sessionId} @ ${session.fps} fps`
    );
  }

  /**
   * Recompute quality feedback from the most recent frames and emit a
   * quality warning if the motion is jerky. Best-effort — never throws.
   */
  private async refreshQualityFeedback(sessionId: string): Promise<void> {
    try {
      const recent = await this.prisma.teleoperationFrame.findMany({
        where: { sessionId },
        orderBy: { frameIndex: 'desc' },
        take: 1,
      });
      if (recent.length === 0) return;
      const last = recent[0];
      const feedback = await this.computeQualityFeedback(sessionId, {
        timestamp: last.timestamp,
        jointPositions: last.jointPositions as number[],
        jointVelocities: (last.jointVelocities as number[] | null) ?? undefined,
        action: last.action as number[],
      });
      this.lastQualityFeedback.set(sessionId, feedback);
      if (feedback.isJerky || feedback.warningMessage) {
        this.emitEvent({
          type: 'quality:warning',
          sessionId,
          qualityFeedback: feedback,
          timestamp: new Date(),
        });
      }
    } catch {
      /* quality feedback is best-effort */
    }
  }

  /**
   * Derive the sidecar URL from a robot's A2A agent URL.
   * Sidecar always runs on port 8765 on the same host as the agent.
   * Returns null if the robot has no a2aAgentUrl.
   */
  private async resolveSidecarUrl(robotId: string): Promise<string | null> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot?.a2aAgentUrl) return null;
    try {
      const url = new URL(robot.a2aAgentUrl);
      return `http://${url.hostname}:8765`;
    } catch {
      return null;
    }
  }

  /**
   * Best-effort: fetch a telemetry snapshot to learn the robot's joint names
   * for the LeRobot export metadata. Returns null if the agent is unreachable.
   */
  private async resolveJointNames(
    robotId: string,
    a2aAgentUrl: string | null
  ): Promise<string[] | null> {
    if (!a2aAgentUrl) return null;
    const base = a2aAgentUrl.replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const resp = await fetch(`${base}/api/v1/robots/${robotId}/telemetry`, {
        signal: controller.signal,
      });
      if (!resp.ok) return null;
      const telemetry = (await resp.json()) as RecorderTelemetry;
      const names = (telemetry.jointStates ?? []).map((j) => j.name);
      return names.length > 0 ? names : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Poll sidecar /record/status every 2s and broadcast progress via events.
   */
  /**
   * Poll the robot's recorder so the session page shows live frame counts,
   * drops and the rate actually being achieved.
   *
   * Every other progress source in this service is push (the sim recorder calls
   * back, the sidecar poller reads a status file). The agent has to be asked,
   * and asking is cheap: the route reads counters the recorder keeps anyway,
   * and it is the only place `behind_s` is refreshed — the tick must not spend
   * its budget asking the sim how it is feeling.
   */
  private startAgentProgressPoller(sessionId: string, robotId: string): void {
    this.stopAgentProgressPoller(sessionId);
    const timer = setInterval(() => {
      void (async () => {
        const status = await agentRecordingService.status(robotId).catch(() => null);
        if (!status) return;
        this.emitEvent({
          type: 'session:progress',
          sessionId,
          recordingProgress: {
            frameCount: status.totalFrames,
            currentEpisode: status.episodeIndex,
            episodesDone: Math.max(0, status.episodes.length - 1),
            fpsActual: status.fpsActual,
            running: status.recording,
            degraded: status.degraded,
          },
          timestamp: new Date(),
        });
        if (status.degraded && status.lastDropReason) {
          this.emitEvent({
            type: 'quality:warning',
            sessionId,
            message: `Recording is dropping frames: ${status.lastDropReason}`,
            timestamp: new Date(),
          });
        }
      })();
    }, AGENT_PROGRESS_POLL_MS);
    timer.unref?.();
    this.agentPollers.set(sessionId, timer);
  }

  private stopAgentProgressPoller(sessionId: string): void {
    const timer = this.agentPollers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.agentPollers.delete(sessionId);
    }
  }

  /**
   * Write what the recorder reported about each episode.
   *
   * Upserted rather than created: a session that is ended twice, or one whose
   * summaries were already written by a previous stop attempt, must not blow up
   * on the unique index — and the second report is the more complete one.
   */
  private async persistEpisodeSummaries(
    sessionId: string,
    episodes: AgentEpisodeReport[]
  ): Promise<void> {
    for (const ep of episodes) {
      try {
        await this.prisma.teleoperationEpisode.upsert({
          where: { sessionId_episodeIndex: { sessionId, episodeIndex: ep.episodeIndex } },
          create: {
            sessionId,
            episodeIndex: ep.episodeIndex,
            frameCount: ep.frames,
            droppedFrames: ep.dropped,
            durationS: ep.durationS,
            fpsActual: ep.fpsActual,
            retargetModes: joinModes(ep.retargetModes),
          },
          update: {
            frameCount: ep.frames,
            droppedFrames: ep.dropped,
            durationS: ep.durationS,
            fpsActual: ep.fpsActual,
            retargetModes: joinModes(ep.retargetModes),
          },
        });
      } catch (err) {
        console.error(
          `[TeleoperationService] could not persist episode ${ep.episodeIndex} of ${sessionId}:`,
          err
        );
      }
    }
  }

  /**
   * Register a dataset the robot wrote, by path, with provenance.
   *
   * `DatasetService.create()` is deliberately not used: it mints its own
   * storagePath and zeroes fps/frames/duration, which is right for an empty
   * dataset somebody is about to upload into and wrong for one that already
   * exists on disk. `datasetRepository.create()` takes what it is given, and is
   * the same door `exportToLeRobot` and the sidecar path already use.
   */
  private async registerAgentDataset(
    session: TeleoperationSession,
    result: NonNullable<Awaited<ReturnType<typeof agentRecordingService.stop>>>,
    durationS: number
  ): Promise<string | null> {
    if (!result.datasetPath) return null;
    const robotTypeId = await this.resolveRobotTypeIdFromSession(session.robotId);

    // Read the info.json the robot just wrote, so the Datasets page shows the
    // real feature list — including whether there is video at all, which is the
    // one thing that decides whether this dataset can train a VLA.
    let infoJson: Record<string, unknown> = {};
    try {
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      infoJson = JSON.parse(await readFile(join(result.datasetPath, 'meta', 'info.json'), 'utf-8'));
    } catch {
      // A robot on another host: the path is real there and unreadable here.
      // The row is still worth having — it names where the data is.
      console.log(
        `[TeleoperationService] ${result.datasetPath} is not readable from the server; ` +
          'registering the dataset without its info.json'
      );
    }

    const name =
      session.datasetRepoId ??
      session.languageInstr?.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) ??
      `teleop-${session.id.slice(0, 8)}`;

    const dataset = await datasetRepository.create({
      name,
      description:
        `Teleoperation in simulation: ${session.languageInstr ?? session.id}` +
        (result.scene ? ` (${result.scene})` : ''),
      robotTypeId,
      storagePath: result.datasetPath,
      lerobotVersion: 'v3.0',
      fps: Math.round(result.fpsActual) || session.fps,
      totalFrames: result.totalFrames,
      totalDuration: durationS,
      demonstrationCount: result.totalEpisodes,
      status: 'ready',
      infoJson: infoJson as import('../types/vla.types.js').LeRobotInfo,
    });

    // The DatasetProvenance model has existed since the EU AI Act work and
    // nothing had ever written one. A simulation-derived dataset is exactly the
    // case the column list was designed for: an auditor asking "where did this
    // training data come from" gets the scene file, the sim boot it was
    // recorded under, and the operator who drove it.
    try {
      const { trainingDataDocService } = await import('./TrainingDataDocService.js');
      await trainingDataDocService.recordProvenance(
        dataset.id,
        {
          sourceType: 'collected',
          sourceName: result.scene ? `MuJoCo sim — ${result.scene}` : 'MuJoCo sim',
          collectionMethod:
            `Teleoperation (${session.type}) recorded on the robot agent at ` +
            `${result.fpsActual} fps, ${result.totalDropped} dropped frames, ` +
            `cameras: ${result.videoFeatures.join(', ') || 'none'}` +
            // The sim boot belongs here, with the rest of how the data was
            // collected. It was in `copyrightCompliance`, which an EU AI Act
            // report renders under a heading about rights clearance — a
            // reviewer reading "Simulation boot 585f1c…" there learns nothing
            // and mistrusts the field.
            (result.bootId ? `, simulation boot ${result.bootId}` : ''),
          collectionPeriod: {
            start: (session.startedAt ?? new Date()).toISOString(),
            end: new Date().toISOString(),
          },
          labelingProcedure: session.languageInstr
            ? `Single task instruction: "${session.languageInstr}"`
            : 'No task instruction was given',
          annotatorInfo: `Operator ${session.operatorId}`,
          cleaningSteps: [
            'Frames the recorder could not complete were dropped, not interpolated',
            'Episodes discarded by the operator were removed before the dataset was written',
          ],
          copyrightCompliance:
            'Simulation-derived: no third-party material, no recorded persons.',
        },
        session.operatorId
      );
    } catch (err) {
      console.error('[TeleoperationService] recording provenance failed:', err);
    }

    console.log(`[TeleoperationService] registered dataset ${dataset.id} at ${result.datasetPath}`);
    return dataset.id;
  }

  private startSidecarProgressPoller(sessionId: string, sidecarUrl: string): void {
    if (this.sidecarPollers.has(sessionId)) return;

    const poller = setInterval(async () => {
      try {
        const resp = await fetch(`${sidecarUrl}/record/status`);
        const status = await resp.json() as {
          running?: boolean;
          episodes_done?: number;
          current_episode?: number;
          elapsed_s?: number;
        };

        this.emitEvent({
          type: 'session:progress',
          sessionId,
          timestamp: new Date(),
          recordingProgress: {
            episodesDone: status.episodes_done ?? 0,
            currentEpisode: status.current_episode ?? 0,
            elapsedS: status.elapsed_s ?? 0,
            running: status.running ?? false,
          },
        });

        // Auto-stop polling if recording finished
        if (!status.running) {
          this.stopSidecarProgressPoller(sessionId);
        }
      } catch {
        // Sidecar unreachable — stop polling
        this.stopSidecarProgressPoller(sessionId);
      }
    }, 2000);

    this.sidecarPollers.set(sessionId, poller);
  }

  /**
   * Stop the sidecar progress poller for a session.
   */
  private stopSidecarProgressPoller(sessionId: string): void {
    const poller = this.sidecarPollers.get(sessionId);
    if (poller) {
      clearInterval(poller);
      this.sidecarPollers.delete(sessionId);
    }
  }

  /**
   * Poll sidecar /record/status until upload_status is 'done' or 'error'.
   * Returns the S3 path if successful, null otherwise.
   */
  private async waitForSidecarUpload(sidecarUrl: string, timeoutMs: number): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`${sidecarUrl}/record/status`);
        const status = await resp.json() as {
          running?: boolean;
          upload_status?: string;
          s3_path?: string;
          upload_result?: { s3_path?: string; ok?: boolean };
        };
        const uploadStatus = status.upload_status ?? 'idle';
        if (uploadStatus === 'done' && status.upload_result?.s3_path) {
          console.log(`[TeleoperationService] Upload complete: ${status.upload_result.s3_path}`);
          return status.upload_result.s3_path;
        }
        if (uploadStatus === 'error') {
          console.error('[TeleoperationService] Upload failed on sidecar');
          return null;
        }
        // If recording stopped and upload never started, bail early
        if (uploadStatus === 'idle' && !status.running) {
          console.log('[TeleoperationService] Recording done but no upload started');
          return status.s3_path ?? null;
        }
        // Still uploading — wait 2s
        await new Promise((r) => setTimeout(r, 2000));
      } catch {
        return null;
      }
    }
    console.warn('[TeleoperationService] Upload timed out');
    return null;
  }

  /**
   * Resolve a robotTypeId from a session's robotId.
   * Looks up the Robot, then matches its model name to existing RobotType entries.
   * Falls back to creating a new RobotType if no match is found.
   */
  async resolveRobotTypeIdFromSession(robotId: string): Promise<string> {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    const robotModel = robot?.model ?? 'unknown';

    const all = await robotTypeRepository.findAll();
    const lower = robotModel.toLowerCase().replace(/[_\-\s]/g, '');

    const matchers: Array<{ pattern: RegExp; name: string }> = [
      { pattern: /so10[01]/, name: 'SO-101 Follower' },
      { pattern: /aloha/, name: 'ALOHA' },
      { pattern: /pusht/, name: 'PushT Sim' },
      { pattern: /g1|dex3|unitree/, name: 'Unitree G1 + Dex3' },
    ];

    for (const { pattern, name } of matchers) {
      if (pattern.test(lower)) {
        const found = all.find((rt) => rt.name === name);
        if (found) return found.id;
      }
    }

    const exactMatch = all.find((rt) => rt.name.toLowerCase() === robotModel.toLowerCase());
    if (exactMatch) return exactMatch.id;

    // No match — create a new RobotType on-the-fly
    const created = await robotTypeRepository.create({
      name: robotModel,
      manufacturer: 'Unknown',
      model: robotModel,
      actionDim: 0,
      proprioceptionDim: 0,
    });
    console.log(`[TeleoperationService] Created new RobotType for "${robotModel}": ${created.id}`);
    return created.id;
  }

  /**
   * Convert to session response
   */
  private toSessionResponse(session: TeleoperationSession): SessionResponse {
    return {
      id: session.id,
      operatorId: session.operatorId,
      robotId: session.robotId,
      type: session.type,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      frameCount: session.frameCount,
      duration: session.duration,
      fps: session.fps,
      languageInstr: session.languageInstr,
      qualityScore: session.qualityScore,
      exportedDatasetId: session.exportedDatasetId,
      errorMessage: session.errorMessage,
      numEpisodes: session.numEpisodes ?? null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Emit teleoperation event
   */
  private emitEvent(event: TeleoperationEvent): void {
    this.emit('teleoperation:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const teleoperationService = TeleoperationService.getInstance();
