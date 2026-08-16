/**
 * @file patrol.ts
 * @description Patrol (TASK-212): the route source (server fetch + disk cache),
 *              the fail-closed preconditions, the leg plan a route becomes, the
 *              PatrolRunner that drives one run through the controller's block
 *              machinery with leg semantics (a failed leg is skipped and
 *              reported, two consecutive failures abort the run and go home),
 *              the capture/inspect host the block executor calls back into, the
 *              en-route comparators hooked into every look, and the on-disk run
 *              store under `workspace-<robotId>/patrol/<routeId>/runs/<runId>/`.
 * @feature agentmode
 * @status live-conditional
 */

import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config.js';
import { BaselineStore, DEFAULT_WINDOW, safeSegment } from './baseline.js';
import { mayInitiate, SELF_INITIATIVE_MIN_BATTERY, type InitiativeContext } from './initiative.js';
import {
  Confirmer,
  candidatesFromChecklist,
  checklistCompare,
  labelSetDiff,
  mapDiff,
  missingLabelCandidates,
  runChecklist,
  type Candidate,
  type ChecklistAnswers,
  type ChecklistResult,
} from './inspector.js';
import type { DynamicObstacle, OccupancyMapSnapshot } from './occupancy-map.js';
import type { Place } from './place-resolver.js';
import { PLACE_STALE_MS } from '../robot/StatePersistence.js';
import { patrolPhrase } from './voice-narrator.js';
import type {
  AgentBlock,
  AgentBlockKind,
  BlockOutcome,
  ControlOwner,
  PatrolCheckpoint,
  PatrolFinding,
  PatrolFindingSeverity,
  PatrolFindingType,
  PatrolInspection,
  PatrolRoute,
  PatrolRun,
  PatrolRunMode,
  PatrolRunOrigin,
  PatrolStartResult,
  PatrolTimeWindow,
  SpokenLanguage,
} from './types.js';
import type { Workspace } from './workspace.js';

// ============================================================================
// Route source
// ============================================================================

