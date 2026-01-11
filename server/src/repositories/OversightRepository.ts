/**
 * @file OversightRepository.ts
 * @description Data access layer for Human Oversight entities (EU AI Act Art. 14)
 * @feature oversight
 */

import { prisma } from '../database/index.js';
import type {
  ManualControlSession as PrismaManualSession,
  VerificationSchedule as PrismaVerificationSchedule,
  VerificationCompletion as PrismaVerificationCompletion,
  OversightLog as PrismaOversightLog,
  AnomalyRecord as PrismaAnomalyRecord,
} from '@prisma/client';
import type {
  ManualControlSession,
  VerificationSchedule,
  VerificationCompletion,
  OversightLog,
  AnomalyRecord,
  ActivateManualModeInput,
  CreateVerificationScheduleInput,
  CompleteVerificationInput,
  CreateOversightLogInput,
  CreateAnomalyInput,
  ManualSessionQueryParams,
  AnomalyQueryParams,
  OversightLogQueryParams,
  VerificationScheduleQueryParams,
  AnomalyListResponse,
  OversightLogListResponse,
  OperatingMode,
  AnomalyType,
  AnomalySeverity,
  OversightActionType,
  VerificationStatus,
  RobotScope,
} from '../types/oversight.types.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function dbManualSessionToDomain(dbSession: PrismaManualSession): ManualControlSession {
  return {
    id: dbSession.id,
    robotId: dbSession.robotId,
    operatorId: dbSession.operatorId,
    reason: dbSession.reason,
    startedAt: dbSession.startedAt,
    endedAt: dbSession.endedAt,
    isActive: dbSession.isActive,
    speedLimitMmPerSec: dbSession.speedLimitMmPerSec,
    forceLimitN: dbSession.forceLimitN,
  };
}

function dbVerificationScheduleToDomain(
  dbSchedule: PrismaVerificationSchedule & { completions?: PrismaVerificationCompletion[] }
): VerificationSchedule {
  const lastCompletion = dbSchedule.completions?.[0];
  const nextDueAt = lastCompletion
    ? new Date(lastCompletion.completedAt.getTime() + dbSchedule.intervalMinutes * 60 * 1000)
    : new Date(); // Due immediately if never completed

  return {
    id: dbSchedule.id,
    name: dbSchedule.name,
    description: dbSchedule.description,
    intervalMinutes: dbSchedule.intervalMinutes,
    robotScope: dbSchedule.robotScope as RobotScope,
    scopeId: dbSchedule.scopeId,
    isActive: dbSchedule.isActive,
    createdAt: dbSchedule.createdAt,
    updatedAt: dbSchedule.updatedAt,
    lastCompletedAt: lastCompletion?.completedAt ?? null,
    nextDueAt,
    isOverdue: nextDueAt < new Date(),
  };
}

function dbVerificationCompletionToDomain(
  dbCompletion: PrismaVerificationCompletion
): VerificationCompletion {
  return {
    id: dbCompletion.id,
    scheduleId: dbCompletion.scheduleId,
    operatorId: dbCompletion.operatorId,
    robotId: dbCompletion.robotId,
    status: dbCompletion.status as VerificationStatus,
    notes: dbCompletion.notes,
    completedAt: dbCompletion.completedAt,
  };
}

function dbOversightLogToDomain(dbLog: PrismaOversightLog): OversightLog {
  return {
    id: dbLog.id,
    actionType: dbLog.actionType as OversightActionType,
    operatorId: dbLog.operatorId,
    robotId: dbLog.robotId,
    taskId: dbLog.taskId,
    decisionId: dbLog.decisionId,
    reason: dbLog.reason,
    details: JSON.parse(dbLog.details) as Record<string, unknown>,
    timestamp: dbLog.timestamp,
  };
}

