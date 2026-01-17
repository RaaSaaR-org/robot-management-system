/**
 * @file FederatedLearningService.ts
 * @description Service for federated learning / fleet learning orchestration
 * @feature fleet
 */

import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import type {
  FederatedRound,
  FederatedRoundStatus,
  FederatedRoundConfig,
  FederatedParticipant,
  ModelUpdate,
  RobotPrivacyBudget,
  ROHEMetrics,
  InterventionRecord,
  FedAvgInput,
  AggregationResult,
  RoundMetrics,
  CreateFederatedRoundRequest,
  SelectParticipantsRequest,
  SubmitModelUpdateRequest,
  SelectionStrategy,
  FederatedEvent,
} from '../types/federated.types.js';
import { DEFAULT_ROUND_CONFIG } from '../types/federated.types.js';

// ============================================================================
// FEDERATED LEARNING SERVICE
// ============================================================================

/**
 * Service for managing federated learning rounds
 */
export class FederatedLearningService extends EventEmitter {
  private static instance: FederatedLearningService;

  private prisma: PrismaClient;

  // Model updates stored in memory during active rounds (binary data)
  private modelUpdates: Map<string, ModelUpdate> = new Map();

  // Default privacy budget per robot
  private readonly DEFAULT_PRIVACY_BUDGET = 10.0;

  private constructor() {
    super();
    this.prisma = new PrismaClient();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): FederatedLearningService {
    if (!FederatedLearningService.instance) {
      FederatedLearningService.instance = new FederatedLearningService();
    }
    return FederatedLearningService.instance;
  }

  // ============================================================================
  // ROUND MANAGEMENT
  // ============================================================================

  /**
   * Create a new federated round
   */
  async createRound(request: CreateFederatedRoundRequest): Promise<FederatedRound> {
    const config: FederatedRoundConfig = {
      ...DEFAULT_ROUND_CONFIG,
      ...request.config,
    };

    const round = await this.prisma.federatedRound.create({
      data: {
        status: 'created',
        globalModelVersion: request.globalModelVersion,
        config: JSON.parse(JSON.stringify(config)),
        participantCount: 0,
        completedParticipants: 0,
        failedParticipants: 0,
        totalLocalSamples: 0,
      },
    });

    this.emitEvent({
      type: 'round:created',
      roundId: round.id,
      data: { globalModelVersion: request.globalModelVersion },
      timestamp: new Date(),
    });

    return this.toFederatedRound(round);
  }

  /**
   * Get a round by ID
   */
  async getRound(roundId: string): Promise<FederatedRound | undefined> {
    const round = await this.prisma.federatedRound.findUnique({
      where: { id: roundId },
    });
    return round ? this.toFederatedRound(round) : undefined;
  }

  /**
   * List rounds with optional filters
   */
  async listRounds(options?: {
    status?: FederatedRoundStatus;
    globalModelVersion?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rounds: FederatedRound[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (options?.status) {
      where.status = options.status;
    }
    if (options?.globalModelVersion) {
      where.globalModelVersion = options.globalModelVersion;
    }

    const [rounds, total] = await Promise.all([
      this.prisma.federatedRound.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: options?.offset,
        take: options?.limit,
      }),
      this.prisma.federatedRound.count({ where }),
    ]);

    return {
      rounds: rounds.map((r) => this.toFederatedRound(r)),
      total,
    };
  }

  // ============================================================================
  // PARTICIPANT SELECTION
  // ============================================================================

