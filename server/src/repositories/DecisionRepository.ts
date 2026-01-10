/**
 * @file DecisionRepository.ts
 * @description Data access layer for AI Decision explainability entities (EU AI Act Art. 13, Art. 50)
 */

import { prisma } from '../database/index.js';
import type { Decision as DbDecision } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

export type DecisionType = 'command_interpretation' | 'task_execution' | 'safety_action';

export type SafetyClassification = 'safe' | 'caution' | 'dangerous';

export interface DecisionInputFactors {
  userCommand?: string;
  robotState: {
    location?: { x: number; y: number; z?: number };
    batteryLevel?: number;
    status?: string;
    heldObject?: string | null;
  };
  environmentContext?: {
    zones?: string[];
    restrictions?: string[];
    conditions?: string[];
  };
  conversationHistory?: string[];
}

export interface AlternativeConsidered {
  action: string;
  reason: string;
  rejectionReason?: string;
  confidence?: number;
}

export interface DecisionSafetyFactors {
  classification: SafetyClassification;
  warnings: string[];
  constraints: string[];
  riskLevel?: number; // 0-1
}

export interface DecisionExplanation {
  id: string;
  decisionType: DecisionType;
  entityId: string;
  robotId: string;
  inputFactors: DecisionInputFactors;
  reasoning: string[];
  modelUsed: string;
  confidence: number;
  alternatives: AlternativeConsidered[];
  safetyFactors: DecisionSafetyFactors;
  createdAt: string;
}

export interface CreateDecisionInput {
  decisionType: DecisionType;
  entityId: string;
  robotId: string;
  inputFactors: DecisionInputFactors;
  reasoning: string[];
  modelUsed: string;
  confidence: number;
  alternatives: AlternativeConsidered[];
  safetyFactors: DecisionSafetyFactors;
}