export const PATROL_ROUTE_FETCH_TIMEOUT_MS = 5000;

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Validate a route from the wire (or the cache). Throws with the reason. */
export function parsePatrolRoute(raw: unknown, where = 'route'): PatrolRoute {
  if (!raw || typeof raw !== 'object') throw new Error(`${where}: not an object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim()) throw new Error(`${where}: missing id`);
  if (typeof r.name !== 'string') throw new Error(`${where}: missing name`);
  if (!Array.isArray(r.checkpoints)) throw new Error(`${where}: checkpoints must be an array`);
  const checkpoints: PatrolCheckpoint[] = r.checkpoints.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`${where}: checkpoint ${i} is not an object`);
    const o = c as Record<string, unknown>;
    if (typeof o.placeId !== 'string' || !o.placeId.trim()) throw new Error(`${where}: checkpoint ${i} has no placeId`);
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `cp-${i + 1}`;
    const actions = Array.isArray(o.actions)
      ? o.actions.filter((a): a is 'capture' | 'dwell' | 'scan' => a === 'capture' || a === 'dwell' || a === 'scan')
      : ['capture' as const];
    const heading = Number(o.headingDeg);
    const expectations = Array.isArray(o.expectations)
      ? o.expectations.filter((e): e is string => typeof e === 'string' && e.trim() !== '').map((e) => e.trim())
      : [];
    return {
      id,
      placeId: o.placeId.trim(),
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : o.placeId.trim(),
      headingDeg: o.headingDeg === null || o.headingDeg === undefined || !Number.isFinite(heading) ? null : heading,
      actions,
      ...(Number.isFinite(Number(o.dwellMs)) ? { dwellMs: Math.max(0, Number(o.dwellMs)) } : {}),
      ...(expectations.length > 0 ? { expectations } : {}),
    };
  });
  const timeWindows: PatrolTimeWindow[] = Array.isArray(r.timeWindows)
    ? r.timeWindows.flatMap((w) => {
        if (!w || typeof w !== 'object') return [];
        const o = w as Record<string, unknown>;
        const start = Number(o.startHour);
        const end = Number(o.endHour);
        if (typeof o.id !== 'string' || !Number.isFinite(start) || !Number.isFinite(end)) return [];
        return [{ id: o.id, name: typeof o.name === 'string' ? o.name : o.id, startHour: start, endHour: end }];
      })
    : [];
  return {
    id: r.id.trim(),
    name: r.name,
    robotId: typeof r.robotId === 'string' ? r.robotId : null,
    twinId: typeof r.twinId === 'string' ? r.twinId : null,
    checkpoints,
    cronExpression: typeof r.cronExpression === 'string' ? r.cronExpression : null,
    enabled: r.enabled !== false,
    timeWindows,
    homePlaceId: typeof r.homePlaceId === 'string' && r.homePlaceId.trim() ? r.homePlaceId.trim() : null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : nowIso(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : nowIso(),
  };
}

export interface PatrolRouteSourceOptions {
  serverUrl: string;
  cachePath: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type PatrolRouteOrigin = 'server' | 'cache' | 'none';

/**
 * Where a route comes from when the start request did not carry it inline:
 * `GET {SERVER_URL}/api/patrol/routes/:id`, cached to one JSON file keyed by
 * route id, same fail-soft rules as `place-graph-source.ts` — the server being
 * down is a stale route, not no route.
 */
export class PatrolRouteSource {
  private readonly serverUrl: string;
  private readonly cachePath: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PatrolRouteSourceOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
    this.cachePath = opts.cachePath;
    this.timeoutMs = opts.timeoutMs ?? PATROL_ROUTE_FETCH_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  url(routeId: string): string {
    return `${this.serverUrl}/api/patrol/routes/${encodeURIComponent(routeId)}`;
  }

  private readCache(): Record<string, unknown> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8')) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  loadCached(routeId: string): PatrolRoute | null {
    const raw = this.readCache()[routeId];
    if (!raw) return null;
    try {
      return parsePatrolRoute(raw, `cached route ${routeId}`);
    } catch (err) {
      console.warn(`[Patrol] cached route ${routeId} unusable: ${msg(err)}`);
      return null;
    }
  }

  /** Remember a route that arrived inline, so a later fetch-less start can reuse it. */
  remember(route: PatrolRoute): void {
    try {
      const all = this.readCache();
      all[route.id] = route;
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const tmp = `${this.cachePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf-8');
      fs.renameSync(tmp, this.cachePath);
    } catch (err) {
      console.warn(`[Patrol] could not cache route ${route.id}: ${msg(err)}`);
    }
  }

  async fetch(routeId: string): Promise<{ route: PatrolRoute | null; origin: PatrolRouteOrigin; error?: string }> {
    try {
      const res = await this.fetchImpl(this.url(routeId), { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const route = parsePatrolRoute(await res.json(), this.url(routeId));
      this.remember(route);
      return { route, origin: 'server' };
    } catch (err) {
      const error = msg(err);
      const cached = this.loadCached(routeId);
      if (cached) return { route: cached, origin: 'cache', error };
      return { route: null, origin: 'none', error };
    }
  }
}

// ============================================================================
// Time windows
// ============================================================================

/**
 * Which of the route's windows the local time falls in. `null` when the route
 * has no windows at all (the run's `window` is then null and the baseline
 * lives under `default`); `'none'` when it has windows and none matches.
 */
export function matchTimeWindow(windows: readonly PatrolTimeWindow[], date: Date): string | null | 'none' {
  if (windows.length === 0) return null;
  const h = date.getHours() + date.getMinutes() / 60;
  for (const w of windows) {
    const inside = w.startHour < w.endHour ? h >= w.startHour && h < w.endHour : h >= w.startHour || h < w.endHour;
    if (inside) return w.id;
  }
  return 'none';
}

/** Whether a window (by id/name) is a night window — drives severity. */
export function isNightWindow(route: PatrolRoute | null, window: string | null): boolean {
  if (!window) return false;
  const w = route?.timeWindows.find((x) => x.id === window);
  const label = `${window} ${w?.name ?? ''}`.toLowerCase();
  if (/night|nacht/.test(label)) return true;
  if (w && w.startHour > w.endHour) return true; // wraps midnight
  return false;
}

/** Severity by type × window — the same table the server applies. */
export function findingSeverity(type: PatrolFindingType, night: boolean): PatrolFindingSeverity {
  if (type === 'person' || type === 'door_open') return night ? 'high' : 'medium';
  if (type === 'unexpected_object' || type === 'object_on_floor') return 'medium';
  return 'low';
}

// ============================================================================
// Preconditions — fail closed
// ============================================================================

export type PatrolRefusalReason =
  | 'disabled'
  | 'estop'
  | 'busy'
  | 'battery'
  | 'place_unknown'
  | 'damped'
  | 'crash_unacknowledged'
  | 'window'
  | 'route_unknown'
  | 'no_places'
  | 'running';

export interface PatrolPreconditionInput {
  /** `AGENT_PATROL_ENABLED`. */
  patrolEnabled: boolean;
  /** Agent Mode itself is on. */
  agentModeEnabled: boolean;
  estopLatched: boolean;
  /** A patrol run is already active on this robot. */
  patrolActive: boolean;
  /** Any Agent Mode plan is running. */
  planRunning: boolean;
  controlOwner: ControlOwner;
  teleopOrVlaActive: boolean;
  initiative: InitiativeContext;
  origin: PatrolRunOrigin;
  route: PatrolRoute;
  /** Place ids the robot can `goto` right now (registered frame, non-keepout). */
  knownPlaceIds: readonly string[];
  now: Date;
}

export type PatrolPreconditionVerdict =
  | { ok: true; window: string | null }
  | { ok: false; reason: PatrolRefusalReason; message: string };

/**
 * Every reason a run must not start, in the order they are checked. Pure.
 *
 * `scheduled` runs go through {@link mayInitiate} exactly like `self`; an
 * operator start passes the initiative gate (a human asked) but is still
 * refused on a damped base — the first leg would fail on zero motion and the
 * operator is better told now than after two failed legs.
 */
export function checkPatrolPreconditions(input: PatrolPreconditionInput): PatrolPreconditionVerdict {
  const refuse = (reason: PatrolRefusalReason, message: string): PatrolPreconditionVerdict => ({ ok: false, reason, message });
  if (!input.patrolEnabled) return refuse('disabled', 'Patrol is disabled on this robot (AGENT_PATROL_ENABLED=false).');
  if (!input.agentModeEnabled) return refuse('disabled', 'Agent Mode is off — enable it before starting a patrol.');
  if (input.patrolActive) return refuse('running', 'A patrol run is already active on this robot.');
  if (input.estopLatched) return refuse('estop', 'An E-Stop is latched — reset it before starting a patrol.');
  if (input.planRunning) return refuse('busy', 'An Agent Mode plan is running — wait for it or stop it first.');
  if (input.controlOwner !== 'idle') return refuse('busy', `Control is held by ${input.controlOwner}.`);
  if (input.teleopOrVlaActive) return refuse('busy', 'Teleoperation or VLA control is active.');
  if (input.knownPlaceIds.length === 0) {
    return refuse('no_places', 'This robot knows no places by name (no registered place graph), so it cannot walk a route.');
  }
  if (input.route.checkpoints.length === 0) return refuse('route_unknown', `Route "${input.route.name}" has no checkpoints.`);
  const known = new Set(input.knownPlaceIds.map((p) => p.toLowerCase()));
  const unknown = input.route.checkpoints.filter((c) => !known.has(c.placeId.toLowerCase())).map((c) => c.placeId);
  if (unknown.length > 0) {
    return refuse(
      'route_unknown',
      `Route "${input.route.name}" names places this robot does not know: ${[...new Set(unknown)].join(', ')}. ` +
        `Known: ${input.knownPlaceIds.join(', ')}.`,
    );
  }
  const window = matchTimeWindow(input.route.timeWindows, input.now);
  if (window === 'none') {
    const list = input.route.timeWindows.map((w) => `${w.id} ${w.startHour}–${w.endHour}h`).join(', ');
    return refuse('window', `Now (${input.now.getHours()}:${String(input.now.getMinutes()).padStart(2, '0')}) is outside the route's time windows (${list}).`);
  }
  const ctx = input.initiative;
  if (input.origin === 'scheduled') {
    // Same order as mayInitiate, so the code matches the prose it returns.
    const verdict = mayInitiate('goto', 'scheduled', ctx);
    if (!verdict.ok) {
      let reason: PatrolRefusalReason = 'busy';
      if (ctx.estopLatched) reason = 'estop';
      else if (!ctx.crashAcknowledged) reason = 'crash_unacknowledged';
      else if (ctx.batteryPercent === null || ctx.batteryPercent < SELF_INITIATIVE_MIN_BATTERY) reason = 'battery';
      else if (ctx.damped) reason = 'damped';
      else if (ctx.place === null || ctx.placeAgeMs === null || ctx.placeAgeMs > PLACE_STALE_MS) reason = 'place_unknown';
      return refuse(reason, verdict.reason);
    }
  } else if (ctx.damped) {
    return refuse('damped', 'The base is damped (after an E-Stop) — send `posture stand` before a patrol.');
  }
  return { ok: true, window };
}

// ============================================================================
// Runs on disk
// ============================================================================

export interface PatrolRunStoreDeps {
  workspace: Workspace;
  now?: () => number;
}

/** `patrol/<routeId>/runs/<runId>/{run.json,findings.json,<checkpointId>.jpg}`. */
export class PatrolRunStore {
  private readonly ws: Workspace;
  private readonly now: () => number;

  constructor(deps: PatrolRunStoreDeps) {
    this.ws = deps.workspace;
    this.now = deps.now ?? (() => Date.now());
  }

  runDir(routeId: string, runId: string): string {
    const r = safeSegment(routeId);
    const u = safeSegment(runId);
    if (!r || !u) throw new Error(`patrol: unusable route/run id ${JSON.stringify(routeId)}/${JSON.stringify(runId)}`);
    return path.join(this.ws.patrolDir, r, 'runs', u);
  }

  photoFile(routeId: string, runId: string, checkpointId: string): string | null {
    const c = safeSegment(checkpointId);
    if (!c) return null;
    return path.join(this.runDir(routeId, runId), `${c}.jpg`);
  }

  saveRun(run: PatrolRun): void {
    this.ws.atomicWrite(path.join(this.runDir(run.routeId, run.runId), 'run.json'), JSON.stringify(run, null, 2));
  }

  saveFindings(routeId: string, runId: string, findings: readonly PatrolFinding[]): void {
    this.ws.atomicWrite(path.join(this.runDir(routeId, runId), 'findings.json'), JSON.stringify(findings, null, 2));
  }

  savePhoto(routeId: string, runId: string, checkpointId: string, jpeg: Buffer): string | null {
    const file = this.photoFile(routeId, runId, checkpointId);
    if (!file) return null;
    this.ws.atomicWrite(file, jpeg);
    return `${runId}/${checkpointId}.jpg`;
  }

  readPhoto(runId: string, checkpointId: string): Buffer | null {
    const run = this.findRun(runId);
    if (!run) return null;
    const file = this.photoFile(run.routeId, runId, checkpointId);
    if (!file) return null;
    try {
      return fs.readFileSync(file);
    } catch {
      return null;
    }
  }

  private readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    } catch {
      return fallback;
    }
  }

  /** Every run on disk, newest first. */
  listRuns(limit = 20, routeId?: string): PatrolRun[] {
    const runs: PatrolRun[] = [];
    let routeDirs: string[] = [];
    try {
      routeDirs = fs
        .readdirSync(this.ws.patrolDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && (!routeId || e.name === routeId))
        .map((e) => path.join(this.ws.patrolDir, e.name, 'runs'));
    } catch {
      return [];
    }
    for (const dir of routeDirs) {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const run = this.readJson<PatrolRun | null>(path.join(dir, e.name, 'run.json'), null);
        if (run && typeof run.runId === 'string') runs.push(run);
      }
    }
    runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    return runs.slice(0, Math.max(0, limit));
  }

  findRun(runId: string): PatrolRun | null {
    return this.listRuns(Number.MAX_SAFE_INTEGER).find((r) => r.runId === runId) ?? null;
  }

  findings(routeId: string, runId: string): PatrolFinding[] {
    return this.readJson<PatrolFinding[]>(path.join(this.runDir(routeId, runId), 'findings.json'), []);
  }

  /**
   * Retention: plain control photos older than `controlH` hours go; photos a
   * finding points at (and every photo of a baseline-mode run) live for
   * `findingDays`. Run/finding JSON is kept — it is the record. Returns the
   * files removed.
   */
  sweep(controlH: number = config.agentMode.patrol.photoRetentionH, findingDays = 30): string[] {
    const removed: string[] = [];
    const nowMs = this.now();
    for (const run of this.listRuns(Number.MAX_SAFE_INTEGER)) {
      let dir: string;
      try {
        dir = this.runDir(run.routeId, run.runId);
      } catch {
        continue;
      }
      const findings = this.findings(run.routeId, run.runId);
      const referenced = new Set<string>();
      for (const f of findings) {
        for (const key of [f.evidence.currentPhotoKey, f.evidence.baselinePhotoKey]) {
          if (key) referenced.add(key);
        }
      }
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.jpg')) continue;
        const file = path.join(dir, e.name);
        const key = `${run.runId}/${e.name}`;
        const keepH = run.mode === 'baseline' || referenced.has(key) ? findingDays * 24 : controlH;
        let ageMs: number;
        try {
          ageMs = nowMs - fs.statSync(file).mtimeMs;
        } catch {
          continue;
        }
        if (ageMs > keepH * 3600_000) {
          try {
            fs.rmSync(file, { force: true });
            removed.push(file);
          } catch (err) {
            console.warn(`[Patrol] could not remove ${file}: ${msg(err)}`);
          }
        }
      }
    }
    return removed;
  }
}