function dbAnomalyToDomain(dbAnomaly: PrismaAnomalyRecord): AnomalyRecord {
  return {
    id: dbAnomaly.id,
    robotId: dbAnomaly.robotId,
    anomalyType: dbAnomaly.anomalyType as AnomalyType,
    severity: dbAnomaly.severity as AnomalySeverity,
    description: dbAnomaly.description,
    detectedAt: dbAnomaly.detectedAt,
    acknowledgedAt: dbAnomaly.acknowledgedAt,
    acknowledgedBy: dbAnomaly.acknowledgedBy,
    resolvedAt: dbAnomaly.resolvedAt,
    resolution: dbAnomaly.resolution,
    isActive: dbAnomaly.isActive,
  };
}

// ============================================================================
// MANUAL CONTROL SESSION REPOSITORY
// ============================================================================

export class ManualControlSessionRepository {
  /**
   * Find a session by ID
   */
  async findById(id: string): Promise<ManualControlSession | null> {
    const session = await prisma.manualControlSession.findUnique({
      where: { id },
    });
    return session ? dbManualSessionToDomain(session) : null;
  }

  /**
   * Find active session for a robot
   */
  async findActiveByRobotId(robotId: string): Promise<ManualControlSession | null> {
    const session = await prisma.manualControlSession.findFirst({
      where: { robotId, isActive: true },
      orderBy: { startedAt: 'desc' },
    });
    return session ? dbManualSessionToDomain(session) : null;
  }

  /**
   * Find all active sessions
   */
  async findAllActive(): Promise<ManualControlSession[]> {
    const sessions = await prisma.manualControlSession.findMany({
      where: { isActive: true },
      orderBy: { startedAt: 'desc' },
    });
    return sessions.map(dbManualSessionToDomain);
  }

