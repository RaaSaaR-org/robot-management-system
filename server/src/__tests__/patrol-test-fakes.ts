/**
 * @file patrol-test-fakes.ts
 * @description In-memory PatrolRepository + fake collaborators for the patrol
 *              unit tests (TASK-212). Not a test file.
 * @feature patrol
 */

import { vi } from 'vitest';
import type { PatrolRepository, PatrolRouteRecord, PatrolRunRecord, PatrolFindingRecord } from '../repositories/PatrolRepository.js';
import type { PatrolFinding, PatrolRun, PatrolRoute } from '../types/agent-mode.types.js';

let seq = 0;

/** A minimal, deterministic PatrolRepository double that keeps everything in Maps. */
export class FakePatrolRepository {
  routes = new Map<string, PatrolRouteRecord>();
  runs = new Map<string, PatrolRunRecord>();
  findings = new Map<string, PatrolFindingRecord>();

  seedRoute(partial: Partial<PatrolRoute> & { id?: string } = {}): PatrolRouteRecord {
    const id = partial.id ?? `route-${++seq}`;
    const now = new Date().toISOString();
    const r: PatrolRouteRecord = {
      id,
      name: partial.name ?? 'Night round',
      robotId: 'robotId' in partial ? (partial.robotId ?? null) : 'robot-001',
      twinId: partial.twinId ?? null,
      checkpoints: partial.checkpoints ?? [
        { id: 'cp-1', placeId: 'hallway', name: 'Hallway', headingDeg: 90, actions: ['capture'] },
        { id: 'cp-2', placeId: 'kitchen', name: 'Kitchen', headingDeg: null, actions: ['capture', 'dwell'], dwellMs: 2000 },
      ],
      cronExpression: partial.cronExpression ?? null,
      enabled: partial.enabled ?? true,
      timeWindows: partial.timeWindows ?? [
        { id: 'day', name: 'Day', startHour: 7, endHour: 19 },
        { id: 'night', name: 'Night', startHour: 19, endHour: 7 },
      ],
      homePlaceId: partial.homePlaceId ?? 'dock',
      createdAt: now,
      updatedAt: now,
      lastFiredAt: null,
      nextRunAt: null,
    };
    this.routes.set(id, r);
    return r;
  }

  async createRoute(input: any): Promise<PatrolRouteRecord> {
    const r = this.seedRoute({ ...input, id: undefined });
    r.nextRunAt = input.nextRunAt ? new Date(input.nextRunAt).toISOString() : null;
    return r;
  }
  async findRouteById(id: string) { return this.routes.get(id) ?? null; }
  async listRoutes(f: { robotId?: string } = {}) {
    return [...this.routes.values()].filter((r) => (f.robotId ? r.robotId === f.robotId : true));
  }
  async listSchedulableRoutes() {
    return [...this.routes.values()].filter((r) => r.enabled && r.cronExpression && r.robotId);
  }
  async updateRoute(id: string, patch: any) {
    const r = this.routes.get(id);
    if (!r) return null;
    const next = { ...r, ...patch } as PatrolRouteRecord;
    if (patch.nextRunAt !== undefined) next.nextRunAt = patch.nextRunAt ? new Date(patch.nextRunAt).toISOString() : null;
    if (patch.lastFiredAt !== undefined) next.lastFiredAt = patch.lastFiredAt ? new Date(patch.lastFiredAt).toISOString() : null;
    this.routes.set(id, next);
    return next;
  }
  async recordScheduledRun(id: string, lastFiredAt: Date, nextRunAt: Date | null) {
    await this.updateRoute(id, { lastFiredAt, nextRunAt });
  }
  async deleteRoute(id: string) { return this.routes.delete(id); }