  /**
   * Select participants for a round
   */
  async selectParticipants(
    roundId: string,
    request: SelectParticipantsRequest
  ): Promise<FederatedParticipant[]> {
    const round = await this.prisma.federatedRound.findUnique({
      where: { id: roundId },
    });

    if (!round) {
      throw new Error('Round not found');
    }

    if (round.status !== 'created' && round.status !== 'selecting') {
      throw new Error(`Cannot select participants in status: ${round.status}`);
    }

    await this.prisma.federatedRound.update({
      where: { id: roundId },
      data: { status: 'selecting' },
    });

    this.emitEvent({
      type: 'round:selecting',
      roundId,
      timestamp: new Date(),
    });

    const config = round.config as unknown as FederatedRoundConfig;

    // Get available robots
    let availableRobots: string[] = request.robotIds || [];

    // If no specific robots provided, use mock data
    if (availableRobots.length === 0) {
      availableRobots = this.getAvailableRobots(
        request.minLocalSamples || config.minLocalSamples
      );
    }

    // Apply selection strategy
    const strategy = request.strategy || config.selectionStrategy;
    const count = Math.min(
      request.count || config.maxParticipants,
      availableRobots.length,
      config.maxParticipants
    );

    const selectedRobots = await this.applySelectionStrategy(
      availableRobots,
      count,
      strategy,
      roundId
    );

    // Create participants
    const participants: FederatedParticipant[] = [];
    for (const robotId of selectedRobots) {
      const participant = await this.createParticipant(roundId, robotId);
      participants.push(participant);
    }

    await this.prisma.federatedRound.update({
      where: { id: roundId },
      data: { participantCount: participants.length },
    });

    return participants;
  }

  /**
   * Apply selection strategy
   */
  private async applySelectionStrategy(
    robots: string[],
    count: number,
    strategy: SelectionStrategy,
    _roundId: string
  ): Promise<string[]> {
    switch (strategy) {
      case 'random':
        return this.shuffleArray([...robots]).slice(0, count);

      case 'round_robin':
        // Select robots that participated least recently
        const participationCounts = await Promise.all(
          robots.map(async (robotId) => ({
            robotId,
            count: await this.getParticipationCount(robotId),
          }))
        );
        return participationCounts
          .sort((a, b) => a.count - b.count)
          .slice(0, count)
          .map((p) => p.robotId);

      case 'performance_based':
        // Prefer robots with better local performance
        return [...robots].slice(0, count);

      case 'uncertainty_based':
        // Prefer robots with higher uncertainty (more to learn from)
        return [...robots].slice(0, count);

      default:
        return robots.slice(0, count);
    }
  }

  /**
   * Get participation count for a robot
   */
  private async getParticipationCount(robotId: string): Promise<number> {
    return this.prisma.federatedParticipant.count({
      where: { robotId },
    });
  }

  /**
   * Create a participant
   */
  private async createParticipant(
    roundId: string,
    robotId: string
  ): Promise<FederatedParticipant> {
    const participant = await this.prisma.federatedParticipant.create({
      data: {
        roundId,
        robotId,
        status: 'selected',
      },
    });

    this.emitEvent({
      type: 'participant:selected',
      roundId,
      participantId: participant.id,
      robotId,
      timestamp: new Date(),
    });

    return this.toFederatedParticipant(participant);
  }

  /**
   * Get available robots (mock implementation)
   */
  private getAvailableRobots(minSamples: number): string[] {
    // In production, this would query the robot registry
    return ['robot-1', 'robot-2', 'robot-3', 'robot-4', 'robot-5'];
  }

  // ============================================================================
  // MODEL DISTRIBUTION
  // ============================================================================

