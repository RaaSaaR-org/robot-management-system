/**
 * @file PatrolRepository.ts
 * @description Data access for PatrolRoute / PatrolRun / PatrolFinding (TASK-212).
 *              JSON payloads (checkpoints, timeWindows, legs, pose, evidence)
 *              live in TEXT columns and are (de)serialised here, so the wire
 *              types in `agent-mode.types.ts` are what every caller sees.
 * @feature patrol
 */

import { prisma } from '../database/index.js';
import type {
  PatrolRoute as PrismaPatrolRoute,
  PatrolRun as PrismaPatrolRun,
  PatrolFinding as PrismaPatrolFinding,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import type {
  PatrolCheckpoint,
  PatrolFinding,
  PatrolFindingEvidence,
  PatrolFindingSeverity,
  PatrolFindingSource,
  PatrolFindingStatus,
  PatrolFindingType,
  PatrolLeg,
  PatrolRoute,
  PatrolRun,
  PatrolRunMode,
  PatrolRunOrigin,
  PatrolRunStatus,
  PatrolTimeWindow,
} from '../types/agent-mode.types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A route as the SERVER stores it: the wire `PatrolRoute` plus the scheduler's
 * bookkeeping. `nextRunAt`/`lastFiredAt` are extra, optional-for-clients
 * fields (the app may show "next run" from them; nothing else depends on them).
 */
export interface PatrolRouteRecord extends PatrolRoute {
  lastFiredAt: string | null;
  nextRunAt: string | null;
}

/**
 * A run as stored — the wire `PatrolRun` plus the skipped-run alert id and
 * `promotedAt` (set when an operator promoted the run to the route's baseline;
 * the most recently promoted run per route+window is what `getBaseline` prefers).
 */
export interface PatrolRunRecord extends PatrolRun {
  alertId: string | null;
  promotedAt: string | null;
}

export interface CreatePatrolRouteInput {
  name: string;
  robotId?: string | null;
  twinId?: string | null;
  checkpoints: PatrolCheckpoint[];
  cronExpression?: string | null;
  enabled?: boolean;
  timeWindows?: PatrolTimeWindow[];
  homePlaceId?: string | null;
  nextRunAt?: Date | null;
}

export type UpdatePatrolRouteInput = Partial<CreatePatrolRouteInput> & {
  lastFiredAt?: Date | null;
};

export interface PatrolRunFilters {
  routeId?: string;
  robotId?: string;
  status?: PatrolRunStatus | PatrolRunStatus[];
  mode?: PatrolRunMode;
  window?: string | null;
  limit?: number;
}

export interface PatrolFindingFilters {
  status?: PatrolFindingStatus | PatrolFindingStatus[];
  routeId?: string;
  robotId?: string;
  runId?: string;
  limit?: number;
}

/** Everything the server keeps for a finding, wire shape (`alertId`/`incidentId` included). */
export type PatrolFindingRecord = PatrolFinding;

// ============================================================================
// (DE)SERIALISATION
// ============================================================================

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dbRouteToDomain(row: PrismaPatrolRoute): PatrolRouteRecord {
  return {
    id: row.id,
    name: row.name,
    robotId: row.robotId ?? null,
    twinId: row.twinId ?? null,
    checkpoints: parseJson<PatrolCheckpoint[]>(row.checkpoints, []),
    cronExpression: row.cronExpression ?? null,
    enabled: row.enabled,
    timeWindows: parseJson<PatrolTimeWindow[]>(row.timeWindows, []),
    homePlaceId: row.homePlaceId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastFiredAt: toIso(row.lastFiredAt),
    nextRunAt: toIso(row.nextRunAt),
  };
}

export function dbRunToDomain(row: PrismaPatrolRun): PatrolRunRecord {
  return {
    runId: row.id,
    routeId: row.routeId,
    routeName: row.routeName,
    robotId: row.robotId,
    mode: row.mode as PatrolRunMode,
    origin: row.origin as PatrolRunOrigin,
    window: row.window ?? null,
    status: row.status as PatrolRunStatus,
    reason: row.reason ?? null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: toIso(row.finishedAt),
    legs: parseJson<PatrolLeg[]>(row.legs, []),
    findingCount: row.findingCount,
    planId: row.planId ?? null,
    alertId: row.alertId ?? null,
    promotedAt: toIso(row.promotedAt),
  };
}

export function dbFindingToDomain(row: PrismaPatrolFinding): PatrolFindingRecord {
  return {
    id: row.id,
    runId: row.runId,
    routeId: row.routeId,
    robotId: row.robotId,
    checkpointId: row.checkpointId ?? null,
    legIndex: row.legIndex,
    type: row.type as PatrolFindingType,
    severity: row.severity as PatrolFindingSeverity,
    source: row.source as PatrolFindingSource,
    place: row.place ?? null,
    pose: parseJson<PatrolFinding['pose']>(row.pose, null),
    at: row.at.toISOString(),
    summary: row.summary,
    evidence: parseJson<PatrolFindingEvidence>(row.evidence, {}),
    model: row.model ?? null,
    confidence: row.confidence,
    status: row.status as PatrolFindingStatus,
    alertId: row.alertId ?? null,
    incidentId: row.incidentId ?? null,
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class PatrolRepository {
  // --------------------------------------------------------------------------
  // Routes
  // --------------------------------------------------------------------------

  async createRoute(input: CreatePatrolRouteInput): Promise<PatrolRouteRecord> {
    const row = await prisma.patrolRoute.create({
      data: {
        id: uuidv4(),
        name: input.name,
        robotId: input.robotId ?? null,
        twinId: input.twinId ?? null,
        checkpoints: JSON.stringify(input.checkpoints ?? []),
        cronExpression: input.cronExpression ?? null,
        enabled: input.enabled ?? true,
        timeWindows: JSON.stringify(input.timeWindows ?? []),
        homePlaceId: input.homePlaceId ?? null,
        nextRunAt: input.nextRunAt ?? null,
      },
    });
    return dbRouteToDomain(row);
  }

  async findRouteById(id: string): Promise<PatrolRouteRecord | null> {
    const row = await prisma.patrolRoute.findUnique({ where: { id } });
    return row ? dbRouteToDomain(row) : null;
  }

  async listRoutes(filters: { robotId?: string; enabled?: boolean } = {}): Promise<PatrolRouteRecord[]> {
    const where: Record<string, unknown> = {};
    if (filters.robotId) where.robotId = filters.robotId;
    if (filters.enabled !== undefined) where.enabled = filters.enabled;
    const rows = await prisma.patrolRoute.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map(dbRouteToDomain);
  }

  /** Enabled routes with a cron expression AND a robot — what the scheduler iterates. */
  async listSchedulableRoutes(): Promise<PatrolRouteRecord[]> {
    const rows = await prisma.patrolRoute.findMany({
      where: { enabled: true, cronExpression: { not: null }, robotId: { not: null } },
    });
    return rows.map(dbRouteToDomain).filter((r) => Boolean(r.cronExpression) && Boolean(r.robotId));
  }

  async updateRoute(id: string, input: UpdatePatrolRouteInput): Promise<PatrolRouteRecord | null> {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.robotId !== undefined) data.robotId = input.robotId;
    if (input.twinId !== undefined) data.twinId = input.twinId;
    if (input.checkpoints !== undefined) data.checkpoints = JSON.stringify(input.checkpoints);
    if (input.cronExpression !== undefined) data.cronExpression = input.cronExpression;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.timeWindows !== undefined) data.timeWindows = JSON.stringify(input.timeWindows);
    if (input.homePlaceId !== undefined) data.homePlaceId = input.homePlaceId;
    if (input.nextRunAt !== undefined) data.nextRunAt = input.nextRunAt;
    if (input.lastFiredAt !== undefined) data.lastFiredAt = input.lastFiredAt;
    try {
      const row = await prisma.patrolRoute.update({ where: { id }, data });
      return dbRouteToDomain(row);
    } catch {
      return null;
    }
  }

  /** Scheduler bookkeeping: advance the slot after a fire. */
  async recordScheduledRun(id: string, lastFiredAt: Date, nextRunAt: Date | null): Promise<void> {
    await prisma.patrolRoute.update({ where: { id }, data: { lastFiredAt, nextRunAt } });
  }

  async deleteRoute(id: string): Promise<boolean> {
    try {
      await prisma.patrolRoute.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Runs
  // --------------------------------------------------------------------------

  /**
   * Insert or replace a run by `runId`. Every `agent:patrol:*` event carries
   * the whole run; PatrolService.ingestRun serialises events per run and
   * refuses stale snapshots (see `isRunDowngrade`) before calling this, so
   * the newest snapshot wins. The server-side `alertId` is preserved across
   * upserts (only {@link setRunAlert} writes it). `routeId` is a plain column
   * (no FK) so runs for a deleted/unknown route are still recorded.
   */
  async upsertRun(run: PatrolRun): Promise<PatrolRunRecord> {
    const startedAt = toDate(run.startedAt) ?? new Date();
    const data = {
      routeId: run.routeId,
      routeName: run.routeName,
      robotId: run.robotId,
      mode: run.mode,
      origin: run.origin,
      window: run.window ?? null,
      status: run.status,
      reason: run.reason ?? null,
      startedAt,
      finishedAt: toDate(run.finishedAt),
      legs: JSON.stringify(run.legs ?? []),
      findingCount: run.findingCount ?? 0,
      planId: run.planId ?? null,
    };
    const row = await prisma.patrolRun.upsert({
      where: { id: run.runId },
      create: { id: run.runId, ...data },
      update: data,
    });
    return dbRunToDomain(row);
  }

  async setRunAlert(runId: string, alertId: string | null): Promise<void> {
    await prisma.patrolRun.update({ where: { id: runId }, data: { alertId } });
  }

  /** Server-owned: mark a run as promoted to the baseline (survives upserts like `alertId`). */
  async setRunPromoted(runId: string, promotedAt: Date | null): Promise<PatrolRunRecord | null> {
    const row = await prisma.patrolRun.update({ where: { id: runId }, data: { promotedAt } });
    return row ? dbRunToDomain(row) : null;
  }

  /**
   * The most recently promoted run for a route (+ window, when given), or null
   * when no run of that route/window was ever promoted.
   */
  async findLatestPromotedRun(routeId: string, window?: string | null): Promise<PatrolRunRecord | null> {
    const where: Record<string, unknown> = { routeId, promotedAt: { not: null } };
    if (window !== undefined && window !== null) where.window = window;
    const row = await prisma.patrolRun.findFirst({ where, orderBy: { promotedAt: 'desc' } });
    return row ? dbRunToDomain(row) : null;
  }

  async findRunById(runId: string): Promise<PatrolRunRecord | null> {
    const row = await prisma.patrolRun.findUnique({ where: { id: runId } });
    return row ? dbRunToDomain(row) : null;
  }

  async listRuns(filters: PatrolRunFilters = {}): Promise<PatrolRunRecord[]> {
    const where: Record<string, unknown> = {};
    if (filters.routeId) where.routeId = filters.routeId;
    if (filters.robotId) where.robotId = filters.robotId;
    if (filters.mode) where.mode = filters.mode;
    if (filters.window !== undefined) where.window = filters.window;
    if (filters.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    const rows = await prisma.patrolRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: Math.max(1, Math.min(filters.limit ?? 50, 500)),
    });
    return rows.map(dbRunToDomain);
  }

  // --------------------------------------------------------------------------
  // Findings
  // --------------------------------------------------------------------------

  async findFindingById(id: string): Promise<PatrolFindingRecord | null> {
    const row = await prisma.patrolFinding.findUnique({ where: { id } });
    return row ? dbFindingToDomain(row) : null;
  }

  async listFindings(filters: PatrolFindingFilters = {}): Promise<PatrolFindingRecord[]> {
    const where: Record<string, unknown> = {};
    if (filters.routeId) where.routeId = filters.routeId;
    if (filters.robotId) where.robotId = filters.robotId;
    if (filters.runId) where.runId = filters.runId;
    if (filters.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    const rows = await prisma.patrolFinding.findMany({
      where,
      orderBy: { at: 'desc' },
      take: Math.max(1, Math.min(filters.limit ?? 100, 1000)),
    });
    return rows.map(dbFindingToDomain);
  }

  async listFindingsForRun(runId: string): Promise<PatrolFindingRecord[]> {
    const rows = await prisma.patrolFinding.findMany({ where: { runId }, orderBy: { at: 'asc' } });
    return rows.map(dbFindingToDomain);
  }

  /** First-sight insert. The caller has already checked the id is unknown. */
  async createFinding(finding: PatrolFinding): Promise<PatrolFindingRecord> {
    const row = await prisma.patrolFinding.create({
      data: {
        id: finding.id,
        runId: finding.runId,
        routeId: finding.routeId,
        robotId: finding.robotId,
        checkpointId: finding.checkpointId ?? null,
        legIndex: finding.legIndex ?? 0,
        type: finding.type,
        severity: finding.severity,
        source: finding.source,
        place: finding.place ?? null,
        pose: finding.pose ? JSON.stringify(finding.pose) : null,
        at: toDate(finding.at) ?? new Date(),
        summary: finding.summary,
        evidence: JSON.stringify(finding.evidence ?? {}),
        model: finding.model ?? null,
        confidence: finding.confidence ?? 0,
        status: finding.status === 'candidate' ? 'open' : finding.status,
        alertId: finding.alertId ?? null,
        incidentId: finding.incidentId ?? null,
      },
    });
    return dbFindingToDomain(row);
  }

  /**
   * Re-observation update: the robot's evidence/summary/confidence move, the
   * server-owned fields (status once a human acted, alertId, incidentId) do not.
   */
  async updateFindingObservation(
    id: string,
    patch: Pick<PatrolFinding, 'summary' | 'evidence' | 'confidence' | 'pose' | 'place' | 'model'>,
  ): Promise<PatrolFindingRecord | null> {
    try {
      const row = await prisma.patrolFinding.update({
        where: { id },
        data: {
          summary: patch.summary,
          evidence: JSON.stringify(patch.evidence ?? {}),
          confidence: patch.confidence ?? 0,
          pose: patch.pose ? JSON.stringify(patch.pose) : null,
          place: patch.place ?? null,
          model: patch.model ?? null,
        },
      });
      return dbFindingToDomain(row);
    } catch {
      return null;
    }
  }

  async updateFindingServerFields(
    id: string,
    patch: { status?: PatrolFindingStatus; alertId?: string | null; incidentId?: string | null; severity?: PatrolFindingSeverity },
  ): Promise<PatrolFindingRecord | null> {
    const data: Record<string, unknown> = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.alertId !== undefined) data.alertId = patch.alertId;
    if (patch.incidentId !== undefined) data.incidentId = patch.incidentId;
    if (patch.severity !== undefined) data.severity = patch.severity;
    try {
      const row = await prisma.patrolFinding.update({ where: { id }, data });
      return dbFindingToDomain(row);
    } catch {
      return null;
    }
  }

  async countFindingsForRun(runId: string): Promise<number> {
    return prisma.patrolFinding.count({ where: { runId } });
  }
}

export const patrolRepository = new PatrolRepository();
