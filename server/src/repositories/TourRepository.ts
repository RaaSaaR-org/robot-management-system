/**
 * @file TourRepository.ts
 * @description Data access for TourRoute / TourRun (TASK-213, host mode).
 *              JSON payloads (stops, siteCard, legs, turns) live in TEXT
 *              columns and are (de)serialised here, so the wire types in
 *              `agent-mode.types.ts` are what every caller sees.
 * @feature tour
 */

import { prisma } from '../database/index.js';
import type { TourRoute as PrismaTourRoute, TourRun as PrismaTourRun } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import type {
  SpokenLanguage,
  TourLeg,
  TourRoute,
  TourRun,
  TourRunOrigin,
  TourRunStatus,
  TourStop,
  TourTurn,
} from '../types/agent-mode.types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A route as the SERVER stores it. Unlike patrol there is nothing to add: a
 * tour has no scheduler, so no `lastFiredAt`/`nextRunAt` bookkeeping exists
 * and the stored record IS the wire {@link TourRoute}. The alias stays so
 * callers (and the app's api layer) read the same way they do for patrol.
 */
export type TourRouteRecord = TourRoute;

/**
 * A run as stored — the wire {@link TourRun} plus the server-owned alert id
 * for a skipped/failed run (idempotency: one alert per run, ever).
 */
export interface TourRunRecord extends TourRun {
  alertId: string | null;
}

export interface CreateTourRouteInput {
  name: string;
  robotId?: string | null;
  twinId?: string | null;
  language: SpokenLanguage;
  greetingPlaceId: string;
  greeting: string;
  offer: string;
  farewell: string;
  siteCard: string[];
  stops: TourStop[];
  enabled?: boolean;
  autoGreet?: boolean;
}

export type UpdateTourRouteInput = Partial<CreateTourRouteInput>;

export interface TourRunFilters {
  routeId?: string;
  robotId?: string;
  status?: TourRunStatus | TourRunStatus[];
  limit?: number;
}

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

export function dbRouteToDomain(row: PrismaTourRoute): TourRouteRecord {
  return {
    id: row.id,
    name: row.name,
    robotId: row.robotId ?? null,
    twinId: row.twinId ?? null,
    language: row.language as SpokenLanguage,
    greetingPlaceId: row.greetingPlaceId,
    greeting: row.greeting,
    offer: row.offer,
    farewell: row.farewell,
    siteCard: parseJson<string[]>(row.siteCard, []),
    stops: parseJson<TourStop[]>(row.stops, []),
    enabled: row.enabled,
    autoGreet: row.autoGreet,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function dbRunToDomain(row: PrismaTourRun): TourRunRecord {
  return {
    runId: row.id,
    routeId: row.routeId,
    routeName: row.routeName,
    robotId: row.robotId,
    origin: row.origin as TourRunOrigin,
    status: row.status as TourRunStatus,
    reason: row.reason ?? null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: toIso(row.finishedAt),
    legs: parseJson<TourLeg[]>(row.legs, []),
    turns: parseJson<TourTurn[]>(row.turns, []),
    language: row.language as SpokenLanguage,
    disclosureSpoken: row.disclosureSpoken,
    planId: row.planId ?? null,
    alertId: row.alertId ?? null,
  };
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class TourRepository {
  // --------------------------------------------------------------------------
  // Routes
  // --------------------------------------------------------------------------

  async createRoute(input: CreateTourRouteInput): Promise<TourRouteRecord> {
    const row = await prisma.tourRoute.create({
      data: {
        id: uuidv4(),
        name: input.name,
        robotId: input.robotId ?? null,
        twinId: input.twinId ?? null,
        language: input.language,
        greetingPlaceId: input.greetingPlaceId,
        greeting: input.greeting,
        offer: input.offer,
        farewell: input.farewell,
        siteCard: JSON.stringify(input.siteCard ?? []),
        stops: JSON.stringify(input.stops ?? []),
        enabled: input.enabled ?? true,
        // Unprompted greeting is opt-in: a robot that walks up to strangers on
        // its own is a decision the operator makes per site, not a default.
        autoGreet: input.autoGreet ?? false,
      },
    });
    return dbRouteToDomain(row);
  }

  async findRouteById(id: string): Promise<TourRouteRecord | null> {
    const row = await prisma.tourRoute.findUnique({ where: { id } });
    return row ? dbRouteToDomain(row) : null;
  }

  async listRoutes(filters: { robotId?: string; enabled?: boolean } = {}): Promise<TourRouteRecord[]> {
    const where: Record<string, unknown> = {};
    if (filters.robotId) where.robotId = filters.robotId;
    if (filters.enabled !== undefined) where.enabled = filters.enabled;
    const rows = await prisma.tourRoute.findMany({ where, orderBy: { createdAt: 'desc' } });
    return rows.map(dbRouteToDomain);
  }

  async updateRoute(id: string, input: UpdateTourRouteInput): Promise<TourRouteRecord | null> {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.robotId !== undefined) data.robotId = input.robotId;
    if (input.twinId !== undefined) data.twinId = input.twinId;
    if (input.language !== undefined) data.language = input.language;
    if (input.greetingPlaceId !== undefined) data.greetingPlaceId = input.greetingPlaceId;
    if (input.greeting !== undefined) data.greeting = input.greeting;
    if (input.offer !== undefined) data.offer = input.offer;
    if (input.farewell !== undefined) data.farewell = input.farewell;
    if (input.siteCard !== undefined) data.siteCard = JSON.stringify(input.siteCard);
    if (input.stops !== undefined) data.stops = JSON.stringify(input.stops);
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.autoGreet !== undefined) data.autoGreet = input.autoGreet;
    try {
      const row = await prisma.tourRoute.update({ where: { id }, data });
      return dbRouteToDomain(row);
    } catch {
      return null;
    }
  }

  async deleteRoute(id: string): Promise<boolean> {
    try {
      await prisma.tourRoute.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Runs
  // --------------------------------------------------------------------------

  /**
   * Insert or replace a run by `runId`. Every `agent:tour:*` event carries the
   * whole run; TourService.ingestRun serialises events per run and refuses
   * stale snapshots (see `isRunDowngrade`) before calling this, so the newest
   * snapshot wins. The server-side `alertId` is preserved across upserts (only
   * {@link setRunAlert} writes it). `routeId` is a plain column (no FK) so a
   * run for a deleted or server-unknown route is still recorded.
   */
  async upsertRun(run: TourRun): Promise<TourRunRecord> {
    const startedAt = toDate(run.startedAt) ?? new Date();
    const data = {
      routeId: run.routeId,
      routeName: run.routeName,
      robotId: run.robotId,
      origin: run.origin,
      status: run.status,
      reason: run.reason ?? null,
      startedAt,
      finishedAt: toDate(run.finishedAt),
      legs: JSON.stringify(run.legs ?? []),
      turns: JSON.stringify(run.turns ?? []),
      language: run.language,
      disclosureSpoken: run.disclosureSpoken === true,
      planId: run.planId ?? null,
    };
    const row = await prisma.tourRun.upsert({
      where: { id: run.runId },
      create: { id: run.runId, ...data },
      update: data,
    });
    return dbRunToDomain(row);
  }

  async setRunAlert(runId: string, alertId: string | null): Promise<void> {
    await prisma.tourRun.update({ where: { id: runId }, data: { alertId } });
  }

  async findRunById(runId: string): Promise<TourRunRecord | null> {
    const row = await prisma.tourRun.findUnique({ where: { id: runId } });
    return row ? dbRunToDomain(row) : null;
  }

  /**
   * Clear the visitor transcript of every run that started before `cutoff`,
   * keeping the run itself (TASK-213).
   *
   * The robot sweeps its own copy after `TOUR_TRANSCRIPT_RETENTION_DAYS`; this
   * is the SERVER's copy of the same words, and without it the sweep was
   * theatre — the transcript survived here, indefinitely, in the database the
   * UI actually reads. What is kept is the run: how far the visit got and how
   * many questions the facts did not cover are the operational record, and
   * neither is personal data once the words are gone.
   *
   * Returns the number of runs whose transcript was cleared.
   */
  async clearTranscriptsBefore(cutoff: Date): Promise<number> {
    const result = await prisma.tourRun.updateMany({
      where: { startedAt: { lt: cutoff }, NOT: { turns: '[]' } },
      data: { turns: '[]' },
    });
    return result.count;
  }

  async listRuns(filters: TourRunFilters = {}): Promise<TourRunRecord[]> {
    const where: Record<string, unknown> = {};
    if (filters.routeId) where.routeId = filters.routeId;
    if (filters.robotId) where.robotId = filters.robotId;
    if (filters.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }
    const rows = await prisma.tourRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: Math.max(1, Math.min(filters.limit ?? 50, 500)),
    });
    return rows.map(dbRunToDomain);
  }
}

export const tourRepository = new TourRepository();
