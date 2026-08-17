/**
 * @file tour-test-fakes.ts
 * @description In-memory TourRepository + payload builders for the host-mode
 *              unit tests (TASK-213). Not a test file.
 * @feature tour
 */

import { vi } from 'vitest';
import type { TourRepository, TourRouteRecord, TourRunRecord } from '../repositories/TourRepository.js';
import type { TourRoute, TourRun, TourStop, TourTurn } from '../types/agent-mode.types.js';

let seq = 0;

/** A minimal, deterministic TourRepository double that keeps everything in Maps. */
export class FakeTourRepository {
  routes = new Map<string, TourRouteRecord>();
  runs = new Map<string, TourRunRecord>();

  seedRoute(partial: Partial<TourRoute> & { id?: string } = {}): TourRouteRecord {
    const id = partial.id ?? `tour-route-${++seq}`;
    const now = new Date().toISOString();
    const r: TourRouteRecord = {
      id,
      name: partial.name ?? 'ZeMA Besucherrundgang',
      robotId: 'robotId' in partial ? (partial.robotId ?? null) : 'robot-001',
      twinId: partial.twinId ?? null,
      language: partial.language ?? 'de',
      greetingPlaceId: partial.greetingPlaceId ?? 'STAGING',
      greeting: partial.greeting ?? 'Hallo, schön dass Sie da sind.',
      offer: partial.offer ?? 'Soll ich Ihnen alles zeigen?',
      farewell: partial.farewell ?? 'Danke für Ihren Besuch.',
      siteCard: partial.siteCard ?? ['Ich bin ein Unitree G1.'],
      stops: partial.stops ?? [makeStop()],
      enabled: partial.enabled ?? true,
      autoGreet: partial.autoGreet ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.routes.set(id, r);
    return r;
  }

  async createRoute(input: any): Promise<TourRouteRecord> {
    return this.seedRoute({ ...input, id: undefined });
  }
  async findRouteById(id: string) {
    return this.routes.get(id) ?? null;
  }
  async listRoutes(f: { robotId?: string; enabled?: boolean } = {}) {
    return [...this.routes.values()]
      .filter((r) => (f.robotId ? r.robotId === f.robotId : true))
      .filter((r) => (f.enabled === undefined ? true : r.enabled === f.enabled));
  }
  async updateRoute(id: string, patch: any) {
    const r = this.routes.get(id);
    if (!r) return null;
    const next = { ...r, ...patch } as TourRouteRecord;
    this.routes.set(id, next);
    return next;
  }
  async deleteRoute(id: string) {
    return this.routes.delete(id);
  }

  async upsertRun(run: TourRun): Promise<TourRunRecord> {
    const prev = this.runs.get(run.runId);
    // Mirrors the real repository: `alertId` is server-owned and survives the
    // robot's snapshots, which never carry it.
    const rec: TourRunRecord = { ...run, alertId: prev?.alertId ?? null };
    this.runs.set(run.runId, rec);
    return rec;
  }
  async setRunAlert(runId: string, alertId: string | null) {
    const r = this.runs.get(runId);
    if (r) r.alertId = alertId;
  }
  async findRunById(runId: string) {
    return this.runs.get(runId) ?? null;
  }
  async listRuns(f: any = {}) {
    return [...this.runs.values()]
      .filter((r) => (f.routeId ? r.routeId === f.routeId : true))
      .filter((r) => (f.robotId ? r.robotId === f.robotId : true))
      .filter((r) => (f.status ? (Array.isArray(f.status) ? f.status.includes(r.status) : r.status === f.status) : true))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, f.limit ?? 50);
  }

  asRepo(): TourRepository {
    return this as unknown as TourRepository;
  }
}

export function fakeAlerts() {
  let n = 0;
  return {
    createRobotAlert: vi.fn(async (robotId: string, severity: string, title: string, message: string) => ({
      id: `alert-${++n}`,
      robotId,
      severity,
      title,
      message,
      source: 'robot',
      sourceId: robotId,
      acknowledged: false,
      dismissable: true,
      timestamp: new Date().toISOString(),
    })) as any,
  };
}

export function fakeCompliance() {
  return { logSystemEvent: vi.fn(async (p: any) => ({ id: 'log', ...p })) as any };
}

export function makeStop(over: Partial<TourStop> = {}): TourStop {
  return {
    id: over.id ?? 'stop-1-staging',
    placeId: over.placeId ?? 'STAGING',
    headline: over.headline ?? 'Startplatz',
    talkTrack: over.talkTrack ?? 'Hier ist mein Startplatz.',
    facts: over.facts ?? ['Ich laufe auf zwei Beinen.'],
    dwellS: over.dwellS ?? 12,
    askToContinue: over.askToContinue ?? false,
    ...(over.demo ? { demo: over.demo } : {}),
  };
}

export function makeTurn(over: Partial<TourTurn> = {}): TourTurn {
  return {
    at: over.at ?? '2026-08-17T10:01:00.000Z',
    stopId: over.stopId === undefined ? 'stop-1-staging' : over.stopId,
    question: over.question ?? 'Was kostet der Roboter?',
    answer: over.answer ?? 'Das weiß ich nicht.',
    answered: over.answered ?? 'declined',
    language: over.language ?? 'de',
  };
}

export function makeRun(over: Partial<TourRun> = {}): TourRun {
  return {
    runId: over.runId ?? 'run-1',
    routeId: over.routeId ?? 'tour-route-1',
    routeName: over.routeName ?? 'ZeMA Besucherrundgang',
    robotId: over.robotId ?? 'robot-001',
    origin: over.origin ?? 'visitor',
    status: over.status ?? 'running',
    reason: over.reason ?? null,
    startedAt: over.startedAt ?? '2026-08-17T10:00:00.000Z',
    finishedAt: over.finishedAt ?? null,
    legs: over.legs ?? [
      { index: 0, stopId: 'stop-1-staging', placeId: 'STAGING', name: 'Startplatz', status: 'done' },
      { index: 1, stopId: 'stop-2-aisle-1', placeId: 'AISLE-1', name: 'Arbeitsstation', status: 'pending' },
    ],
    turns: over.turns ?? [],
    language: over.language ?? 'de',
    disclosureSpoken: over.disclosureSpoken ?? true,
    planId: over.planId ?? 'plan-1',
  };
}