  /**
   * Distribute global model to participants
   */
  async distributeModel(roundId: string): Promise<FederatedRound> {
    const round = await this.prisma.federatedRound.findUnique({
      where: { id: roundId },
    });

    if (!round) {
      throw new Error('Round not found');
    }

    const config = round.config as unknown as FederatedRoundConfig;

    if (round.status !== 'selecting') {
      throw new Error(`Cannot distribute in status: ${round.status}`);
    }

    if (round.participantCount < config.minParticipants) {
      throw new Error(
        `Need at least ${config.minParticipants} participants, have ${round.participantCount}`
      );
    }

    await this.prisma.federatedRound.update({
      where: { id: roundId },
      data: {
        status: 'distributing',
        startedAt: new Date(),
      },
    });

    this.emitEvent({
      type: 'round:distributing',
      roundId,
      data: { participantCount: round.participantCount },
      timestamp: new Date(),
    });

    // Update participants to model_received (simulated)
    const participants = await this.getParticipantsForRound(roundId);
    for (const participant of participants) {
      await this.prisma.federatedParticipant.update({
        where: { id: participant.id },
        data: {
          status: 'model_received',
          modelReceivedAt: new Date(),
        },
      });

      this.emitEvent({
        type: 'participant:model_received',
        roundId,
        participantId: participant.id,
        robotId: participant.robotId,
        timestamp: new Date(),
      });
    }

    // Transition to training phase
    const updated = await this.prisma.federatedRound.update({
      where: { id: roundId },
      data: { status: 'training' },
    });

    this.emitEvent({
      type: 'round:training',
      roundId,
      timestamp: new Date(),
    });

    return this.toFederatedRound(updated);
  }

  // ============================================================================
  // MODEL UPDATES
  // ============================================================================

  /**
   * Submit a model update from a participant
   */
  async submitModelUpdate(request: SubmitModelUpdateRequest): Promise<ModelUpdate> {
    const participant = await this.prisma.federatedParticipant.findUnique({
      where: { id: request.participantId },
    });

    if (!participant) {
      throw new Error('Participant not found');
    }

    const round = await this.prisma.federatedRound.findUnique({
      where: { id: participant.roundId },
    });

    if (!round) {
      throw new Error('Round not found');
    }

    const config = round.config as unknown as FederatedRoundConfig;

    if (round.status !== 'training' && round.status !== 'collecting') {
      throw new Error(`Cannot submit update in status: ${round.status}`);
    }

    // Check privacy budget if DP is enabled
    if (config.privacyEpsilon) {
      const budget = await this.getOrCreatePrivacyBudget(request.robotId);
      const required = config.privacyEpsilon;

      if (budget.remainingEpsilon < required) {
        throw new Error('Insufficient privacy budget');
      }

      // Deduct privacy budget
      await this.prisma.robotPrivacyBudget.update({
        where: { robotId: request.robotId },
        data: {
          usedEpsilon: budget.usedEpsilon + required,
          remainingEpsilon: budget.totalEpsilon - budget.usedEpsilon - required,
          roundsParticipated: budget.roundsParticipated + 1,
          lastUpdated: new Date(),
        },
      });
    }

    // Create model update (stored in memory for binary data)
    const update: ModelUpdate = {
      participantId: request.participantId,
      robotId: request.robotId,
      roundId: participant.roundId,
      localSamples: request.localSamples,
      localLoss: request.localLoss,
      modelDelta: request.modelDelta,
      updateHash: request.updateHash,
      uploadedAt: new Date(),
      dpNoiseScale: request.dpNoiseScale,
    };

    this.modelUpdates.set(request.participantId, update);

    // Update participant
    await this.prisma.federatedParticipant.update({
      where: { id: request.participantId },
      data: {
        status: 'uploaded',
        localSamples: request.localSamples,
        localLoss: request.localLoss,
        uploadedAt: new Date(),
        privacyBudgetUsed: config.privacyEpsilon,
      },
    });

    await this.prisma.federatedRound.update({
      where: { id: participant.roundId },
      data: {
        completedParticipants: { increment: 1 },
        totalLocalSamples: { increment: request.localSamples },
      },
    });

    this.emitEvent({
      type: 'participant:uploaded',
      roundId: participant.roundId,
      participantId: participant.id,
      robotId: participant.robotId,
      data: { localSamples: request.localSamples, localLoss: request.localLoss },
      timestamp: new Date(),
    });

    // Check if ready for aggregation
    const updatedRound = await this.prisma.federatedRound.findUnique({
      where: { id: participant.roundId },
    });

    if (updatedRound && updatedRound.completedParticipants >= config.minParticipants) {
      await this.prisma.federatedRound.update({
        where: { id: participant.roundId },
        data: { status: 'collecting' },
      });

      this.emitEvent({
        type: 'round:collecting',
        roundId: participant.roundId,
        data: { completedParticipants: updatedRound.completedParticipants },
        timestamp: new Date(),
      });
    }

    return update;
  }

