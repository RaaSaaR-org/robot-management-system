/**
 * @file ComplianceLogRepository.ts
 * @description Data access layer for compliance logging with hash chain and encryption
 * @feature compliance
 *
 * Implements append-only, tamper-evident logging for regulatory compliance:
 * - EU AI Act Article 12 (Record-keeping)
 * - GDPR Article 30 (Records of processing activities)
 * - Machinery Regulation Annex III
 *
 * IMPORTANT: This repository intentionally has NO update or delete methods.
 * Compliance logs are immutable by design.
 */

import { prisma } from '../database/index.js';
import type { ComplianceLog as DbComplianceLog, ComplianceLogAccess as DbLogAccess } from '@prisma/client';
import { encrypt, decrypt, sha256, generateLogHash } from '../security/encryption.js';
import { DEFAULT_RETENTION_DAYS } from '../types/retention.types.js';
import type {
  ComplianceLog,
  ComplianceLogEncrypted,
  ComplianceLogAccess,
  CreateComplianceLogInput,
  CreateLogAccessInput,
  ComplianceLogQueryParams,
  ComplianceLogListResponse,
  HashChainVerificationResult,
  EventTypeMetrics,
  ComplianceMetricsSummary,
  CompliancePayload,
  ComplianceEventType,
  ComplianceSeverity,
} from '../types/compliance.types.js';

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Convert database record to domain object with decrypted payload
 */
function dbToDomain(db: DbComplianceLog): ComplianceLog {
  const decryptedPayload = decrypt({
    ciphertext: db.payloadEncrypted,
    iv: db.payloadIv,
  });

  return {
    id: db.id,
    sessionId: db.sessionId,
    robotId: db.robotId,
    operatorId: db.operatorId,
    eventType: db.eventType as ComplianceEventType,
    severity: db.severity as ComplianceSeverity,
    payload: JSON.parse(decryptedPayload) as CompliancePayload,
    modelVersion: db.modelVersion,
    modelHash: db.modelHash,
    inputHash: db.inputHash,
    outputHash: db.outputHash,
    previousHash: db.previousHash,
    currentHash: db.currentHash,
    decisionId: db.decisionId,
    timestamp: db.timestamp,
    immutable: db.immutable,
  };
}

/**
 * Convert database record to encrypted domain object (no decryption)
 */
function dbToEncrypted(db: DbComplianceLog): ComplianceLogEncrypted {
  return {
    id: db.id,
    sessionId: db.sessionId,
    robotId: db.robotId,
    operatorId: db.operatorId,
    eventType: db.eventType,
    severity: db.severity,
    payloadEncrypted: db.payloadEncrypted,
    payloadIv: db.payloadIv,
    payloadHash: db.payloadHash,
    modelVersion: db.modelVersion,
    modelHash: db.modelHash,
    inputHash: db.inputHash,
    outputHash: db.outputHash,
    previousHash: db.previousHash,
    currentHash: db.currentHash,
    decisionId: db.decisionId,
    timestamp: db.timestamp,
    immutable: db.immutable,
  };
}

/**
 * Convert database log access record to domain object
 */
function accessDbToDomain(db: DbLogAccess): ComplianceLogAccess {
  return {
    id: db.id,
    logId: db.logId,
    userId: db.userId,
    accessType: db.accessType as ComplianceLogAccess['accessType'],
    ipAddress: db.ipAddress,
    userAgent: db.userAgent,
    timestamp: db.timestamp,
  };
}

// ============================================================================
// REPOSITORY CLASS
// ============================================================================