// ============================================================================
// Leg plan
// ============================================================================

/** A block of the patrol plan and which leg it belongs to (`-1` = not a leg). */
export interface PatrolPlanBlock {
  block: AgentBlock;
  legIndex: number;
  /** The route's home leg (goto home), which is not a checkpoint. */
  home?: boolean;
}

function makeBlock(kind: AgentBlockKind, params: Record<string, unknown>, reasoning: string): AgentBlock {
  return { id: uuidv4(), kind, params, status: 'pending', reasoning };
}

/**
 * The plan a route becomes: a leading `patrol` block, the spoken start
 * notice, then per checkpoint `goto{place}` → `capture` (when the checkpoint
 * captures) → `inspect` (patrol mode) → `wait` (dwell) → `scan_room` (scan),
 * and finally `goto{home}` when the route (or `AGENT_PATROL_HOME_PLACE`) names one.
 */
export function buildPatrolBlocks(
  route: PatrolRoute,
  mode: PatrolRunMode,
  opts: { homePlaceId?: string | null; startNotice?: string | null } = {},
): PatrolPlanBlock[] {
  const out: PatrolPlanBlock[] = [];
  out.push({
    block: makeBlock('patrol', { routeId: route.id, routeName: route.name, mode }, `${mode === 'baseline' ? 'Baseline' : 'Patrol'} run of "${route.name}" — ${route.checkpoints.length} checkpoint(s).`),
    legIndex: -1,
  });
  if (opts.startNotice) {
    out.push({
      block: makeBlock('speak', { text: opts.startNotice }, 'Start-of-run notice — the robot says it is taking reference photos.'),
      legIndex: -1,
    });
  }
  route.checkpoints.forEach((cp, i) => {
    out.push({
      block: makeBlock('goto', { place: cp.placeId, checkpointId: cp.id }, `Leg ${i + 1}: walk to ${cp.name}.`),
      legIndex: i,
    });
    if (cp.actions.includes('capture')) {
      out.push({
        block: makeBlock(
          'capture',
          { checkpointId: cp.id, name: cp.name, ...(cp.headingDeg === null || cp.headingDeg === undefined ? {} : { headingDeg: cp.headingDeg }) },
          `Control photo at ${cp.name}.`,
        ),
        legIndex: i,
      });
      if (mode === 'patrol') {
        out.push({ block: makeBlock('inspect', { checkpointId: cp.id, name: cp.name }, `Compare ${cp.name} against its baseline.`), legIndex: i });
      }
    }
    if (cp.actions.includes('dwell')) {
      const seconds = Math.min(30, Math.max(0.1, (cp.dwellMs ?? 5000) / 1000));
      out.push({ block: makeBlock('wait', { seconds }, `Dwell at ${cp.name}.`), legIndex: i });
    }
    if (cp.actions.includes('scan')) {
      out.push({ block: makeBlock('scan_room', { steps: 8 }, `Look around at ${cp.name}.`), legIndex: i });
    }
  });
  const home = route.homePlaceId ?? opts.homePlaceId ?? null;
  if (home) {
    out.push({ block: makeBlock('goto', { place: home }, `Return home to ${home}.`), legIndex: -1, home: true });
  }
  return out;
}

export function newPatrolRun(input: {
  robotId: string;
  route: PatrolRoute;
  mode: PatrolRunMode;
  origin: PatrolRunOrigin;
  window: string | null;
  status?: PatrolRun['status'];
  reason?: string | null;
}): PatrolRun {
  const at = nowIso();
  const status = input.status ?? 'running';
  return {
    runId: uuidv4(),
    routeId: input.route.id,
    routeName: input.route.name,
    robotId: input.robotId,
    mode: input.mode,
    origin: input.origin,
    window: input.window,
    status,
    reason: input.reason ?? null,
    startedAt: at,
    finishedAt: status === 'running' ? null : at,
    legs: input.route.checkpoints.map((cp, i) => ({
      index: i,
      checkpointId: cp.id,
      placeId: cp.placeId,
      name: cp.name,
      status: status === 'running' ? 'pending' : 'skipped',
      photoKey: null,
      photoDropped: null,
      inspection: null,
      findingIds: [],
    })),
    findingCount: 0,
    planId: null,
  };
}

// ============================================================================
// Runner
// ============================================================================

/** What the block executor's `capture`/`inspect` handlers see. */
export interface PatrolCaptureContext {
  runId: string;
  routeId: string;
  mode: PatrolRunMode;
  window: string | null;
  legIndex: number;
  checkpoint: PatrolCheckpoint;
}

export interface CaptureRecord {
  /** The frame, or null when it must not be stored (person) / could not be taken. */
  photo: Buffer | null;
  photoDropped: 'person' | 'error' | null;
  answers: ChecklistAnswers | null;
  model: string | null;
  /** Set by the gate (`unchanged`), a failure (`error`) or the baseline path (`recorded`); null = inspect decides. */
  inspection: PatrolInspection | null;
  similarity: number | null;
  message?: string;
}

