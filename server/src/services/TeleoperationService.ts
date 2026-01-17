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

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_FPS = 30;
const MAX_BATCH_SIZE = 100;

// ============================================================================
// TELEOPERATION SERVICE
// ============================================================================

/**
 * Service for teleoperation session management and data collection
 */
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
   * Start recording a session
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

    const updated = await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: {
        status: 'recording',
        startedAt: session.startedAt ?? new Date(),
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
   * End recording session
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

    const endedAt = new Date();
    const duration = session.startedAt
      ? (endedAt.getTime() - session.startedAt.getTime()) / 1000
      : 0;

    const qualityScore = await this.computeSessionQuality(sessionId);

    const updated = await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        endedAt,
        duration,
        qualityScore,
      },
    });

    this.emitEvent({
      type: 'session:completed',
      sessionId,
      session: this.toSessionResponse(updated as TeleoperationSession),
      timestamp: new Date(),
    });

    return this.toSessionResponse(updated as TeleoperationSession);
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

    const frameData = dto.frames.map((f, i) => ({
      sessionId,
      frameIndex: firstIndex + i,
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
   * Export session to LeRobot v3 format (stub)
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

    const frameCount = await this.prisma.teleoperationFrame.count({
      where: { sessionId },
    });

    if (frameCount === 0) {
      throw new Error('Cannot export session with no frames');
    }

    // Stub response - full implementation would convert to parquet and upload to RustFS
    const datasetId = crypto.randomUUID();
    const datasetName = dto.datasetName ?? `teleop_${sessionId.slice(0, 8)}`;
    const storagePath = `datasets/${datasetId}/`;

    await this.prisma.teleoperationSession.update({
      where: { id: sessionId },
      data: { exportedDatasetId: datasetId },
    });

    const response: ExportResultResponse = {
      sessionId,
      datasetId,
      datasetName,
      trajectoryCount: 1,
      totalFrames: frameCount,
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