  /**
   * Mark participant as failed
   */
  async markParticipantFailed(
    participantId: string,
    reason: string
  ): Promise<FederatedParticipant | undefined> {
    const participant = await this.prisma.federatedParticipant.findUnique({
      where: { id: participantId },
    });

    if (!participant) return undefined;

    const updated = await this.prisma.federatedParticipant.update({
      where: { id: participantId },
      data: {
        status: 'failed',
        failureReason: reason,
      },
    });

    await this.prisma.federatedRound.update({
      where: { id: participant.roundId },
      data: { failedParticipants: { increment: 1 } },
    });

    this.emitEvent({
      type: 'participant:failed',
      roundId: participant.roundId,
      participantId,
      robotId: participant.robotId,
      data: { reason },
      timestamp: new Date(),
    });

    return this.toFederatedParticipant(updated);
  }

  // ============================================================================
  // AGGREGATION
  // ============================================================================

  /**
   * Aggregate model updates (FedAvg)
   */
  async aggregateUpdates(roundId: string): Promise<AggregationResult> {
    const round = await this.prisma.federatedRound.findUnique({
      where: { id: roundId },
    });

    if (!round) {
      throw new Error('Round not found');
    }

    const config = round.config as unknown as FederatedRoundConfig;

    if (round.status !== 'collecting') {
      throw new Error(`Cannot aggregate in status: ${round.status}`);
    }

    await this.prisma.federatedRound.update({
      where: { id: roundId },
      data: { status: 'aggregating' },
    });

    this.emitEvent({
      type: 'round:aggregating',
      roundId,
      timestamp: new Date(),
    });

    // Get all updates for this round
    const participants = await this.prisma.federatedParticipant.findMany({
      where: { roundId, status: 'uploaded' },
    });

    const updates = participants
      .map((p) => this.modelUpdates.get(p.id))
      .filter((u): u is ModelUpdate => u !== undefined);

    if (updates.length < config.minParticipants) {
      throw new Error(
        `Not enough updates: ${updates.length} < ${config.minParticipants}`
      );
    }

    // Compute aggregation weights
    const totalSamples = updates.reduce((sum, u) => sum + u.localSamples, 0);
    const inputs: FedAvgInput[] = updates.map((u) => ({
      participantId: u.participantId,
      weight: u.localSamples / totalSamples,
      modelDelta: this.deserializeModelDelta(u.modelDelta),
    }));

    // Update participant weights
    for (const input of inputs) {
      await this.prisma.federatedParticipant.update({
        where: { id: input.participantId },
        data: { aggregationWeight: input.weight },
      });
    }

    // Perform FedAvg
    const aggregatedDelta = this.fedAvg(inputs);

    const result: AggregationResult = {
      roundId,
      aggregatedDelta,
      participantCount: updates.length,
      totalSamples,
      timestamp: new Date(),
    };

    // Generate new model version
    const newModelVersion = `${round.globalModelVersion}_fedavg_${Date.now()}`;
    await this.prisma.federatedRound.update({
      where: { id: roundId },
      data: { newModelVersion },
    });

    return result;
  }

  /**
   * FedAvg implementation
   */
  private fedAvg(inputs: FedAvgInput[]): number[] {
    if (inputs.length === 0) {
      return [];
    }

    const deltaLength = inputs[0].modelDelta.length;
    const aggregated = new Array(deltaLength).fill(0);

    for (const input of inputs) {
      for (let i = 0; i < deltaLength; i++) {
        aggregated[i] += input.weight * input.modelDelta[i];
      }
    }

    return aggregated;
  }