export interface PatrolCaptureHost {
  context(checkpointId: string): PatrolCaptureContext | null;
  /** The baseline photo for the hash gate (patrol mode; null in baseline mode / none recorded). */
  baselinePhoto(checkpointId: string): Buffer | null;
  hashGate: number;
  checklist(imageB64: string, expectations: readonly string[]): Promise<ChecklistResult>;
  recordCapture(checkpointId: string, rec: CaptureRecord): { photoKey: string | null };
  inspect(checkpointId: string): Promise<{ inspection: PatrolInspection; message: string; findings: number }>;
}

/** What one en-route look hands the runner. Zero model calls happen here. */
export interface PatrolLookInput {
  labels: readonly string[];
  personVisible: boolean;
  pose: { x: number; y: number; yawDeg: number } | null;
  place: string | null;
  map: OccupancyMapSnapshot | null;
  peers: readonly DynamicObstacle[];
  places: readonly Place[];
}

/** How the runner drives blocks — supplied by the controller. */
export interface PatrolExecution {
  begin(block: AgentBlock): void;
  execute(block: AgentBlock): Promise<BlockOutcome>;
  finish(block: AgentBlock, outcome: BlockOutcome): void;
  skip(block: AgentBlock, reason: string): void;
  isAborted(): boolean;
  abortReason(): string | null;
}

export interface PatrolRunnerDeps {
  robotId: string;
  workspace: Workspace | null;
  baseline?: BaselineStore;
  runs?: PatrolRunStore;
  now?: () => number;
  /** ONE VLM call. Default `runChecklist` (Ollama through Genkit). */
  checklist?: (imageB64: string, expectations: readonly string[]) => Promise<ChecklistResult>;
  emit: (type: 'agent:patrol:started' | 'agent:patrol:leg' | 'agent:patrol:finished' | 'agent:finding:detected' | 'agent:finding:confirmed', run: PatrolRun, finding?: PatrolFinding) => void;
  uploadPhoto?: (input: { runId: string; key: string; jpeg: Buffer; kind: 'control' | 'baseline' | 'finding'; checkpointId: string; routeId: string; capturedAt: string }) => void;
  say?: (text: string, language?: SpokenLanguage) => Promise<boolean>;
  language?: () => SpokenLanguage;
  /** The live occupancy map, for the baseline snapshot at the end of a baseline run. */
  mapSnapshot?: () => OccupancyMapSnapshot | null;
  /** The robot's planar pose (odom frame), stamped on each leg when it finishes. */
  getPose?: () => { x: number; y: number; yawDeg: number } | null;
  hashGate?: number;
  confirmN?: number;
  confirmM?: number;
  watchlist?: readonly string[];
  minBlobM2?: number;
  diffRadiusM?: number;
  homePlace?: string;
  log?: (line: string) => void;
}

interface Session {
  run: PatrolRun;
  route: PatrolRoute;
  blocks: PatrolPlanBlock[];
  findings: PatrolFinding[];
  confirmer: Confirmer;
  captures: Map<string, { answers: ChecklistAnswers | null; model: string | null; photoKey: string | null; similarity: number | null }>;
  /** Labels seen per leg (union over its looks). */
  legLabels: Map<number, Set<string>>;
  currentLeg: number;
  spokenPerson: boolean;
  lastMap: OccupancyMapSnapshot | null;
  /** The map-diff refusal already logged for this run (frame mismatch etc.). */
  mapReasonLogged: string | null;
  /** Legs whose en-route label diff was skipped for want of baseline labels. */
  labelSkipLegs: Set<number>;
}

/**
 * One patrol at a time per robot. The controller asks {@link start} after the
 * preconditions passed and the lock is claimed; everything the run does after
 * that goes through the {@link PatrolExecution} it hands over, so E-Stop,
 * geofence, the pre-walk map check, mirror and compliance record apply to a
 * patrol leg exactly as to an operator's `goto`.
 */
export class PatrolRunner {
  private readonly deps: PatrolRunnerDeps;
  readonly baseline: BaselineStore | null;
  readonly runs: PatrolRunStore | null;
  private readonly checklistFn: (imageB64: string, expectations: readonly string[]) => Promise<ChecklistResult>;
  private readonly hashGate: number;
  private readonly watchlist: readonly string[];
  private session: Session | null = null;
  private last: PatrolRun | null = null;
  private abortRequest: string | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(deps: PatrolRunnerDeps) {
    this.deps = deps;
    this.baseline = deps.baseline ?? (deps.workspace ? new BaselineStore({ workspace: deps.workspace }) : null);
    this.runs = deps.runs ?? (deps.workspace ? new PatrolRunStore({ workspace: deps.workspace }) : null);
    this.checklistFn = deps.checklist ?? ((b64, exp) => runChecklist(b64, exp));
    this.hashGate = deps.hashGate ?? config.agentMode.patrol.hashGate;
    this.watchlist = deps.watchlist ?? config.agentMode.patrol.watchlist;
  }

  private log(line: string): void {
    (this.deps.log ?? ((l: string) => console.log(l)))(`[Patrol] ${line}`);
  }

