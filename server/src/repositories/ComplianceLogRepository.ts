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

import { Prisma } from '@prisma/client';
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
// CHAIN ORDERING (TASK-291)
// ============================================================================

/**
 * The order the hash chain was built in, and therefore the only order it can be
 * verified in. `seq` leads: it is the position each append claimed under the
 * unique index, so for every row written since TASK-291 it *is* the chain.
 * `timestamp` alone was never that order — it is non-unique (543 duplicate
 * values on the development database), so two logs written in the same
 * millisecond came back arbitrarily and one of them read as a broken link.
 *
 * `nulls` is stated explicitly because the providers disagree — SQLite sorts
 * NULLs first, PostgreSQL sorts them last — and `seq` is nullable for rows that
 * predate the backfill. Those rows fall back to `(timestamp, id)`, the order
 * this task's migration declares canonical for history:
 * `row_number() OVER (ORDER BY "timestamp","id")`.
 *
 * `timestamp` must come before `id`, and that is not cosmetic: `id` is
 * `@default(uuid())`, a random v4. On a database whose history is still
 * unnumbered the tie-break is the whole order, so an id-led one shuffles the
 * legacy chain and reports nearly every link broken — a false tamper report,
 * the exact harm this task exists to remove. `id` stays as the final tie-break
 * because `timestamp` is not unique. For numbered rows both terms are dead
 * weight: `seq` is unique, so nothing ever reaches them.
 */
const CHAIN_ORDER_ASC: Prisma.ComplianceLogOrderByWithRelationInput[] = [
  { seq: { sort: 'asc', nulls: 'first' } },
  { timestamp: 'asc' },
  { id: 'asc' },
];

/** The same order reversed, for reading the chain head. */
const CHAIN_ORDER_DESC: Prisma.ComplianceLogOrderByWithRelationInput[] = [
  { seq: { sort: 'desc', nulls: 'last' } },
  { timestamp: 'desc' },
  { id: 'desc' },
];

/**
 * How many times an append may lose the race for a `seq` before giving up.
 * Deliberately small: the chain is globally serialized, so a bulk writer queues
 * behind the retry loop and a generous bound would turn a write storm into a
 * long stall rather than a fast, visible failure.
 */
const MAX_CHAIN_ATTEMPTS = 5;

/**
 * Prisma P2002: unique constraint violated. On this table that means another
 * append committed the `seq` we picked — we lost the race and must re-read.
 */
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Prisma P2034: serializable transaction conflict/deadlock — safe to retry. */
function isTransactionConflictError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

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
    seq: db.seq,
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
    seq: db.seq,
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
   *
   * Appending is serialized (TASK-291). The head read and the insert happen in
   * one transaction, and the appended row claims the next `seq` — which carries
   * a UNIQUE index. That index, not the transaction, is the guard: on PostgreSQL
   * at READ COMMITTED two concurrent transactions read the same head and both
   * commit happily, because they never touch a common row. Making them collide
   * on `seq` is what turns the second writer's success into a P2002 it has to
   * retry against a freshly read head, and that holds on SQLite and PostgreSQL
   * alike. Without it, both writers persist the same `previousHash` and
   * `verifyHashChain` reports a permanent broken link — a false tamper report in
   * the audit trail.
   */
  async create(input: CreateComplianceLogInput): Promise<ComplianceLog> {
    // Serialize and encrypt payload. Independent of the chain position, so it is
    // done once and reused across retries.
    const payloadJson = JSON.stringify(input.payload);
    const payloadHash = sha256(payloadJson);
    const { ciphertext, iv } = encrypt(payloadJson);
    const retentionDays = DEFAULT_RETENTION_DAYS[input.eventType] ?? 365;

    for (let attempt = 1; ; attempt++) {
      try {
        const log = await prisma.$transaction(
          async (tx) => {
            // Read the chain head inside the transaction. Everything derived
            // from it below is recomputed on every attempt — a retry that
            // reused the old head would re-persist the fork it is retrying to
            // avoid.
            const head = await tx.complianceLog.findFirst({
              orderBy: CHAIN_ORDER_DESC,
              select: { seq: true, currentHash: true },
            });

            const previousHash = head?.currentHash ?? '';
            const seq = (head?.seq ?? 0) + 1;
            const timestamp = new Date();

            // Hash input is unchanged: previousHash|timestamp|payloadHash|eventType.
            // `seq` deliberately does not enter it, so no existing hash is
            // affected by this column existing.
            const currentHash = generateLogHash(
              previousHash,
              timestamp.toISOString(),
              payloadHash,
              input.eventType,
            );

            const retentionExpiresAt = new Date(timestamp);
            retentionExpiresAt.setDate(retentionExpiresAt.getDate() + retentionDays);

            return tx.complianceLog.create({
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
                seq,
                decisionId: input.decisionId,
                timestamp,
                immutable: true,
                retentionExpiresAt,
              },
            });
          },
          {
            // The sqlite-generated client exposes only Serializable, so naming
            // it explicitly typechecks under both providers. It is a
            // reinforcement, not the guard — see the note above.
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            // The chain is globally serialized, so a burst of appends queues.
            // Prisma's defaults (maxWait 2s, timeout 5s) are budgets for
            // contention-free work and a queued append blows through them: a
            // robot flushing its backlog would lose audit records to a timeout
            // rather than merely waiting for its turn. A dropped compliance log
            // is worse than a slow one, so the budgets are raised deliberately
            // — far enough to absorb a flush storm, still finite so a genuinely
            // stuck database fails loudly instead of hanging.
            maxWait: 20_000,
            timeout: 20_000,
          },
        );

        return dbToDomain(log);
      } catch (error) {
        const retryable = isUniqueConstraintError(error) || isTransactionConflictError(error);
        if (retryable && attempt < MAX_CHAIN_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
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

    // Build orderBy. This is the browsing/display query, not a chain walk — the
    // caller picks the column and `timestamp` stays the default.
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
   *
   * Display order, not chain order — these are the events of one session shown
   * to a human, so `timestamp` is the right axis.
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
   *
   * Display order, not chain order — see findBySessionId.
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
   * Returns verification result with details about any broken links.
   *
   * Walks the chain in `seq` order (TASK-291). Ordering by `timestamp` reported
   * breaks that were only ties: the column is non-unique, so two logs written in
   * the same millisecond could come back in either order and one of the two
   * always looked unlinked.
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
      orderBy: CHAIN_ORDER_ASC,
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
   *
   * Chain head, so it is read in `seq` order (TASK-291) — the newest
   * `timestamp` is not necessarily the tip of the chain.
   */
  async getLatestLog(): Promise<ComplianceLog | null> {
    const log = await prisma.complianceLog.findFirst({
      orderBy: CHAIN_ORDER_DESC,
    });
    return log ? dbToDomain(log) : null;
  }
}

// Export singleton instance
export const complianceLogRepository = new ComplianceLogRepository();