  async upsertRun(run: PatrolRun): Promise<PatrolRunRecord> {
    const prev = this.runs.get(run.runId);
    const rec: PatrolRunRecord = { ...run, alertId: prev?.alertId ?? null, promotedAt: prev?.promotedAt ?? null };
    this.runs.set(run.runId, rec);
    return rec;
  }
  async setRunAlert(runId: string, alertId: string | null) {
    const r = this.runs.get(runId);
    if (r) r.alertId = alertId;
  }
  async setRunPromoted(runId: string, promotedAt: Date | null) {
    const r = this.runs.get(runId);
    if (!r) return null;
    r.promotedAt = promotedAt ? promotedAt.toISOString() : null;
    return r;
  }
  async findLatestPromotedRun(routeId: string, window?: string | null) {
    return [...this.runs.values()]
      .filter((r) => r.routeId === routeId && r.promotedAt && (window ? r.window === window : true))
      .sort((a, b) => (b.promotedAt as string).localeCompare(a.promotedAt as string))[0] ?? null;
  }
  async findRunById(runId: string) { return this.runs.get(runId) ?? null; }
  async listRuns(f: any = {}) {
    return [...this.runs.values()]
      .filter((r) => (f.routeId ? r.routeId === f.routeId : true))
      .filter((r) => (f.robotId ? r.robotId === f.robotId : true))
      .filter((r) => (f.mode ? r.mode === f.mode : true))
      .filter((r) => (f.status ? (Array.isArray(f.status) ? f.status.includes(r.status) : r.status === f.status) : true))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, f.limit ?? 50);
  }

  async findFindingById(id: string) { return this.findings.get(id) ?? null; }
  async listFindings(f: any = {}) {
    return [...this.findings.values()].filter((x) => (f.runId ? x.runId === f.runId : true));
  }
  async listFindingsForRun(runId: string) { return [...this.findings.values()].filter((x) => x.runId === runId); }
  async createFinding(finding: PatrolFinding) {
    if (!this.runs.has(finding.runId)) throw new Error('FK: run missing');
    const rec: PatrolFindingRecord = { ...finding, alertId: finding.alertId ?? null, incidentId: finding.incidentId ?? null };
    this.findings.set(finding.id, rec);
    return rec;
  }
  async updateFindingObservation(id: string, patch: any) {
    const f = this.findings.get(id);
    if (!f) return null;
    Object.assign(f, patch);
    return f;
  }
  async updateFindingServerFields(id: string, patch: any) {
    const f = this.findings.get(id);
    if (!f) return null;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (f as any)[k] = v;
    return f;
  }
  async countFindingsForRun(runId: string) { return (await this.listFindingsForRun(runId)).length; }

  asRepo(): PatrolRepository { return this as unknown as PatrolRepository; }
}

export function fakeAlerts() {
  let n = 0;
  return {
    createRobotAlert: vi.fn(async (robotId: string, severity: string, title: string, message: string) => ({
      id: `alert-${++n}`, robotId, severity, title, message, source: 'robot', sourceId: robotId,
      acknowledged: false, dismissable: true, timestamp: new Date().toISOString(),
    })) as any,
    acknowledgeAlert: vi.fn(async (id: string) => ({ id, acknowledged: true })) as any,
  };
}

/**
 * Photo-store double for `PatrolServiceDeps.photos`: a run's photo keys exist
 * as long as its legs name them. `expire(runId)` takes the bytes away while
 * the run record keeps pointing at them — exactly what the 30-day retention
 * sweep does to a baseline.
 */
export function fakePhotos(repo: FakePatrolRepository) {
  const expired = new Set<string>();
  return {
    expire(runId: string) { expired.add(runId); },
    existingKeys: vi.fn(async (_robotId: string, runId: string) => {
      if (expired.has(runId)) return new Set<string>();
      const legs = repo.runs.get(runId)?.legs ?? [];
      return new Set(legs.flatMap((l) => (l.photoKey ? [l.photoKey.split('/').pop() as string] : [])));
    }),
  };
}

export function fakeCompliance() {
  return { logSystemEvent: vi.fn(async (p: any) => ({ id: 'log', ...p })) as any };
}

export function makeRun(over: Partial<PatrolRun> = {}): PatrolRun {
  return {
    runId: over.runId ?? 'run-1',
    routeId: over.routeId ?? 'route-1',
    routeName: over.routeName ?? 'Night round',
    robotId: over.robotId ?? 'robot-001',
    mode: over.mode ?? 'patrol',
    origin: over.origin ?? 'scheduled',
    window: over.window === undefined ? 'night' : over.window,
    status: over.status ?? 'running',
    reason: over.reason ?? null,
    startedAt: over.startedAt ?? '2026-08-16T01:00:00.000Z',
    finishedAt: over.finishedAt ?? null,
    legs: over.legs ?? [
      { index: 0, checkpointId: 'cp-1', placeId: 'hallway', name: 'Hallway', status: 'done', photoKey: 'run-1/cp-1.jpg', findingIds: [] },
      { index: 1, checkpointId: 'cp-2', placeId: 'kitchen', name: 'Kitchen', status: 'pending', findingIds: [] },
    ],
    findingCount: over.findingCount ?? 0,
    planId: over.planId ?? 'plan-1',
  };
}

export function makeFinding(over: Partial<PatrolFinding> = {}): PatrolFinding {
  return {
    id: over.id ?? 'finding-1',
    runId: over.runId ?? 'run-1',
    routeId: over.routeId ?? 'route-1',
    robotId: over.robotId ?? 'robot-001',
    checkpointId: over.checkpointId ?? null,
    legIndex: over.legIndex ?? 0,
    type: over.type ?? 'unexpected_object',
    severity: over.severity ?? 'low',
    source: over.source ?? 'enroute_both',
    place: over.place ?? 'hallway',
    pose: over.pose ?? { x: 1, y: 2, yawDeg: 90 },
    at: over.at ?? '2026-08-16T01:02:00.000Z',
    summary: over.summary ?? 'unexpected object in Hallway (0.4 m²)',
    evidence: over.evidence ?? { blob: { x: 1, y: 2, areaM2: 0.4, cells: 16 }, labels: { added: ['crate'], missing: [] }, observations: 2 },
    model: over.model ?? null,
    confidence: over.confidence ?? 0.8,
    status: over.status ?? 'open',
  };
}