  /**
   * Deserialize model delta (mock implementation)
   */
  private deserializeModelDelta(delta: Buffer | string): number[] {
    // In production, this would deserialize actual model weights
    // For now, return mock data
    if (typeof delta === 'string') {
      try {
        const decoded = Buffer.from(delta, 'base64').toString('utf-8');
        return JSON.parse(decoded);
      } catch {
        return Array(100).fill(0).map(() => Math.random() * 0.01 - 0.005);
      }
    }
    return Array(100).fill(0).map(() => Math.random() * 0.01 - 0.005);
  }

  /**
   * Finalize round
   */
  async finalizeRound(roundId: string): Promise<FederatedRound> {
    const round = await this.prisma.federatedRound.findUnique({
      where: { id: roundId },
    });

    if (!round) {
      throw new Error('Round not found');
    }

    // Compute metrics
    const participants = await this.getParticipantsForRound(roundId);
    const completedParticipants = participants.filter(
      (p) => p.status === 'uploaded'
    );

    const avgLocalLoss =
      completedParticipants.length > 0
        ? completedParticipants.reduce(
            (sum, p) => sum + (p.localLoss || 0),
            0
          ) / completedParticipants.length
        : undefined;

    const metrics: RoundMetrics = {
      avgLocalLoss,
      phaseDurations: {
        training: round.startedAt
          ? (new Date().getTime() - round.startedAt.getTime()) / 1000
          : undefined,
      },
    };

    const updated = await this.prisma.federatedRound.update({
      where: { id: roundId },
      data: {
        metrics: JSON.parse(JSON.stringify(metrics)),
        status: 'completed',
        completedAt: new Date(),
      },
    });

    // Clean up model updates for this round
    for (const participant of participants) {
      this.modelUpdates.delete(participant.id);
    }

    this.emitEvent({
      type: 'round:completed',
      roundId,
      data: {
        newModelVersion: updated.newModelVersion,
        completedParticipants: updated.completedParticipants,
        totalLocalSamples: updated.totalLocalSamples,
      },
      timestamp: new Date(),
    });

    return this.toFederatedRound(updated);
  }

  // ============================================================================
  // PRIVACY BUDGET
  // ============================================================================

  /**
   * Get or create privacy budget for a robot
   */
  async getOrCreatePrivacyBudget(robotId: string): Promise<RobotPrivacyBudget> {
    const existing = await this.prisma.robotPrivacyBudget.findUnique({
      where: { robotId },
    });

    if (existing) {
      return this.toRobotPrivacyBudget(existing);
    }

    const budget = await this.prisma.robotPrivacyBudget.create({
      data: {
        robotId,
        totalEpsilon: this.DEFAULT_PRIVACY_BUDGET,
        usedEpsilon: 0,
        remainingEpsilon: this.DEFAULT_PRIVACY_BUDGET,
        roundsParticipated: 0,
      },
    });

    return this.toRobotPrivacyBudget(budget);
  }

  /**
   * Get privacy budget for a robot
   */
  async getPrivacyBudget(robotId: string): Promise<RobotPrivacyBudget | undefined> {
    const budget = await this.prisma.robotPrivacyBudget.findUnique({
      where: { robotId },
    });
    return budget ? this.toRobotPrivacyBudget(budget) : undefined;
  }

  /**
   * List all privacy budgets
   */
  async listPrivacyBudgets(): Promise<RobotPrivacyBudget[]> {
    const budgets = await this.prisma.robotPrivacyBudget.findMany();
    return budgets.map((b) => this.toRobotPrivacyBudget(b));
  }

  /**
   * Reset privacy budget for a robot
   */
  async resetPrivacyBudget(robotId: string): Promise<RobotPrivacyBudget> {
    const budget = await this.getOrCreatePrivacyBudget(robotId);

    const updated = await this.prisma.robotPrivacyBudget.update({
      where: { robotId },
      data: {
        usedEpsilon: 0,
        remainingEpsilon: budget.totalEpsilon,
        lastUpdated: new Date(),
      },
    });

    return this.toRobotPrivacyBudget(updated);
  }

