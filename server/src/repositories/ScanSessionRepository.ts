/**
 * @file ScanSessionRepository.ts
 * @description Data access layer for ScanSession (one recording sweep + its
 *              sidecar build-job lifecycle). Mirrors the TrainingJob worker
 *              fields so the sidecar can poll/claim like a training worker.
 * @feature digitaltwin
 */

import { prisma } from '../database/index.js';
import type { ScanSession as PrismaScanSession } from '@prisma/client';
import type {
  ScanSessionRecord,
  ScanSessionStatus,
  ScanSessionStage,
  CreateScanSessionInput,
  UpdateScanSessionInput,
} from '../types/twin.types.js';

function dbToDomain(row: PrismaScanSession): ScanSessionRecord {
  return {
    id: row.id,
    robotId: row.robotId,
    twinId: row.twinId,
    status: row.status as ScanSessionStatus,
    frameCount: row.frameCount,
    originX: row.originX,
    originY: row.originY,
    originZ: row.originZ,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    progress: row.progress,
    stage: (row.stage as ScanSessionStage | null) ?? null,
    workerId: row.workerId,
    lastHeartbeat: row.lastHeartbeat ? row.lastHeartbeat.toISOString() : null,
    errorMessage: row.errorMessage,
    tenantId: row.tenantId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class ScanSessionRepository {
  async create(input: CreateScanSessionInput): Promise<ScanSessionRecord> {
    const row = await prisma.scanSession.create({
      data: {
        robotId: input.robotId,
        twinId: input.twinId,
        status: input.status ?? 'idle',
        ...(input.originX !== undefined ? { originX: input.originX } : {}),
        ...(input.originY !== undefined ? { originY: input.originY } : {}),
        ...(input.originZ !== undefined ? { originZ: input.originZ } : {}),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
        tenantId: input.tenantId ?? null,
      },
    });
    return dbToDomain(row);
  }

  async findById(id: string): Promise<ScanSessionRecord | null> {
    const row = await prisma.scanSession.findUnique({ where: { id } });
    return row ? dbToDomain(row) : null;
  }

  async update(id: string, input: UpdateScanSessionInput): Promise<ScanSessionRecord | null> {
    try {
      const row = await prisma.scanSession.update({
        where: { id },
        data: { ...input },
      });
      return dbToDomain(row);
    } catch {
      return null;
    }
  }

  /**
   * Atomically transition a session to 'complete' ONLY if it is still
   * 'processing'. Returns true iff THIS call performed the transition; false
   * means another path (the reaper, or a cancel) already moved it to a terminal
   * state, so the caller must NOT run the completion cascade (twin write,
   * irreversible frame prune). A single conditional UPDATE closes the
   * check-then-act window the periodic reaper would otherwise open.
   */
  async completeIfProcessing(id: string): Promise<boolean> {
    const { count } = await prisma.scanSession.updateMany({
      where: { id, status: 'processing' },
      data: { status: 'complete', progress: 100, stage: null, endedAt: new Date() },
    });
    return count === 1;
  }

  /**
   * Atomically transition a session to 'failed' ONLY if it is still in a
   * non-terminal state (idle/recording/processing). Returns true iff THIS call
   * performed the transition. Prevents the reaper from clobbering a session a
   * concurrent completeJob already finished (and pruned) to 'failed'.
   */
  async failIfActive(id: string, error: string): Promise<boolean> {
    const { count } = await prisma.scanSession.updateMany({
      where: { id, status: { in: ['idle', 'recording', 'processing'] } },
      data: { status: 'failed', stage: null, errorMessage: error, endedAt: new Date() },
    });
    return count === 1;
  }

  /**
   * Sessions a sidecar may claim: oldest-first 'processing' sessions with no
   * fresh heartbeat (either never claimed, or the previous worker went stale).
   * The `freshSince` cutoff lets the caller skip sessions another worker is
   * actively heartbeating.
   */
  async listClaimable(freshSince: Date): Promise<ScanSessionRecord[]> {
    const rows = await prisma.scanSession.findMany({
      where: {
        status: 'processing',
        OR: [{ lastHeartbeat: null }, { lastHeartbeat: { lt: freshSince } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(dbToDomain);
  }

  /**
   * Sessions stuck in 'processing' whose worker heartbeat is stale (or absent
   * with an old updatedAt). Used by the boot-time reaper to fail orphans.
   */
  async listStuck(staleSince: Date): Promise<ScanSessionRecord[]> {
    const rows = await prisma.scanSession.findMany({
      where: {
        status: 'processing',
        OR: [
          { lastHeartbeat: { lt: staleSince } },
          { AND: [{ lastHeartbeat: null }, { updatedAt: { lt: staleSince } }] },
        ],
      },
    });
    return rows.map(dbToDomain);
  }

  /**
   * All sessions still in 'recording'. The capture loop is an in-memory
   * interval (ScanSessionService) that cannot survive a process restart, so any
   * 'recording' session found at boot is orphaned. Used by the boot reaper —
   * never call this at runtime, where a 'recording' session has a live loop.
   */
  async listOrphanedRecording(): Promise<ScanSessionRecord[]> {
    const rows = await prisma.scanSession.findMany({
      where: { status: 'recording' },
    });
    return rows.map(dbToDomain);
  }
}

export const scanSessionRepository = new ScanSessionRepository();