export interface DecisionListResponse {
  decisions: DecisionExplanation[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface DecisionQueryParams {
  page?: number;
  pageSize?: number;
  robotId?: string;
  decisionType?: DecisionType;
  startDate?: Date;
  endDate?: Date;
}

// ============================================================================
// AI PERFORMANCE METRICS (Art. 13(3)(b))
// ============================================================================

export interface AIPerformanceMetrics {
  period: 'daily' | 'weekly' | 'monthly';
  startDate: string;
  endDate: string;
  totalDecisions: number;
  accuracy: number; // 0-1, based on successful executions
  precision: number; // 0-1
  recall: number; // 0-1
  errorRate: number; // 0-1
  driftIndicator: number; // 0-1, higher = more drift from baseline
  avgConfidence: number;
  safetyDistribution: {
    safe: number;
    caution: number;
    dangerous: number;
  };
}

// ============================================================================
// AI DOCUMENTATION (Art. 13(3)(a))
// ============================================================================

export interface AIDocumentation {
  intendedPurpose: string;
  capabilities: string[];
  limitations: string[];
  operatingConditions: string[];
  humanOversightRequirements: string[];
  version: string;
  lastUpdated: string;
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

function dbToDomain(db: DbDecision): DecisionExplanation {
  return {
    id: db.id,
    decisionType: db.decisionType as DecisionType,
    entityId: db.entityId,
    robotId: db.robotId,
    inputFactors: JSON.parse(db.inputFactors) as DecisionInputFactors,
    reasoning: JSON.parse(db.reasoning) as string[],
    modelUsed: db.modelUsed,
    confidence: db.confidence,
    alternatives: JSON.parse(db.alternatives) as AlternativeConsidered[],
    safetyFactors: JSON.parse(db.safetyFactors) as DecisionSafetyFactors,
    createdAt: db.createdAt.toISOString(),
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class DecisionRepository {
  /**
   * Find a decision by ID
   */
  async findById(id: string): Promise<DecisionExplanation | null> {
    const decision = await prisma.decision.findUnique({
      where: { id },
    });
    return decision ? dbToDomain(decision) : null;
  }

  /**
   * Find a decision by entity ID (e.g., CommandInterpretation ID)
   */
  async findByEntityId(entityId: string): Promise<DecisionExplanation | null> {
    const decision = await prisma.decision.findFirst({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
    });
    return decision ? dbToDomain(decision) : null;
  }

  /**
   * Find all decisions with filters and pagination
   */
  async findAll(params?: DecisionQueryParams): Promise<DecisionListResponse> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (params?.robotId) where.robotId = params.robotId;
    if (params?.decisionType) where.decisionType = params.decisionType;
    if (params?.startDate || params?.endDate) {
      where.createdAt = {};
      if (params?.startDate)
        (where.createdAt as Record<string, Date>).gte = params.startDate;
      if (params?.endDate)
        (where.createdAt as Record<string, Date>).lte = params.endDate;
    }

    const [decisions, total] = await Promise.all([
      prisma.decision.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.decision.count({ where }),
    ]);

    return {
      decisions: decisions.map(dbToDomain),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Find decisions by robot ID with pagination
   */
  async findByRobotId(
    robotId: string,
    params?: Omit<DecisionQueryParams, 'robotId'>
  ): Promise<DecisionListResponse> {
    return this.findAll({ ...params, robotId });
  }

  /**
   * Create a new decision record
   */
  async create(input: CreateDecisionInput): Promise<DecisionExplanation> {
    const decision = await prisma.decision.create({
      data: {
        decisionType: input.decisionType,
        entityId: input.entityId,
        robotId: input.robotId,
        inputFactors: JSON.stringify(input.inputFactors),
        reasoning: JSON.stringify(input.reasoning),
        modelUsed: input.modelUsed,
        confidence: input.confidence,
        alternatives: JSON.stringify(input.alternatives),
        safetyFactors: JSON.stringify(input.safetyFactors),
      },
    });
    return dbToDomain(decision);
  }

  /**
   * Delete a decision by ID
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.decision.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Count decisions with optional filters
   */
  async count(params?: Pick<DecisionQueryParams, 'robotId' | 'decisionType'>): Promise<number> {
    const where: Record<string, unknown> = {};
    if (params?.robotId) where.robotId = params.robotId;
    if (params?.decisionType) where.decisionType = params.decisionType;
    return prisma.decision.count({ where });
  }

  /**
   * Get aggregated metrics for a time period
   */
  async getMetrics(
    period: 'daily' | 'weekly' | 'monthly',
    robotId?: string
  ): Promise<AIPerformanceMetrics> {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'daily':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'weekly':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    const where: Record<string, unknown> = {
      createdAt: { gte: startDate, lte: now },
    };
    if (robotId) where.robotId = robotId;

    const decisions = await prisma.decision.findMany({ where });

    const total = decisions.length;
    if (total === 0) {
      return {
        period,
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
        totalDecisions: 0,
        accuracy: 0,
        precision: 0,
        recall: 0,
        errorRate: 0,
        driftIndicator: 0,
        avgConfidence: 0,
        safetyDistribution: { safe: 0, caution: 0, dangerous: 0 },
      };
    }

    // Calculate metrics
    let totalConfidence = 0;
    const safetyDist = { safe: 0, caution: 0, dangerous: 0 };
    let highConfidenceCount = 0;

    for (const d of decisions) {
      totalConfidence += d.confidence;
      if (d.confidence >= 0.7) highConfidenceCount++;

      const safety = JSON.parse(d.safetyFactors) as DecisionSafetyFactors;
      if (safety.classification in safetyDist) {
        safetyDist[safety.classification as keyof typeof safetyDist]++;
      }
    }

    // Calculate accuracy based on confidence (placeholder - in production, use actual outcomes)
    const avgConfidence = totalConfidence / total;
    const accuracy = highConfidenceCount / total;

    // Drift indicator based on confidence variance from expected baseline (0.8)
    const baselineConfidence = 0.8;
    const drift = Math.abs(avgConfidence - baselineConfidence);

    return {
      period,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      totalDecisions: total,
      accuracy,
      precision: accuracy, // Simplified - in production, use actual TP/FP
      recall: accuracy, // Simplified - in production, use actual TP/FN
      errorRate: 1 - accuracy,
      driftIndicator: Math.min(drift * 2, 1), // Scale drift to 0-1
      avgConfidence,
      safetyDistribution: safetyDist,
    };
  }
}

export const decisionRepository = new DecisionRepository();