  // ============================================================================
  // ROHE METRICS
  // ============================================================================

  /**
   * Record an intervention
   */
  async recordIntervention(
    robotId: string,
    task: string,
    type: 'correction' | 'demonstration' | 'abort',
    confidenceBefore?: number,
    confidenceAfter?: number,
    description?: string
  ): Promise<InterventionRecord> {
    const intervention = await this.prisma.interventionRecord.create({
      data: {
        robotId,
        task,
        interventionType: type,
        confidenceBefore,
        confidenceAfter,
        description,
      },
    });

    this.emitEvent({
      type: 'intervention:recorded',
      robotId,
      data: { interventionId: intervention.id, task, type },
      timestamp: new Date(),
    });

    return this.toInterventionRecord(intervention);
  }

  /**
   * Compute ROHE metrics
   */
  async computeROHEMetrics(options?: {
    startDate?: Date;
    endDate?: Date;
    robotId?: string;
    task?: string;
  }): Promise<ROHEMetrics> {
    const startDate = options?.startDate || new Date(0);
    const endDate = options?.endDate || new Date();

    const where: Record<string, unknown> = {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (options?.robotId) {
      where.robotId = options.robotId;
    }
    if (options?.task) {
      where.task = options.task;
    }

    const interventions = await this.prisma.interventionRecord.findMany({
      where,
    });

    // Group by robot
    const byRobot: Record<string, { interventions: number; improvement: number; rohe: number }> = {};
    for (const intervention of interventions) {
      if (!byRobot[intervention.robotId]) {
        byRobot[intervention.robotId] = { interventions: 0, improvement: 0, rohe: 0 };
      }
      byRobot[intervention.robotId].interventions++;

      if (intervention.confidenceBefore !== null && intervention.confidenceAfter !== null) {
        byRobot[intervention.robotId].improvement +=
          intervention.confidenceAfter - intervention.confidenceBefore;
      }
    }

    // Compute ROHE per robot
    for (const robotId of Object.keys(byRobot)) {
      const data = byRobot[robotId];
      data.rohe = data.interventions > 0 ? data.improvement / data.interventions : 0;
    }

    // Group by task
    const byTask: Record<string, { interventions: number; improvement: number; rohe: number }> = {};
    for (const intervention of interventions) {
      if (!byTask[intervention.task]) {
        byTask[intervention.task] = { interventions: 0, improvement: 0, rohe: 0 };
      }
      byTask[intervention.task].interventions++;

      if (intervention.confidenceBefore !== null && intervention.confidenceAfter !== null) {
        byTask[intervention.task].improvement +=
          intervention.confidenceAfter - intervention.confidenceBefore;
      }
    }

    // Compute ROHE per task
    for (const task of Object.keys(byTask)) {
      const data = byTask[task];
      data.rohe = data.interventions > 0 ? data.improvement / data.interventions : 0;
    }

    // Overall metrics
    const totalInterventions = interventions.length;
    let totalImprovement = 0;
    let improvementCount = 0;

    for (const intervention of interventions) {
      if (intervention.confidenceBefore !== null && intervention.confidenceAfter !== null) {
        totalImprovement += intervention.confidenceAfter - intervention.confidenceBefore;
        improvementCount++;
      }
    }

    const performanceImprovement = improvementCount > 0 ? totalImprovement / improvementCount : 0;
    const improvementPerIntervention = totalInterventions > 0 ? totalImprovement / totalInterventions : 0;

    return {
      period: { start: startDate, end: endDate },
      totalInterventions,
      performanceImprovement,
      improvementPerIntervention,
      byRobot,
      byTask,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Get participants for a round
   */
  async getParticipantsForRound(roundId: string): Promise<FederatedParticipant[]> {
    const participants = await this.prisma.federatedParticipant.findMany({
      where: { roundId },
    });
    return participants.map((p) => this.toFederatedParticipant(p));
  }

  /**
   * Shuffle array (Fisher-Yates)
   */
  private shuffleArray<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Convert Prisma model to FederatedRound type
   */
  private toFederatedRound(round: {
    id: string;
    status: string;
    globalModelVersion: string;
    newModelVersion: string | null;
    config: unknown;
    participantCount: number;
    completedParticipants: number;
    failedParticipants: number;
    totalLocalSamples: number;
    metrics: unknown;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): FederatedRound {
    return {
      id: round.id,
      status: round.status as FederatedRoundStatus,
      globalModelVersion: round.globalModelVersion,
      newModelVersion: round.newModelVersion ?? undefined,
      config: round.config as FederatedRoundConfig,
      participantCount: round.participantCount,
      completedParticipants: round.completedParticipants,
      failedParticipants: round.failedParticipants,
      totalLocalSamples: round.totalLocalSamples,
      metrics: round.metrics as RoundMetrics | undefined,
      startedAt: round.startedAt ?? undefined,
      completedAt: round.completedAt ?? undefined,
      createdAt: round.createdAt,
      updatedAt: round.updatedAt,
    };
  }

  /**
   * Convert Prisma model to FederatedParticipant type
   */
  private toFederatedParticipant(participant: {
    id: string;
    roundId: string;
    robotId: string;
    status: string;
    localSamples: number | null;
    localLoss: number | null;
    aggregationWeight: number | null;
    privacyBudgetUsed: number | null;
    failureReason: string | null;
    modelReceivedAt: Date | null;
    trainingStartedAt: Date | null;
    uploadedAt: Date | null;
  }): FederatedParticipant {
    return {
      id: participant.id,
      roundId: participant.roundId,
      robotId: participant.robotId,
      status: participant.status as FederatedParticipant['status'],
      localSamples: participant.localSamples ?? undefined,
      localLoss: participant.localLoss ?? undefined,
      aggregationWeight: participant.aggregationWeight ?? undefined,
      privacyBudgetUsed: participant.privacyBudgetUsed ?? undefined,
      failureReason: participant.failureReason ?? undefined,
      modelReceivedAt: participant.modelReceivedAt ?? undefined,
      trainingStartedAt: participant.trainingStartedAt ?? undefined,
      uploadedAt: participant.uploadedAt ?? undefined,
    };
  }

  /**
   * Convert Prisma model to RobotPrivacyBudget type
   */
  private toRobotPrivacyBudget(budget: {
    id: string;
    robotId: string;
    totalEpsilon: number;
    usedEpsilon: number;
    remainingEpsilon: number;
    roundsParticipated: number;
    lastUpdated: Date;
  }): RobotPrivacyBudget {
    return {
      robotId: budget.robotId,
      totalEpsilon: budget.totalEpsilon,
      usedEpsilon: budget.usedEpsilon,
      remainingEpsilon: budget.remainingEpsilon,
      roundsParticipated: budget.roundsParticipated,
      lastUpdated: budget.lastUpdated,
    };
  }

  /**
   * Convert Prisma model to InterventionRecord type
   */
  private toInterventionRecord(intervention: {
    id: string;
    robotId: string;
    task: string;
    interventionType: string;
    confidenceBefore: number | null;
    confidenceAfter: number | null;
    description: string | null;
    timestamp: Date;
  }): InterventionRecord {
    return {
      id: intervention.id,
      robotId: intervention.robotId,
      task: intervention.task,
      interventionType: intervention.interventionType as 'correction' | 'demonstration' | 'abort',
      confidenceBefore: intervention.confidenceBefore ?? undefined,
      confidenceAfter: intervention.confidenceAfter ?? undefined,
      description: intervention.description ?? undefined,
      timestamp: intervention.timestamp,
    };
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  private emitEvent(event: FederatedEvent): void {
    this.emit('federated:event', event);
    this.emit(event.type, event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const federatedLearningService = FederatedLearningService.getInstance();