  /**
   * Find sessions with filters
   */
  async findAll(params?: ManualSessionQueryParams): Promise<ManualControlSession[]> {
    const where: Record<string, unknown> = {};

    if (params?.robotId) where.robotId = params.robotId;
    if (params?.operatorId) where.operatorId = params.operatorId;
    if (params?.isActive !== undefined) where.isActive = params.isActive;

    if (params?.startDate || params?.endDate) {
      where.startedAt = {};
      if (params.startDate) (where.startedAt as Record<string, Date>).gte = params.startDate;
      if (params.endDate) (where.startedAt as Record<string, Date>).lte = params.endDate;
    }

    const sessions = await prisma.manualControlSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
    });
    return sessions.map(dbManualSessionToDomain);
  }

  /**
   * Create a new manual control session
   */
  async create(input: ActivateManualModeInput): Promise<ManualControlSession> {
    // First, end any existing active session for this robot
    await prisma.manualControlSession.updateMany({
      where: { robotId: input.robotId, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });

    const speedLimit = input.mode === 'full_speed' ? 1000 : 250;

    const session = await prisma.manualControlSession.create({
      data: {
        robotId: input.robotId,
        operatorId: input.operatorId,
        reason: input.reason,
        speedLimitMmPerSec: speedLimit,
        forceLimitN: 140,
        isActive: true,
      },
    });
    return dbManualSessionToDomain(session);
  }

  /**
   * End a manual control session
   */
  async end(id: string): Promise<ManualControlSession | null> {
    try {
      const session = await prisma.manualControlSession.update({
        where: { id },
        data: {
          isActive: false,
          endedAt: new Date(),
        },
      });
      return dbManualSessionToDomain(session);
    } catch {
      return null;
    }
  }

  /**
   * End all active sessions for a robot
   */
  async endByRobotId(robotId: string): Promise<number> {
    const result = await prisma.manualControlSession.updateMany({
      where: { robotId, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Count active sessions
   */
  async countActive(): Promise<number> {
    return prisma.manualControlSession.count({ where: { isActive: true } });
  }

  /**
   * Count sessions started today
   */
  async countToday(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return prisma.manualControlSession.count({
      where: { startedAt: { gte: today } },
    });
  }
}

// ============================================================================
// VERIFICATION SCHEDULE REPOSITORY
// ============================================================================

export class VerificationScheduleRepository {
  /**
   * Find a schedule by ID
   */
  async findById(id: string): Promise<VerificationSchedule | null> {
    const schedule = await prisma.verificationSchedule.findUnique({
      where: { id },
      include: {
        completions: { orderBy: { completedAt: 'desc' }, take: 1 },
      },
    });
    return schedule ? dbVerificationScheduleToDomain(schedule) : null;
  }

  /**
   * Find all schedules with filters
   */
  async findAll(params?: VerificationScheduleQueryParams): Promise<VerificationSchedule[]> {
    const where: Record<string, unknown> = {};

    if (params?.isActive !== undefined) where.isActive = params.isActive;
    if (params?.robotScope) where.robotScope = params.robotScope;
    if (params?.scopeId) where.scopeId = params.scopeId;

    const schedules = await prisma.verificationSchedule.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        completions: { orderBy: { completedAt: 'desc' }, take: 1 },
      },
    });
    return schedules.map(dbVerificationScheduleToDomain);
  }

  /**
   * Find due verifications (active schedules that are overdue)
   */
  async findDue(): Promise<VerificationSchedule[]> {
    const schedules = await prisma.verificationSchedule.findMany({
      where: { isActive: true },
      include: {
        completions: { orderBy: { completedAt: 'desc' }, take: 1 },
      },
    });

    const now = new Date();
    return schedules
      .map(dbVerificationScheduleToDomain)
      .filter((s) => s.nextDueAt && s.nextDueAt <= now);
  }

  /**
   * Create a new verification schedule
   */
  async create(input: CreateVerificationScheduleInput): Promise<VerificationSchedule> {
    const schedule = await prisma.verificationSchedule.create({
      data: {
        name: input.name,
        description: input.description,
        intervalMinutes: input.intervalMinutes,
        robotScope: input.robotScope ?? 'all',
        scopeId: input.scopeId,
        isActive: true,
      },
      include: {
        completions: { orderBy: { completedAt: 'desc' }, take: 1 },
      },
    });
    return dbVerificationScheduleToDomain(schedule);
  }

  /**
   * Update a verification schedule
   */
  async update(
    id: string,
    input: Partial<CreateVerificationScheduleInput>
  ): Promise<VerificationSchedule | null> {
    try {
      const schedule = await prisma.verificationSchedule.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          intervalMinutes: input.intervalMinutes,
          robotScope: input.robotScope,
          scopeId: input.scopeId,
        },
        include: {
          completions: { orderBy: { completedAt: 'desc' }, take: 1 },
        },
      });
      return dbVerificationScheduleToDomain(schedule);
    } catch {
      return null;
    }
  }

  /**
   * Deactivate a schedule
   */
  async deactivate(id: string): Promise<VerificationSchedule | null> {
    try {
      const schedule = await prisma.verificationSchedule.update({
        where: { id },
        data: { isActive: false },
        include: {
          completions: { orderBy: { completedAt: 'desc' }, take: 1 },
        },
      });
      return dbVerificationScheduleToDomain(schedule);
    } catch {
      return null;
    }
  }

  /**
   * Delete a schedule
   */
  async delete(id: string): Promise<boolean> {
    try {
      await prisma.verificationSchedule.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Count active schedules
   */
  async countActive(): Promise<number> {
    return prisma.verificationSchedule.count({ where: { isActive: true } });
  }
}

// ============================================================================
// VERIFICATION COMPLETION REPOSITORY
// ============================================================================

export class VerificationCompletionRepository {
  /**
   * Find a completion by ID
   */
  async findById(id: string): Promise<VerificationCompletion | null> {
    const completion = await prisma.verificationCompletion.findUnique({
      where: { id },
    });
    return completion ? dbVerificationCompletionToDomain(completion) : null;
  }

  /**
   * Find completions for a schedule
   */
  async findByScheduleId(
    scheduleId: string,
    limit = 10
  ): Promise<VerificationCompletion[]> {
    const completions = await prisma.verificationCompletion.findMany({
      where: { scheduleId },
      orderBy: { completedAt: 'desc' },
      take: limit,
    });
    return completions.map(dbVerificationCompletionToDomain);
  }

  /**
   * Create a completion record
   */
  async create(input: CompleteVerificationInput): Promise<VerificationCompletion> {
    const completion = await prisma.verificationCompletion.create({
      data: {
        scheduleId: input.scheduleId,
        operatorId: input.operatorId,
        robotId: input.robotId,
        status: input.status,
        notes: input.notes,
      },
    });
    return dbVerificationCompletionToDomain(completion);
  }

  /**
   * Count completions today
   */
  async countToday(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return prisma.verificationCompletion.count({
      where: { completedAt: { gte: today } },
    });
  }

  /**
   * Get compliance rate (completed vs total due in period)
   */
  async getComplianceRate(days = 30): Promise<number> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [completed, total] = await Promise.all([
      prisma.verificationCompletion.count({
        where: {
          completedAt: { gte: startDate },
          status: 'completed',
        },
      }),
      prisma.verificationCompletion.count({
        where: { completedAt: { gte: startDate } },
      }),
    ]);

    return total > 0 ? Math.round((completed / total) * 100) : 100;
  }
}