export class ComplianceLogRepository {
  /**
   * Create a new compliance log entry with hash chain
   *
   * This is the ONLY write method. Logs are append-only.
   */
  async create(input: CreateComplianceLogInput): Promise<ComplianceLog> {
    // Serialize and encrypt payload
    const payloadJson = JSON.stringify(input.payload);
    const payloadHash = sha256(payloadJson);
    const { ciphertext, iv } = encrypt(payloadJson);

    // Get the previous log entry for hash chain
    const previousLog = await prisma.complianceLog.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { currentHash: true },
    });

    const previousHash = previousLog?.currentHash ?? '';
    const timestamp = new Date();

    // Generate current hash for chain
    const currentHash = generateLogHash(
      previousHash,
      timestamp.toISOString(),
      payloadHash,
      input.eventType,
    );

    // Calculate retention expiration date
    const retentionDays = DEFAULT_RETENTION_DAYS[input.eventType] ?? 365;
    const retentionExpiresAt = new Date(timestamp);
    retentionExpiresAt.setDate(retentionExpiresAt.getDate() + retentionDays);

    // Create the log entry
    const log = await prisma.complianceLog.create({
      data: {
        sessionId: input.sessionId,
        robotId: input.robotId,
        operatorId: input.operatorId,
        eventType: input.eventType,
        severity: input.severity ?? 'info',
        payloadEncrypted: ciphertext,
        payloadIv: iv,
        payloadHash,
        modelVersion: input.modelVersion,
        modelHash: input.modelHash,
        inputHash: input.inputHash,
        outputHash: input.outputHash,
        previousHash,
        currentHash,
        decisionId: input.decisionId,
        timestamp,
        immutable: true,
        retentionExpiresAt,
      },
    });

    return dbToDomain(log);
  }

  /**
   * Find a log by ID with optional access audit
   */
  async findById(
    id: string,
    accessorUserId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<ComplianceLog | null> {
    const log = await prisma.complianceLog.findUnique({
      where: { id },
    });

    if (!log) return null;

    // Record access for audit trail
    if (accessorUserId !== undefined || ipAddress) {
      await this.recordAccess({
        logId: id,
        userId: accessorUserId,
        accessType: 'view',
        ipAddress,
        userAgent,
      });
    }

    return dbToDomain(log);
  }

  /**
   * Find a log by ID without decryption (for verification)
   */
  async findByIdEncrypted(id: string): Promise<ComplianceLogEncrypted | null> {
    const log = await prisma.complianceLog.findUnique({
      where: { id },
    });
    return log ? dbToEncrypted(log) : null;
  }

  /**
   * Find all logs with filters and pagination
   */
  async findAll(params?: ComplianceLogQueryParams): Promise<ComplianceLogListResponse> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 50;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {};
    if (params?.sessionId) where.sessionId = params.sessionId;
    if (params?.robotId) where.robotId = params.robotId;
    if (params?.operatorId) where.operatorId = params.operatorId;
    if (params?.eventType) where.eventType = params.eventType;
    if (params?.severity) where.severity = params.severity;
    if (params?.decisionId) where.decisionId = params.decisionId;

    if (params?.startDate || params?.endDate) {
      where.timestamp = {};
      if (params?.startDate) (where.timestamp as Record<string, Date>).gte = params.startDate;
      if (params?.endDate) (where.timestamp as Record<string, Date>).lte = params.endDate;
    }

    // Build orderBy
    const sortBy = params?.sortBy ?? 'timestamp';
    const sortOrder = params?.sortOrder ?? 'desc';
    const orderBy = { [sortBy]: sortOrder };

    const [logs, total] = await Promise.all([
      prisma.complianceLog.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      prisma.complianceLog.count({ where }),
    ]);

    return {
      logs: logs.map(dbToDomain),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find logs by session ID
   */
  async findBySessionId(sessionId: string): Promise<ComplianceLog[]> {
    const logs = await prisma.complianceLog.findMany({
      where: { sessionId },
      orderBy: { timestamp: 'asc' },
    });
    return logs.map(dbToDomain);
  }

  /**
   * Find logs by decision ID (links to Explainability)
   */
  async findByDecisionId(decisionId: string): Promise<ComplianceLog[]> {
    const logs = await prisma.complianceLog.findMany({
      where: { decisionId },
      orderBy: { timestamp: 'asc' },
    });
    return logs.map(dbToDomain);
  }

  /**
   * Verify hash chain integrity
   *
   * Returns verification result with details about any broken links
   */
  async verifyHashChain(
    startDate?: Date,
    endDate?: Date,
  ): Promise<HashChainVerificationResult> {
    const where: Record<string, unknown> = {};
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) (where.timestamp as Record<string, Date>).gte = startDate;
      if (endDate) (where.timestamp as Record<string, Date>).lte = endDate;
    }

    const logs = await prisma.complianceLog.findMany({
      where,
      orderBy: { timestamp: 'asc' },
    });

    const brokenLinks: HashChainVerificationResult['brokenLinks'] = [];
    let previousHash = '';

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      // Check if previous hash matches
      if (log.previousHash !== previousHash) {
        brokenLinks.push({
          logId: log.id,
          expectedHash: previousHash,
          actualPreviousHash: log.previousHash,
          timestamp: log.timestamp,
        });
      }

      // Verify current hash was computed correctly
      const expectedCurrentHash = generateLogHash(
        log.previousHash,
        log.timestamp.toISOString(),
        log.payloadHash,
        log.eventType,
      );

      if (log.currentHash !== expectedCurrentHash) {
        // Log was tampered with
        brokenLinks.push({
          logId: log.id,
          expectedHash: expectedCurrentHash,
          actualPreviousHash: log.currentHash,
          timestamp: log.timestamp,
        });
      }

      previousHash = log.currentHash;
    }

    return {
      isValid: brokenLinks.length === 0,
      totalLogs: logs.length,
      verifiedLogs: logs.length - brokenLinks.length,
      firstLogTimestamp: logs[0]?.timestamp,
      lastLogTimestamp: logs[logs.length - 1]?.timestamp,
      brokenLinks,
      verifiedAt: new Date(),
    };
  }

  /**
   * Get event type counts for metrics
   */
  async getEventTypeCounts(
    startDate?: Date,
    endDate?: Date,
  ): Promise<EventTypeMetrics[]> {
    const where: Record<string, unknown> = {};
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) (where.timestamp as Record<string, Date>).gte = startDate;
      if (endDate) (where.timestamp as Record<string, Date>).lte = endDate;
    }

    const counts = await prisma.complianceLog.groupBy({
      by: ['eventType'],
      where,
      _count: { eventType: true },
      _max: { timestamp: true },
    });

    return counts.map((c) => ({
      eventType: c.eventType as ComplianceEventType,
      count: c._count.eventType,
      lastOccurrence: c._max.timestamp,
    }));
  }

  /**
   * Get comprehensive metrics summary
   */
  async getMetricsSummary(
    startDate?: Date,
    endDate?: Date,
  ): Promise<ComplianceMetricsSummary> {
    const where: Record<string, unknown> = {};
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) (where.timestamp as Record<string, Date>).gte = startDate;
      if (endDate) (where.timestamp as Record<string, Date>).lte = endDate;
    }

    const [
      totalLogs,
      eventTypeCounts,
      severityCounts,
      uniqueSessions,
      uniqueRobots,
      dateRange,
    ] = await Promise.all([
      prisma.complianceLog.count({ where }),
      this.getEventTypeCounts(startDate, endDate),
      prisma.complianceLog.groupBy({
        by: ['severity'],
        where,
        _count: { severity: true },
      }),
      prisma.complianceLog.findMany({
        where,
        select: { sessionId: true },
        distinct: ['sessionId'],
      }),
      prisma.complianceLog.findMany({
        where,
        select: { robotId: true },
        distinct: ['robotId'],
      }),
      prisma.complianceLog.aggregate({
        where,
        _min: { timestamp: true },
        _max: { timestamp: true },
      }),
    ]);

    const severityMap: Record<ComplianceSeverity, number> = {
      debug: 0,
      info: 0,
      warning: 0,
      error: 0,
      critical: 0,
    };
    for (const s of severityCounts) {
      if (s.severity in severityMap) {
        severityMap[s.severity as ComplianceSeverity] = s._count.severity;
      }
    }

    return {
      totalLogs,
      eventTypeCounts,
      severityCounts: severityMap,
      uniqueSessions: uniqueSessions.length,
      uniqueRobots: uniqueRobots.length,
      dateRange: {
        start: dateRange._min.timestamp,
        end: dateRange._max.timestamp,
      },
    };
  }

  /**
   * Record access to a log for audit trail
   */
  async recordAccess(input: CreateLogAccessInput): Promise<ComplianceLogAccess> {
    const access = await prisma.complianceLogAccess.create({
      data: {
        logId: input.logId,
        userId: input.userId,
        accessType: input.accessType,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
    return accessDbToDomain(access);
  }

  /**
   * Get access history for a log
   */
  async getAccessHistory(logId: string): Promise<ComplianceLogAccess[]> {
    const accesses = await prisma.complianceLogAccess.findMany({
      where: { logId },
      orderBy: { timestamp: 'desc' },
    });
    return accesses.map(accessDbToDomain);
  }

  /**
   * Count logs with optional filters
   */
  async count(params?: Pick<ComplianceLogQueryParams, 'sessionId' | 'robotId' | 'eventType'>): Promise<number> {
    const where: Record<string, unknown> = {};
    if (params?.sessionId) where.sessionId = params.sessionId;
    if (params?.robotId) where.robotId = params.robotId;
    if (params?.eventType) where.eventType = params.eventType;
    return prisma.complianceLog.count({ where });
  }

  /**
   * Get the latest log entry (for hash chain continuation)
   */
  async getLatestLog(): Promise<ComplianceLog | null> {
    const log = await prisma.complianceLog.findFirst({
      orderBy: { timestamp: 'desc' },
    });
    return log ? dbToDomain(log) : null;
  }
}

// Export singleton instance
export const complianceLogRepository = new ComplianceLogRepository();