  private nowMs(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private stamp(): string {
    return new Date(this.nowMs()).toISOString();
  }

  // ── state ─────────────────────────────────────────────────────────────────

  active(): PatrolRun | null {
    return this.session ? cloneRun(this.session.run) : null;
  }

  activeRoute(): PatrolRoute | null {
    return this.session?.route ?? null;
  }

  lastRun(): PatrolRun | null {
    if (this.last) return cloneRun(this.last);
    return this.runs?.listRuns(1)[0] ?? null;
  }

  activeFindings(): PatrolFinding[] {
    return this.session ? this.session.findings.map((f) => ({ ...f })) : [];
  }

  /** Ask the running patrol to stop after the block in flight (the controller also aborts the plan). */
  requestAbort(reason: string): string | null {
    if (!this.session) return null;
    this.abortRequest = reason;
    return this.session.run.runId;
  }

  // ── refusal ───────────────────────────────────────────────────────────────

  /**
   * A start that did not happen. Recorded as a `skipped` run and announced
   * through `agent:patrol:finished` so the server can persist it and alert.
   */
  refuse(route: PatrolRoute, mode: PatrolRunMode, origin: PatrolRunOrigin, reason: PatrolRefusalReason, message: string, window: string | null = null): PatrolStartResult {
    const run = newPatrolRun({ robotId: this.deps.robotId, route, mode, origin, window, status: 'skipped', reason: `${reason}: ${message}` });
    this.persist(run, []);
    this.last = run;
    this.log(`refused ${mode} run of "${route.name}" (${origin}): ${reason} — ${message}`);
    this.deps.emit('agent:patrol:finished', cloneRun(run));
    return { accepted: false, runId: run.runId, reason, message };
  }

  // ── start / drive ─────────────────────────────────────────────────────────

  /**
   * Build the run and its plan blocks. The controller puts the blocks into an
   * AgentPlan, emits `agent:plan:started`, then calls {@link drive}.
   */
  begin(route: PatrolRoute, mode: PatrolRunMode, origin: PatrolRunOrigin, window: string | null): { run: PatrolRun; blocks: PatrolPlanBlock[] } {
    if (this.session) throw new Error('a patrol run is already active');
    const language = this.deps.language?.() ?? 'en';
    const blocks = buildPatrolBlocks(route, mode, {
      homePlaceId: this.deps.homePlace ?? config.agentMode.patrol.homePlace ?? null,
      startNotice: patrolPhrase(mode === 'baseline' ? 'startBaseline' : 'startPatrol', language),
    });
    const run = newPatrolRun({ robotId: this.deps.robotId, route, mode, origin, window });
    this.session = {
      run,
      route,
      blocks,
      findings: [],
      confirmer: new Confirmer({ n: this.deps.confirmN ?? config.agentMode.patrol.confirmN, m: this.deps.confirmM ?? config.agentMode.patrol.confirmM }),
      captures: new Map(),
      legLabels: new Map(),
      currentLeg: -1,
      spokenPerson: false,
      lastMap: null,
      mapReasonLogged: null,
      labelSkipLegs: new Set<number>(),
    };
    this.abortRequest = null;
    this.persist(run, []);
    return { run, blocks };
  }

  /** The abort the runner itself asked for (operator command / abortPatrol), or null. */
  private runnerAborted(): string | null {
    return this.abortRequest;
  }

  /**
   * Drive the plan with leg semantics. Resolves with the finished run; never
   * throws (a crash becomes a `failed` run).
   */
  async drive(planId: string, exec: PatrolExecution): Promise<PatrolRun> {
    const s = this.session;
    if (!s) throw new Error('drive() without begin()');
    const run = s.run;
    run.planId = planId;
    this.deps.emit('agent:patrol:started', cloneRun(run));
    const aborted = (): boolean => exec.isAborted() || this.runnerAborted() !== null;
    const abortReason = (): string => exec.abortReason() ?? this.runnerAborted() ?? 'aborted';
    // Checkpoints the robot reached but could NOT inspect: no control photo,
    // or no checklist answer (camera/sidecar down, checklist model down or
    // unparseable). Only a failed `goto` fails a leg, so these legs end
    // 'done' — without counting them a completely blind patrol would report
    // "3/3 checkpoint(s), 0 finding(s)" and read to an operator as "normal".
    const blindLegs = (): PatrolRun['legs'] =>
      run.legs.filter((l) => l.status === 'done' && (l.photoDropped === 'error' || l.inspection === 'error'));

    const patrolBlock = s.blocks[0]?.block;
    let twoFailuresAbort: string | null = null;
    let consecutiveFails = 0;
    try {
      if (patrolBlock) exec.begin(patrolBlock);
      // Non-leg blocks after the patrol block and before leg 0 (the notice).
      for (const pb of s.blocks.slice(1)) {
        if (pb.legIndex !== -1 || pb.home) break;
        if (aborted()) {
          exec.skip(pb.block, abortReason());
          continue;
        }
        exec.begin(pb.block);
        exec.finish(pb.block, await exec.execute(pb.block));
      }

      for (let i = 0; i < run.legs.length; i++) {
        const leg = run.legs[i];
        const legBlocks = s.blocks.filter((b) => b.legIndex === i);
        if (aborted() || twoFailuresAbort) {
          for (const pb of legBlocks) exec.skip(pb.block, twoFailuresAbort ?? abortReason());
          leg.status = 'skipped';
          leg.message = twoFailuresAbort ?? abortReason();
          continue;
        }
        s.currentLeg = i;
        leg.status = 'running';
        leg.startedAt = this.stamp();
        this.persist(run, s.findings);
        let legFailed = false;
        let captureFailed = false;
        for (const pb of legBlocks) {
          if (aborted()) {
            exec.skip(pb.block, abortReason());
            continue;
          }
          if (legFailed || (captureFailed && pb.block.kind === 'inspect')) {
            exec.skip(pb.block, legFailed ? 'leg failed' : 'capture failed');
            continue;
          }
          exec.begin(pb.block);
          let outcome: BlockOutcome;
          try {
            outcome = await exec.execute(pb.block);
          } catch (err) {
            outcome = { ok: false, message: msg(err) };
          }
          exec.finish(pb.block, outcome);
          if (!outcome.ok) {
            if (pb.block.kind === 'goto') {
              legFailed = true;
              leg.message = outcome.message;
            } else if (pb.block.kind === 'capture') {
              captureFailed = true;
              leg.message = outcome.message;
              if (leg.inspection === null || leg.inspection === undefined) leg.inspection = 'error';
              if (!leg.photoDropped) leg.photoDropped = 'error';
            } else {
              leg.message = outcome.message;
            }
          } else if (pb.block.kind === 'goto') {
            leg.message = outcome.message.split(' — ')[0];
          }
        }
        // Leg end.
        if (aborted() && !legFailed) {
          leg.status = 'failed';
          leg.message = abortReason();
        } else {
          leg.status = legFailed ? 'failed' : 'done';
        }
        leg.finishedAt = this.stamp();
        const pose = this.deps.getPose?.() ?? null;
        if (pose) leg.pose = { x: pose.x, y: pose.y, yawDeg: pose.yawDeg };
        // Baseline mode: the leg's label set (union over its looks) is what the
        // next patrol's en-route diff compares against.
        if (run.mode === 'baseline') this.recordBaselineLegs(i);
        consecutiveFails = legFailed ? consecutiveFails + 1 : 0;
        if (consecutiveFails >= 2 && !twoFailuresAbort) {
          twoFailuresAbort = 'two consecutive legs failed';
          this.log(`run ${run.runId}: ${twoFailuresAbort} — aborting the route and going home`);
        }
        this.persist(run, s.findings);
        this.deps.emit('agent:patrol:leg', cloneRun(run));
      }
      s.currentLeg = -1;

      // Home. Runs after a two-failure abort too (that is the point of it),
      // never after an external abort (E-Stop, operator command, teleop).
      const home = s.blocks.find((b) => b.home);
      if (home) {
        if (aborted()) exec.skip(home.block, abortReason());
        else {
          exec.begin(home.block);
          const outcome = await exec.execute(home.block);
          exec.finish(home.block, outcome);
        }
      }

      if (run.mode === 'baseline' && !aborted() && this.baseline) {
        // The map as it is NOW (the whole route walked), falling back to the
        // last look's snapshot when the controller has no map to hand over.
        this.baseline.recordMap(run.routeId, run.window, this.deps.mapSnapshot?.() ?? s.lastMap);
      }
      // What is GONE: judged once, over the whole run, so a crate that moved
      // from one leg's view into another's is "unexpected" there and not also
      // "missing" here.
      if (run.mode === 'patrol' && !aborted()) this.checkMissing();

      // Final status.
      if (aborted()) {
        run.status = 'aborted';
        run.reason = abortReason();
      } else if (twoFailuresAbort) {
        run.status = 'aborted';
        run.reason = twoFailuresAbort;
      } else if (run.legs.length > 0 && run.legs.every((l) => l.status === 'failed')) {
        run.status = 'failed';
        run.reason = 'every leg failed';
      } else {
        const blind = blindLegs();
        const walked = run.legs.filter((l) => l.status === 'done');
        if (blind.length > 0 && blind.length === walked.length) {
          // Walked the whole route and compared nothing: that is a failed
          // patrol, not a clean one.
          run.status = 'failed';
          run.reason = 'no control photo or checklist answer at any checkpoint';
        } else {
          run.status = 'done';
          if (blind.length > 0) run.reason = `${blind.length} checkpoint(s) not inspected`;
        }
      }
    } catch (err) {
      run.status = 'failed';
      run.reason = `crashed: ${msg(err)}`;
      for (const leg of run.legs) if (leg.status === 'pending' || leg.status === 'running') leg.status = 'skipped';
      console.error(`[Patrol] run ${run.runId} crashed: ${msg(err)}`);
    } finally {
      run.finishedAt = this.stamp();
      run.findingCount = s.findings.length;
      if (patrolBlock) {
        const done = run.legs.filter((l) => l.status === 'done').length;
        const noBaseline =
          run.mode === 'baseline' ? run.legs.filter((l) => l.status === 'done' && l.photoDropped === 'person').map((l) => l.name) : [];
        const blind = blindLegs().map((l) => l.name);
        // Legs walked without a baseline label set: their en-route object diff
        // was skipped, so fewer findings were possible than the count suggests.
        const uncompared = [...s.labelSkipLegs].map((i) => run.legs[i]?.name ?? `leg ${i + 1}`);
        const summary =
          `${run.mode === 'baseline' ? 'Baseline' : 'Patrol'} ${run.status}: ${done}/${run.legs.length} checkpoint(s), ` +
          `${s.findings.length} finding(s)${run.reason ? ` — ${run.reason}` : ''}.` +
          (noBaseline.length > 0
            ? ` No baseline for ${noBaseline.join(', ')} — a person was in frame, so nothing was recorded there; retake those checkpoints.`
            : '') +
          (blind.length > 0
            ? ` No control photo or checklist answer for ${blind.join(', ')} — those checkpoints were not inspected.`
            : '') +
          (uncompared.length > 0
            ? ` No baseline in window ${run.window ?? DEFAULT_WINDOW} for ${uncompared.join(', ')} — walked but not compared en route; run a baseline (or promote this run).`
            : '');
        exec.finish(patrolBlock, { ok: run.status === 'done', message: summary });
      }
      this.persist(run, s.findings);
      this.last = cloneRun(run);
      this.session = null;
      this.abortRequest = null;
      this.deps.emit('agent:patrol:finished', cloneRun(run));
    }
    return cloneRun(run);
  }

  // ── capture / inspect host ────────────────────────────────────────────────

  /** What the block executor calls into. Stable object; reads the live session. */
  captureHost(): PatrolCaptureHost {
    return {
      context: (checkpointId) => this.captureContext(checkpointId),
      baselinePhoto: (checkpointId) => {
        const s = this.session;
        if (!s || s.run.mode !== 'patrol' || !this.baseline) return null;
        return this.baseline.readPhoto(s.run.routeId, s.run.window, checkpointId);
      },
      hashGate: this.hashGate,
      checklist: (b64, exp) => this.checklistFn(b64, exp),
      recordCapture: (checkpointId, rec) => this.recordCapture(checkpointId, rec),
      inspect: async (checkpointId) => this.inspect(checkpointId),
    };
  }

  private captureContext(checkpointId: string): PatrolCaptureContext | null {
    const s = this.session;
    if (!s) return null;
    const legIndex = s.run.legs.findIndex((l) => l.checkpointId === checkpointId);
    const checkpoint = s.route.checkpoints[legIndex];
    if (legIndex < 0 || !checkpoint) return null;
    return { runId: s.run.runId, routeId: s.run.routeId, mode: s.run.mode, window: s.run.window, legIndex, checkpoint };
  }

  private recordCapture(checkpointId: string, rec: CaptureRecord): { photoKey: string | null } {
    const s = this.session;
    const ctx = this.captureContext(checkpointId);
    if (!s || !ctx) return { photoKey: null };
    const leg = s.run.legs[ctx.legIndex];
    let photoKey: string | null = null;
    const at = this.stamp();
    if (rec.photo && this.runs) {
      photoKey = this.runs.savePhoto(s.run.routeId, s.run.runId, checkpointId, rec.photo);
      if (photoKey) {
        this.deps.uploadPhoto?.({
          runId: s.run.runId,
          key: `${checkpointId}.jpg`,
          jpeg: rec.photo,
          kind: s.run.mode === 'baseline' ? 'baseline' : 'control',
          checkpointId,
          routeId: s.run.routeId,
          capturedAt: at,
        });
      }
    }
    leg.photoKey = photoKey;
    leg.photoDropped = rec.photoDropped;
    if (rec.inspection) leg.inspection = rec.inspection;
    if (rec.message) leg.message = rec.message;
    s.captures.set(checkpointId, { answers: rec.answers, model: rec.model, photoKey, similarity: rec.similarity });

    if (s.run.mode === 'baseline' && this.baseline) {
      if (rec.photoDropped === 'person') {
        // A person in the operator-supervised baseline shot is the common
        // case, and it must NEVER become "normal": a baseline that says
        // personPresent=true would silence every later person at this
        // checkpoint (checklistCompare only fires on current && !baseline)
        // and, having no photo, would never trip the hash gate either. The
        // same rule promoteRun applies — the leg is skipped and the run
        // summary says the checkpoint has to be retaken.
        leg.inspection = 'skipped';
        leg.message = `person in frame — no baseline recorded for ${leg.name}; retake this checkpoint`;
      } else if (rec.photoDropped !== 'error') {
        this.baseline.recordCheckpoint(s.run.routeId, s.run.window, {
          checkpointId,
          runId: s.run.runId,
          photo: rec.photo,
          answers: rec.answers,
          model: rec.model,
        });
        leg.inspection = 'recorded';
      }
    }
    this.persist(s.run, s.findings);
    return { photoKey };
  }

  /** The `inspect` block: checklist diff vs baseline → candidates → findings. */
  private async inspect(checkpointId: string): Promise<{ inspection: PatrolInspection; message: string; findings: number }> {
    const s = this.session;
    const ctx = this.captureContext(checkpointId);
    if (!s || !ctx) return { inspection: 'error', message: 'inspect: no active patrol run for this checkpoint', findings: 0 };
    const leg = s.run.legs[ctx.legIndex];
    const cap = s.captures.get(checkpointId);
    const finish = (inspection: PatrolInspection, message: string, findings = 0) => {
      leg.inspection = inspection;
      this.persist(s.run, s.findings);
      return { inspection, message, findings };
    };
    if (ctx.mode !== 'patrol') return finish('recorded', 'inspect: baseline mode records, it does not compare');
    if (!cap) return finish('error', 'inspect: no capture recorded for this checkpoint');
    if (leg.inspection === 'unchanged') {
      return finish('unchanged', `Unchanged against the baseline (hash similarity ${(cap.similarity ?? 0).toFixed(2)}) — no model call.`);
    }
    if (!cap.answers) return finish('error', 'inspect: the capture has no checklist answers');
    const base = this.baseline?.checkpoint(s.run.routeId, s.run.window, checkpointId) ?? null;
    if (!base || !base.answers) {
      return finish('no_baseline', `No baseline for ${ctx.checkpoint.name} in window ${s.run.window ?? DEFAULT_WINDOW} yet — run a baseline (or promote this run).`);
    }
    const items = checklistCompare(cap.answers, base.answers, ctx.checkpoint, base.acceptedAnswers);
    if (items.length === 0) return finish('same', `Same as the baseline on every checklist item (${cap.answers.oneLine}).`);
    const candidates = candidatesFromChecklist(items, {
      place: ctx.checkpoint.placeId,
      checkpointId,
      model: cap.model,
      baselinePhotoKey: base.photoKey,
      currentPhotoKey: cap.photoKey,
    });
    const result = s.confirmer.observe(candidates, { immediate: true });
    const here = this.deps.getPose?.() ?? null;
    const created = this.raiseFindings(
      result.confirmed,
      result.reobserved,
      ctx.legIndex,
      checkpointId,
      here ? { x: here.x, y: here.y, yawDeg: here.yawDeg } : null,
    );
    // A person at the checkpoint gets the same one line as a person en route.
    if (candidates.some((c) => c.type === 'person')) await this.speakPersonLine();
    return finish(
      'changed',
      `Differs from the baseline on ${items.length} item(s): ${items.map((i) => i.summary).join('; ')} — ${created} finding(s).`,
      created,
    );
  }

  // ── en-route ──────────────────────────────────────────────────────────────

  /**
   * Called by the controller after EVERY look while a patrol is active — the
   * cheap, continuous comparison. Label diff + map diff, both label/grid
   * work; no model call. Speaks the person line at most once per run.
   */
  async onLook(input: PatrolLookInput): Promise<void> {
    const s = this.session;
    if (!s) return;
    if (input.map) s.lastMap = input.map;
    const legIndex = s.currentLeg;
    if (legIndex >= 0) {
      const set = s.legLabels.get(legIndex) ?? new Set<string>();
      for (const l of input.labels) set.add(l.trim().toLowerCase());
      s.legLabels.set(legIndex, set);
    }
    if (s.run.mode !== 'patrol' || !this.baseline || legIndex < 0) return;

    const place = input.place;
    const baselineLabels = this.baseline.legLabels(s.run.routeId, s.run.window, legIndex);
    const candidates: Candidate[] = [];
    if (baselineLabels.length > 0) {
      candidates.push(...labelSetDiff(input.labels, baselineLabels, place, this.watchlist).candidates);
    } else if (!s.labelSkipLegs.has(legIndex)) {
      // No baseline labels for this leg — the route × window was never walked
      // as a baseline, or that baseline run recorded nothing here. Diffing
      // against an empty set makes EVERY watch-listed label "new", so a normal
      // room would raise "unexpected crate/cable/box…" findings. The checkpoint
      // path refuses the same way (`no_baseline`) and the map diff too; the
      // person candidate below stays, since a person is a finding regardless.
      s.labelSkipLegs.add(legIndex);
      this.log(
        `label diff skipped for run ${s.run.runId}: no baseline labels for leg ${legIndex + 1} ` +
          `(${s.run.legs[legIndex]?.name ?? '?'}) in window ${s.run.window ?? DEFAULT_WINDOW}`,
      );
    }
    if (input.personVisible && !candidates.some((c) => c.type === 'person')) {
      candidates.push({
        key: `person|${place ?? '?'}`,
        type: 'person',
        source: 'enroute_semantic',
        place,
        summary: `person in ${place ?? 'an unknown place'}`,
        evidence: { labels: { added: ['person'], missing: [] } },
        confidence: 0.6,
        model: null,
      });
    }
    if (input.pose && input.map) {
      const data = this.baseline.load(s.run.routeId, s.run.window);
      const geo = mapDiff(data.map, input.map, {
        pose: input.pose,
        radiusM: this.deps.diffRadiusM ?? config.agentMode.patrol.diffRadiusM,
        minBlobM2: this.deps.minBlobM2 ?? config.agentMode.patrol.minBlobM2,
        peers: input.peers,
        accepted: data.acceptedBlobs,
        places: input.places,
      });
      candidates.push(...geo.candidates);
      if (geo.reason && geo.reason !== s.mapReasonLogged) {
        s.mapReasonLogged = geo.reason;
        this.log(`map diff skipped for run ${s.run.runId}: ${geo.reason}`);
      }
    }
    const result = s.confirmer.observe(candidates);
    this.raiseFindings(result.confirmed, result.reobserved, legIndex, null, input.pose);
    if (result.confirmed.some((c) => c.type === 'person')) await this.speakPersonLine();
  }

  /**
   * Run-end: per done leg, what the baseline leg had on the watch-list and
   * this leg never saw — minus labels that turned up as NEW elsewhere in this
   * run (that object moved; it is already a finding where it is now).
   */
  private checkMissing(): void {
    const s = this.session;
    if (!s || s.run.mode !== 'patrol' || !this.baseline) return;
    const movedLabels = new Set<string>();
    for (const f of s.findings) for (const l of f.evidence.labels?.added ?? []) movedLabels.add(l.toLowerCase());
    for (const leg of s.run.legs) {
      if (leg.status !== 'done') continue;
      const seen = s.legLabels.get(leg.index) ?? new Set<string>();
      if (seen.size === 0) continue; // no look on this leg — nothing can be judged missing
      const baseLabels = this.baseline.legLabels(s.run.routeId, s.run.window, leg.index).filter((l) => !movedLabels.has(l));
      const candidates = missingLabelCandidates(seen, baseLabels, leg.placeId, this.watchlist);
      if (candidates.length === 0) continue;
      const result = s.confirmer.observe(candidates, { immediate: true });
      this.raiseFindings(result.confirmed, result.reobserved, leg.index, null);
    }
  }

  private recordBaselineLegs(legIndex: number): void {
    const s = this.session;
    if (!s || !this.baseline || s.run.mode !== 'baseline') return;
    const labels = s.legLabels.get(legIndex);
    if (!labels || labels.size === 0) return;
    this.baseline.recordLegLabels(s.run.routeId, s.run.window, legIndex, [...labels]);
  }

  private async speakPersonLine(): Promise<void> {
    const s = this.session;
    if (!s || s.spokenPerson || !this.deps.say) return;
    s.spokenPerson = true;
    const language = this.deps.language?.() ?? 'en';
    try {
      await this.deps.say(patrolPhrase('person', language), language);
    } catch {
      /* text-only */
    }
  }

  // ── findings ──────────────────────────────────────────────────────────────

  private raiseFindings(
    confirmed: readonly Candidate[],
    reobserved: readonly Candidate[],
    legIndex: number,
    checkpointId: string | null,
    pose: { x: number; y: number; yawDeg: number } | null = null,
  ): number {
    const s = this.session;
    if (!s) return 0;
    const night = isNightWindow(s.route, s.run.window);
    let created = 0;
    for (const c of confirmed) {
      const finding: PatrolFinding = {
        id: uuidv4(),
        runId: s.run.runId,
        routeId: s.run.routeId,
        robotId: this.deps.robotId,
        checkpointId: c.checkpointId ?? checkpointId,
        legIndex,
        type: c.type,
        severity: findingSeverity(c.type, night),
        source: c.source,
        place: c.place,
        pose,
        at: this.stamp(),
        summary: c.summary,
        evidence: { ...c.evidence, observations: c.evidence.observations ?? 1 },
        model: c.model,
        confidence: c.confidence,
        status: 'open',
      };
      // Persons: never an image, whatever the source said.
      if (finding.type === 'person') {
        finding.evidence = { ...finding.evidence, currentPhotoKey: null, baselinePhotoKey: null };
      }
      s.findings.push(finding);
      s.confirmer.markEmitted(c.key, finding.id);
      const leg = s.run.legs[legIndex];
      if (leg) leg.findingIds.push(finding.id);
      s.run.findingCount = s.findings.length;
      created++;
      this.log(`FINDING ${finding.type} (${finding.source}, ${finding.severity}) — ${finding.summary}`);
      this.persist(s.run, s.findings);
      this.deps.emit('agent:finding:detected', cloneRun(s.run), { ...finding });
      // A checkpoint photo that now evidences a finding is re-uploaded as such,
      // so the server keeps it under the finding retention rather than 72 h.
      if (finding.evidence.currentPhotoKey && this.runs && finding.checkpointId) {
        const jpeg = this.runs.readPhoto(s.run.runId, finding.checkpointId);
        if (jpeg) {
          this.deps.uploadPhoto?.({
            runId: s.run.runId,
            key: `${finding.checkpointId}.jpg`,
            jpeg,
            kind: 'finding',
            checkpointId: finding.checkpointId,
            routeId: s.run.routeId,
            capturedAt: finding.at,
          });
        }
      }
    }
    for (const c of reobserved) {
      const id = s.confirmer.findingIdFor(c.key);
      const finding = id ? s.findings.find((f) => f.id === id) : undefined;
      if (!finding) continue;
      finding.evidence = { ...finding.evidence, ...c.evidence, observations: (finding.evidence.observations ?? 1) + 1 };
      if (c.source !== finding.source && (c.source === 'enroute_both' || finding.source.startsWith('enroute') && c.source.startsWith('enroute'))) {
        finding.source = 'enroute_both';
        finding.confidence = Math.min(1, finding.confidence + 0.1);
      }
      if (c.evidence.blob) finding.summary = c.summary;
      this.persist(s.run, s.findings);
      this.deps.emit('agent:finding:confirmed', cloneRun(s.run), { ...finding });
    }
    return created;
  }

  // ── operator feedback ─────────────────────────────────────────────────────

  /** "This is normal": fold a finding's observation into the baseline. */
  markNormal(findingId: string, runId: string): { ok: boolean; message: string } {
    if (!this.baseline || !this.runs) return { ok: false, message: 'this robot has no workspace' };
    const active = this.session?.run.runId === runId ? this.session : null;
    const run = active?.run ?? this.runs.findRun(runId);
    if (!run) return { ok: false, message: `no run ${runId} on this robot` };
    const findings = active ? active.findings : this.runs.findings(run.routeId, runId);
    const finding = findings.find((f) => f.id === findingId);
    if (!finding) return { ok: false, message: `no finding ${findingId} in run ${runId}` };
    const result = this.baseline.markNormal(finding, run.window);
    if (result.ok) {
      finding.status = 'dismissed_normal';
      this.runs.saveFindings(run.routeId, runId, findings);
    }
    return { ok: result.ok, message: result.message };
  }

  /** Make a finished run's captures the baseline for its window. */
  promoteRun(runId: string): { ok: boolean; message: string } {
    if (!this.baseline || !this.runs) return { ok: false, message: 'this robot has no workspace' };
    if (this.session?.run.runId === runId) return { ok: false, message: 'the run is still active — wait for it to finish' };
    const run = this.runs.findRun(runId);
    if (!run) return { ok: false, message: `no run ${runId} on this robot` };
    let promoted = 0;
    let skipped = 0;
    for (const leg of run.legs) {
      if (leg.status !== 'done') continue;
      // Any dropped frame — a person in view, or a capture that errored — means
      // this run has no usable picture of the checkpoint. Promoting it anyway
      // would call recordCheckpoint with photo=null, which DELETES the existing
      // baseline JPEG (baseline.ts) while the answers fall back to the previous
      // entry, so one flaky frame would destroy a good baseline photo.
      if (leg.photoDropped) {
        skipped++;
        continue;
      }
      const photo = this.runs.readPhoto(runId, leg.checkpointId);
      // The checklist answers ride beside the run in `answers.json` (model
      // text, kept out of run.json); the promoted baseline takes the photo and
      // those answers, falling back to the entry already there.
      const prev = this.baseline.checkpoint(run.routeId, run.window, leg.checkpointId);
      const answers = this.readAnswers(run, leg.checkpointId) ?? prev?.answers ?? null;
      if (!photo && !answers) continue;
      this.baseline.recordCheckpoint(run.routeId, run.window, {
        checkpointId: leg.checkpointId,
        runId,
        photo,
        answers,
        model: prev?.model ?? null,
      });
      // Contract §2: baseline photos are also uploaded with the baseline run's
      // id and kind 'baseline'. This run's copy went up as 'control' (72 h
      // retention); findings will reference `<runId>/<cp>.jpg` as the baseline
      // side of the pair, so the server needs a baseline-retained copy too.
      if (photo) {
        this.deps.uploadPhoto?.({
          runId,
          key: `${leg.checkpointId}.jpg`,
          jpeg: photo,
          kind: 'baseline',
          checkpointId: leg.checkpointId,
          routeId: run.routeId,
          capturedAt: leg.finishedAt ?? run.finishedAt ?? this.stamp(),
        });
      }
      promoted++;
    }
    const skippedNote = skipped > 0 ? ` — ${skipped} checkpoint(s) skipped (no usable capture), their baseline is unchanged` : '';
    return promoted > 0
      ? {
          ok: true,
          message: `promoted ${promoted} checkpoint(s) of run ${runId} to the ${run.window ?? DEFAULT_WINDOW} baseline of ${run.routeName}${skippedNote}`,
        }
      : { ok: false, message: `nothing to promote — the run kept no photos or answers${skippedNote}` };
  }

  /** Checklist answers of a run's checkpoint, kept beside the run for promotion. */
  private readAnswers(run: PatrolRun, checkpointId: string): ChecklistAnswers | null {
    if (!this.runs) return null;
    try {
      const file = path.join(this.runs.runDir(run.routeId, run.runId), 'answers.json');
      const all = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, ChecklistAnswers>;
      return all[checkpointId] ?? null;
    } catch {
      return null;
    }
  }

  // ── persistence ───────────────────────────────────────────────────────────

  private persist(run: PatrolRun, findings: readonly PatrolFinding[]): void {
    if (!this.runs) return;
    try {
      this.runs.saveRun(run);
      this.runs.saveFindings(run.routeId, run.runId, findings);
      const s = this.session;
      if (s && s.run.runId === run.runId && s.captures.size > 0) {
        const answers: Record<string, ChecklistAnswers> = {};
        for (const [cp, cap] of s.captures) if (cap.answers) answers[cp] = cap.answers;
        this.deps.workspace?.atomicWrite(path.join(this.runs.runDir(run.routeId, run.runId), 'answers.json'), JSON.stringify(answers, null, 2));
      }
    } catch (err) {
      console.warn(`[Patrol] could not persist run ${run.runId}: ${msg(err)}`);
    }
  }

  /**
   * Runs left `status:'running'` on disk by a crash, a redeploy or a reboot.
   * Nothing else ever rewrites them, so without this the robot keeps serving a
   * run that is not running: the app shows a pulsing live-run card forever, its
   * abort button hits no session, and the server's scheduler treats the route
   * as busy and drops every later slot.
   */
  reconcileInterruptedRuns(): void {
    if (!this.runs) return;
    for (const run of this.runs.listRuns(Number.MAX_SAFE_INTEGER)) {
      if (run.status !== 'running') continue;
      if (this.session?.run.runId === run.runId) continue; // never touch the live run
      run.status = 'aborted';
      run.reason = 'interrupted by an agent restart';
      run.finishedAt = this.stamp();
      for (const leg of run.legs) if (leg.status === 'pending' || leg.status === 'running') leg.status = 'skipped';
      this.persist(run, this.runs.findings(run.routeId, run.runId));
      this.log(`run ${run.runId} was left running by a restart — closed as aborted`);
      this.deps.emit('agent:patrol:finished', cloneRun(run));
    }
  }

  /** Retention sweep at boot + hourly. `unref()`ed — never holds shutdown open. */
  startRetentionSweep(): void {
    if (!this.runs || this.sweepTimer) return;
    this.reconcileInterruptedRuns();
    const tick = (): void => {
      try {
        const removed = this.runs!.sweep();
        if (removed.length > 0) this.log(`retention sweep removed ${removed.length} photo(s)`);
      } catch (err) {
        console.warn(`[Patrol] retention sweep failed: ${msg(err)}`);
      }
    };
    tick();
    this.sweepTimer = setInterval(tick, 3600_000);
    this.sweepTimer.unref();
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }
}

function cloneRun(run: PatrolRun): PatrolRun {
  return { ...run, legs: run.legs.map((l) => ({ ...l, findingIds: [...l.findingIds] })) };
}