// ============================================================================
// OVERSIGHT LOG REPOSITORY
// ============================================================================

export class OversightLogRepository {
  /**
   * Find a log entry by ID
   */
  async findById(id: string): Promise<OversightLog | null> {
    const log = await prisma.oversightLog.findUnique({ where: { id } });
    return log ? dbOversightLogToDomain(log) : null;
  }

  /**
   * Find logs with filters and pagination
   */
  async findAll(params?: OversightLogQueryParams): Promise<OversightLogListResponse> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (params?.actionType) {
      where.actionType = Array.isArray(params.actionType)
        ? { in: params.actionType }
        : params.actionType;
    }
    if (params?.operatorId) where.operatorId = params.operatorId;
    if (params?.robotId) where.robotId = params.robotId;

    if (params?.startDate || params?.endDate) {
      where.timestamp = {};
      if (params.startDate) (where.timestamp as Record<string, Date>).gte = params.startDate;
      if (params.endDate) (where.timestamp as Record<string, Date>).lte = params.endDate;
    }

    const [logs, total] = await Promise.all([
      prisma.oversightLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.oversightLog.count({ where }),
    ]);

    return {
      logs: logs.map(dbOversightLogToDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find recent logs
   */
  async findRecent(limit = 10): Promise<OversightLog[]> {
    const logs = await prisma.oversightLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    return logs.map(dbOversightLogToDomain);
  }

  /**
   * Create a log entry
   */
  async create(input: CreateOversightLogInput): Promise<OversightLog> {
    const log = await prisma.oversightLog.create({
      data: {
        actionType: input.actionType,
        operatorId: input.operatorId,
        robotId: input.robotId,
        taskId: input.taskId,
        decisionId: input.decisionId,
        reason: input.reason,
        details: JSON.stringify(input.details ?? {}),
      },
    });
    return dbOversightLogToDomain(log);
  }
}

// ============================================================================
// ANOMALY RECORD REPOSITORY
// ============================================================================

export class AnomalyRecordRepository {
  /**
   * Find an anomaly by ID
   */
  async findById(id: string): Promise<AnomalyRecord | null> {
    const anomaly = await prisma.anomalyRecord.findUnique({ where: { id } });
    return anomaly ? dbAnomalyToDomain(anomaly) : null;
  }

  /**
   * Find active anomalies for a robot
   */
  async findActiveByRobotId(robotId: string): Promise<AnomalyRecord[]> {
    const anomalies = await prisma.anomalyRecord.findMany({
      where: { robotId, isActive: true },
      orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
    });

    // Sort by severity priority
    const severityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return anomalies
      .map(dbAnomalyToDomain)
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }

  /**
   * Find all active anomalies
   */
  async findAllActive(): Promise<AnomalyRecord[]> {
    const anomalies = await prisma.anomalyRecord.findMany({
      where: { isActive: true },
      orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
    });

    const severityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return anomalies
      .map(dbAnomalyToDomain)
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }

  /**
   * Find anomalies with filters and pagination
   */
  async findAll(params?: AnomalyQueryParams): Promise<AnomalyListResponse> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (params?.robotId) where.robotId = params.robotId;
    if (params?.isActive !== undefined) where.isActive = params.isActive;

    if (params?.anomalyType) {
      where.anomalyType = Array.isArray(params.anomalyType)
        ? { in: params.anomalyType }
        : params.anomalyType;
    }

    if (params?.severity) {
      where.severity = Array.isArray(params.severity)
        ? { in: params.severity }
        : params.severity;
    }

    if (params?.startDate || params?.endDate) {
      where.detectedAt = {};
      if (params.startDate) (where.detectedAt as Record<string, Date>).gte = params.startDate;
      if (params.endDate) (where.detectedAt as Record<string, Date>).lte = params.endDate;
    }

    const [anomalies, total] = await Promise.all([
      prisma.anomalyRecord.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { severity: 'asc' }, { detectedAt: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.anomalyRecord.count({ where }),
    ]);

    return {
      anomalies: anomalies.map(dbAnomalyToDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find unacknowledged anomalies
   */
  async findUnacknowledged(): Promise<AnomalyRecord[]> {
    const anomalies = await prisma.anomalyRecord.findMany({
      where: { isActive: true, acknowledgedAt: null },
      orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
    });
    return anomalies.map(dbAnomalyToDomain);
  }

  /**
   * Create an anomaly record
   */
  async create(input: CreateAnomalyInput): Promise<AnomalyRecord> {
    const anomaly = await prisma.anomalyRecord.create({
      data: {
        robotId: input.robotId,
        anomalyType: input.anomalyType,
        severity: input.severity,
        description: input.description,
        isActive: true,
      },
    });
    return dbAnomalyToDomain(anomaly);
  }

  /**
   * Acknowledge an anomaly
   */
  async acknowledge(id: string, operatorId: string): Promise<AnomalyRecord | null> {
    try {
      const anomaly = await prisma.anomalyRecord.update({
        where: { id },
        data: {
          acknowledgedAt: new Date(),
          acknowledgedBy: operatorId,
        },
      });
      return dbAnomalyToDomain(anomaly);
    } catch {
      return null;
    }
  }

  /**
   * Resolve an anomaly
   */
  async resolve(id: string, resolution: string): Promise<AnomalyRecord | null> {
    try {
      const anomaly = await prisma.anomalyRecord.update({
        where: { id },
        data: {
          resolvedAt: new Date(),
          resolution,
          isActive: false,
        },
      });
      return dbAnomalyToDomain(anomaly);
    } catch {
      return null;
    }
  }

  /**
   * Count active anomalies
   */
  async countActive(): Promise<number> {
    return prisma.anomalyRecord.count({ where: { isActive: true } });
  }

  /**
   * Count unacknowledged anomalies
   */
  async countUnacknowledged(): Promise<number> {
    return prisma.anomalyRecord.count({
      where: { isActive: true, acknowledgedAt: null },
    });
  }

  /**
   * Get counts by severity
   */
  async getCountsBySeverity(): Promise<Record<AnomalySeverity, number>> {
    const counts = await prisma.anomalyRecord.groupBy({
      by: ['severity'],
      where: { isActive: true },
      _count: { id: true },
    });

    const result: Record<AnomalySeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const count of counts) {
      result[count.severity as AnomalySeverity] = count._count.id;
    }

    return result;
  }

  /**
   * Get counts by type
   */
  async getCountsByType(): Promise<Record<AnomalyType, number>> {
    const counts = await prisma.anomalyRecord.groupBy({
      by: ['anomalyType'],
      where: { isActive: true },
      _count: { id: true },
    });

    const result: Record<AnomalyType, number> = {
      confidence_drop: 0,
      behavior_drift: 0,
      performance_degradation: 0,
      safety_warning: 0,
      communication_loss: 0,
      sensor_malfunction: 0,
    };

    for (const count of counts) {
      result[count.anomalyType as AnomalyType] = count._count.id;
    }

    return result;
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

export const manualControlSessionRepository = new ManualControlSessionRepository();
export const verificationScheduleRepository = new VerificationScheduleRepository();
export const verificationCompletionRepository = new VerificationCompletionRepository();
export const oversightLogRepository = new OversightLogRepository();
export const anomalyRecordRepository = new AnomalyRecordRepository();
