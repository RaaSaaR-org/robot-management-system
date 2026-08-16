/**
 * @file PatrolService.ts
 * @description Patrol (TASK-212): routes CRUD (source of record), run/finding
 *              history, ingest of the robot's `agent:patrol:*` /
 *              `agent:finding:*` events (persist + exactly one alert per
 *              finding + one warning per skipped run + compliance trail), the
 *              start/abort/promote/normal proxies to the robot, the VDA5050
 *              export and the baseline lookup for the photo pairs.
 * @feature patrol
 */

import { v4 as uuidv4 } from 'uuid';
import { alertService as defaultAlertService } from './AlertService.js';
import { complianceLogService as defaultComplianceLogService } from './ComplianceLogService.js';
import { incidentService as defaultIncidentService } from './IncidentService.js';
import { robotManager as defaultRobotManager } from './RobotManager.js';
import { HttpClient, HttpClientError, HTTP_TIMEOUTS } from './HttpClient.js';
import { agentServiceAuthHeaders } from './agentServiceAuth.js';
import {
  patrolRepository as defaultPatrolRepository,
  type PatrolRepository,
  type PatrolRouteRecord,
  type PatrolRunRecord,
  type PatrolFindingRecord,
  type CreatePatrolRouteInput,
  type UpdatePatrolRouteInput,
  type PatrolRunFilters,
  type PatrolFindingFilters,
} from '../repositories/PatrolRepository.js';
import { computeNextRun, validateCron } from '../utils/cron.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import type { AlertSeverity } from '../repositories/AlertRepository.js';
import type { IncidentSeverity, IncidentType } from '../types/incident.types.js';
import {
  PatrolCheckpointActions,
  PatrolFindingSeverities,
  PatrolFindingTypes,
  PatrolRunModes,
  PatrolRunOrigins,
  type AgentModeEvent,
  type PatrolCheckpoint,
  type PatrolCheckpointAction,
  type PatrolFinding,
  type PatrolFindingSeverity,
  type PatrolFindingType,
  type PatrolLeg,
  type PatrolLegStatus,
  type PatrolRunStatus,
  type PatrolRoute,
  type PatrolRun,
  type PatrolRunMode,
  type PatrolRunOrigin,
  type PatrolStartResult,
  type PatrolTimeWindow,
} from '../types/agent-mode.types.js';

// ============================================================================
// TYPES
// ============================================================================

/** What the routes accept for POST/PUT /api/patrol/routes. */
export interface PatrolRouteInputBody {
  name?: unknown;
  robotId?: unknown;
  twinId?: unknown;
  checkpoints?: unknown;
  cronExpression?: unknown;
  enabled?: unknown;
  timeWindows?: unknown;
  homePlaceId?: unknown;
}

export interface StartRunOptions {
  robotId?: string | null;
  mode?: PatrolRunMode;
  origin?: PatrolRunOrigin;
}

/**
 * Outcome of a start attempt. `unreachable` = the robot could not be asked
 * (502 to the caller): the server itself has recorded a `skipped` run with
 * reason 'unreachable' and raised the warning alert. Otherwise `result` is
 * the robot's own {@link PatrolStartResult} (HTTP 200 even when refused —
 * the robot emits the skipped run + the server alerts on ingest).
 */
export interface StartRunOutcome {
  result: PatrolStartResult;
  unreachable: boolean;
  robotId: string;
  route: PatrolRouteRecord;
}

/** VDA5050-style order for a route (nodes = checkpoints in order, edges chain them). */
export interface PatrolVda5050Export {
  headerId: number;
  timestamp: string;
  version: string;
  manufacturer: string;
  serialNumber: string;
  orderId: string;
  orderUpdateId: number;
  nodes: Array<{
    nodeId: string;
    sequenceId: number;
    released: boolean;
    nodeDescription?: string;
    nodePosition?: { x: number; y: number; theta?: number; mapId: string };
    actions: Array<{
      actionId: string;
      actionType: string;
      blockingType: 'NONE' | 'SOFT' | 'HARD';
      actionParameters?: Array<{ key: string; value: unknown }>;
    }>;
  }>;
  edges: Array<{
    edgeId: string;
    sequenceId: number;
    startNodeId: string;
    endNodeId: string;
    released: boolean;
    actions: never[];
  }>;
}

export interface PatrolBaselineInfo {
  runId: string;
  window: string | null;
  /** checkpointId → photo key (`<checkpointId>.jpg`, relative to the run) */
  photos: Record<string, string>;
  robotId: string;
  finishedAt: string | null;
}

/** Minimal robot lookup the service needs; RobotManager satisfies it. */
export interface PatrolRobotLookup {
  getRegisteredRobot(robotId: string): Promise<{ baseUrl: string } | null | undefined>;
}

export interface PatrolServiceDeps {
  repo?: PatrolRepository;
  alerts?: Pick<typeof defaultAlertService, 'createRobotAlert' | 'acknowledgeAlert'>;
  compliance?: Pick<typeof defaultComplianceLogService, 'logSystemEvent'>;
  incidents?: Pick<typeof defaultIncidentService, 'createIncident'> | null;
  robots?: PatrolRobotLookup;
  /** Factory so tests can fake the transport. */
  httpClient?: (baseUrl: string, timeoutMs: number, headers?: Record<string, string>) => Pick<HttpClient, 'get' | 'post'>;
  now?: () => number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default windows when a route is created without any (day 07–19, night 19–07). */
export const DEFAULT_TIME_WINDOWS: PatrolTimeWindow[] = [
  { id: 'day', name: 'Day', startHour: 7, endHour: 19 },
  { id: 'night', name: 'Night', startHour: 19, endHour: 7 },
];

/** Robot answers "accepted/refused" fast; the walk itself is asynchronous. */
const START_TIMEOUT_MS = HTTP_TIMEOUTS.MEDIUM;

// ============================================================================
// PURE HELPERS (exported for tests)
// ============================================================================

/**
 * True when a run's window is a night window: the route's matching
 * `PatrolTimeWindow` is named/id'd "night" or wraps midnight; without a route
 * to consult, the id alone decides.
 */
export function isNightWindow(windowId: string | null | undefined, timeWindows: PatrolTimeWindow[] = []): boolean {
  if (!windowId) return false;
  const w = timeWindows.find((tw) => tw.id === windowId);
  if (w) {
    if (/night/i.test(w.id) || /night|nacht/i.test(w.name)) return true;
    return w.endHour <= w.startHour; // wraps midnight
  }
  return /night|nacht/i.test(windowId);
}

/**
 * Severity by type × window (the settled mapping): person or door_open at
 * night → high; person by day → medium; unexpected_object / object_on_floor →
 * medium; missing_object / out_of_place / lights_on / expectation_failed /
 * other → low. `door_open` by day is medium.
 */
export function deriveFindingSeverity(type: PatrolFindingType, night: boolean): PatrolFindingSeverity {
  switch (type) {
    case 'person':
      return night ? 'high' : 'medium';
    case 'door_open':
      return night ? 'high' : 'medium';
    case 'unexpected_object':
    case 'object_on_floor':
      return 'medium';
    case 'missing_object':
    case 'out_of_place':
    case 'lights_on':
    case 'expectation_failed':
    case 'other':
    default:
      return 'low';
  }
}

/** Finding severity → platform AlertSeverity ('critical' is never used for findings). */
export function alertSeverityFor(severity: PatrolFindingSeverity): AlertSeverity {
  switch (severity) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    default:
      return 'info';
  }
}

/** The tail the AlertsPage parses to deep-link into RunDetail. */
export function findingAlertTail(findingId: string, runId: string): string {
  return `[finding:${findingId} run:${runId}]`;
}

/** Build the alert message for a finding (route/run/place/time + the link tail). */
export function findingAlertMessage(finding: PatrolFinding, run: PatrolRun | null): string {
  const parts = [
    finding.summary,
    `route: ${run?.routeName ?? finding.routeId}`,
    `run: ${finding.runId}`,
    `place: ${finding.place ?? 'unknown'}`,
    `at: ${finding.at}`,
    `type: ${finding.type}`,
    `severity: ${finding.severity}`,
    `source: ${finding.source}`,
  ];
  return `${parts.join(' · ')} ${findingAlertTail(finding.id, finding.runId)}`;
}

/** Legs for a run the server records itself (robot never answered): all skipped. */
const TERMINAL_RUN_STATUSES: ReadonlySet<PatrolRunStatus> = new Set(['done', 'aborted', 'failed', 'skipped']);
const SETTLED_LEG_STATUSES: ReadonlySet<PatrolLegStatus> = new Set(['done', 'failed', 'skipped']);

function settledLegCount(legs: PatrolLeg[] | undefined): number {
  return (legs ?? []).filter((l) => SETTLED_LEG_STATUSES.has(l.status)).length;
}

/**
 * True when `incoming` is an OLDER snapshot of the run than `stored`: it would
 * move a terminal run back to 'running', drop `finishedAt`, or report fewer
 * settled legs than already persisted. Every `agent:patrol:*` event carries
 * the whole run and the robot pushes them fire-and-forget over separate
 * connections, so a `leg` (or a finding's embedded run) can land after the
 * `finished` it preceded — such a snapshot must never replace the newer row.
 */
export function isRunDowngrade(stored: PatrolRun | null | undefined, incoming: PatrolRun): boolean {
  if (!stored) return false;
  const storedTerminal = TERMINAL_RUN_STATUSES.has(stored.status);
  const incomingTerminal = TERMINAL_RUN_STATUSES.has(incoming.status);
  if (storedTerminal && !incomingTerminal) return true;
  if (stored.finishedAt && !incoming.finishedAt) return true;
  if (settledLegCount(incoming.legs) < settledLegCount(stored.legs)) return true;
  return false;
}

export function skippedLegsFor(route: PatrolRoute): PatrolLeg[] {
  return route.checkpoints.map((c, index) => ({
    index,
    checkpointId: c.id,
    placeId: c.placeId,
    name: c.name,
    status: 'skipped',
    findingIds: [],
  }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPatrolRun(v: unknown): v is PatrolRun {
  return isRecord(v) && typeof v.runId === 'string' && typeof v.routeId === 'string' && typeof v.status === 'string';
}

function isPatrolFinding(v: unknown): v is PatrolFinding {
  return isRecord(v) && typeof v.id === 'string' && typeof v.runId === 'string' && typeof v.type === 'string';
}

// ============================================================================
// VALIDATION
// ============================================================================

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cp';
}

/**
 * Validate + normalise checkpoints. Ids are minted when missing (`cp-<n>-<slug>`),
 * names default to the place id, actions default to `['capture']`.
 */
export function normaliseCheckpoints(raw: unknown): PatrolCheckpoint[] {
  if (!Array.isArray(raw)) throw new BadRequestError('checkpoints must be an array');
  const seen = new Set<string>();
  return raw.map((c, i) => {
    if (!isRecord(c)) throw new BadRequestError(`checkpoints[${i}] must be an object`);
    const placeId = typeof c.placeId === 'string' ? c.placeId.trim() : '';
    if (!placeId) throw new BadRequestError(`checkpoints[${i}].placeId is required`);
    const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : placeId;
    let id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `cp-${i + 1}-${slug(placeId)}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const actionsRaw = Array.isArray(c.actions) ? c.actions : ['capture'];
    const actions: PatrolCheckpointAction[] = [];
    for (const a of actionsRaw) {
      if (!PatrolCheckpointActions.includes(a as PatrolCheckpointAction)) {
        throw new BadRequestError(`checkpoints[${i}].actions contains unknown action "${String(a)}"`);
      }
      if (!actions.includes(a as PatrolCheckpointAction)) actions.push(a as PatrolCheckpointAction);
    }
    const headingDeg =
      c.headingDeg === undefined || c.headingDeg === null
        ? null
        : typeof c.headingDeg === 'number' && Number.isFinite(c.headingDeg)
          ? c.headingDeg
          : (() => {
              throw new BadRequestError(`checkpoints[${i}].headingDeg must be a number`);
            })();
    const dwellMs =
      c.dwellMs === undefined || c.dwellMs === null
        ? undefined
        : typeof c.dwellMs === 'number' && Number.isFinite(c.dwellMs) && c.dwellMs >= 0
          ? Math.round(c.dwellMs)
          : (() => {
              throw new BadRequestError(`checkpoints[${i}].dwellMs must be a non-negative number`);
            })();
    const expectations = Array.isArray(c.expectations)
      ? c.expectations.filter((e): e is string => typeof e === 'string' && e.trim().length > 0).map((e) => e.trim())
      : undefined;
    const cp: PatrolCheckpoint = { id, placeId, name, headingDeg, actions };
    if (dwellMs !== undefined) cp.dwellMs = dwellMs;
    if (expectations && expectations.length) cp.expectations = expectations;
    return cp;
  });
}

export function normaliseTimeWindows(raw: unknown): PatrolTimeWindow[] {
  if (raw === undefined) return DEFAULT_TIME_WINDOWS.map((w) => ({ ...w }));
  if (!Array.isArray(raw)) throw new BadRequestError('timeWindows must be an array');
  const seen = new Set<string>();
  return raw.map((w, i) => {
    if (!isRecord(w)) throw new BadRequestError(`timeWindows[${i}] must be an object`);
    const name = typeof w.name === 'string' && w.name.trim() ? w.name.trim() : `Window ${i + 1}`;
    const id = typeof w.id === 'string' && w.id.trim() ? w.id.trim() : slug(name);
    if (seen.has(id)) throw new BadRequestError(`timeWindows[${i}].id "${id}" is duplicated`);
    seen.add(id);
    const startHour = Number(w.startHour);
    const endHour = Number(w.endHour);
    for (const [k, v] of [['startHour', startHour], ['endHour', endHour]] as const) {
      if (!Number.isInteger(v) || v < 0 || v > 24) {
        throw new BadRequestError(`timeWindows[${i}].${k} must be an integer hour 0..24`);
      }
    }
    return { id, name, startHour, endHour };
  });
}

function optionalString(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new BadRequestError(`${field} must be a string`);
  return v.trim();
}

// ============================================================================
// SERVICE
// ============================================================================

export class PatrolService {
  private readonly repo: PatrolRepository;
  private readonly alerts: NonNullable<PatrolServiceDeps['alerts']>;
  private readonly compliance: NonNullable<PatrolServiceDeps['compliance']>;
  private readonly incidents: PatrolServiceDeps['incidents'];
  private readonly robots: PatrolRobotLookup;
  private readonly httpClient: NonNullable<PatrolServiceDeps['httpClient']>;
  private readonly now: () => number;
  /** runId → tail of the ingest chain: events for one run are applied in arrival order, never interleaved. */
  private readonly ingestChains = new Map<string, Promise<void>>();

  constructor(deps: PatrolServiceDeps = {}) {
    this.repo = deps.repo ?? defaultPatrolRepository;
    this.alerts = deps.alerts ?? defaultAlertService;
    this.compliance = deps.compliance ?? defaultComplianceLogService;
    this.incidents = deps.incidents === undefined ? defaultIncidentService : deps.incidents;
    this.robots = deps.robots ?? (defaultRobotManager as unknown as PatrolRobotLookup);
    this.httpClient =
      deps.httpClient ?? ((baseUrl, timeoutMs, headers) => new HttpClient(baseUrl, timeoutMs, headers));
    this.now = deps.now ?? (() => Date.now());
  }

  // --------------------------------------------------------------------------
  // Routes
  // --------------------------------------------------------------------------

  async listRoutes(filters: { robotId?: string } = {}): Promise<PatrolRouteRecord[]> {
    return this.repo.listRoutes(filters);
  }

  async getRoute(id: string): Promise<PatrolRouteRecord> {
    const route = await this.repo.findRouteById(id);
    if (!route) throw new NotFoundError('PatrolRoute', id);
    return route;
  }

  async createRoute(body: PatrolRouteInputBody): Promise<PatrolRouteRecord> {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new BadRequestError('name is required');
    const checkpoints = normaliseCheckpoints(body.checkpoints ?? []);
    if (checkpoints.length === 0) throw new BadRequestError('at least one checkpoint is required');
    const cronExpression = optionalString(body.cronExpression, 'cronExpression') ?? null;
    if (cronExpression) this.assertCron(cronExpression);
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
    const input: CreatePatrolRouteInput = {
      name,
      robotId: optionalString(body.robotId, 'robotId') ?? null,
      twinId: optionalString(body.twinId, 'twinId') ?? null,
      checkpoints,
      cronExpression,
      enabled,
      timeWindows: normaliseTimeWindows(body.timeWindows),
      homePlaceId: optionalString(body.homePlaceId, 'homePlaceId') ?? null,
      nextRunAt: cronExpression && enabled ? computeNextRun(cronExpression, new Date(this.now()), 'PatrolService') : null,
    };
    return this.repo.createRoute(input);
  }

  async updateRoute(id: string, body: PatrolRouteInputBody): Promise<PatrolRouteRecord> {
    const existing = await this.getRoute(id);
    const patch: UpdatePatrolRouteInput = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) throw new BadRequestError('name must be a non-empty string');
      patch.name = name;
    }
    if (body.checkpoints !== undefined) {
      patch.checkpoints = normaliseCheckpoints(body.checkpoints);
      if (patch.checkpoints.length === 0) throw new BadRequestError('at least one checkpoint is required');
    }
    if (body.robotId !== undefined) patch.robotId = optionalString(body.robotId, 'robotId') ?? null;
    if (body.twinId !== undefined) patch.twinId = optionalString(body.twinId, 'twinId') ?? null;
    if (body.homePlaceId !== undefined) patch.homePlaceId = optionalString(body.homePlaceId, 'homePlaceId') ?? null;
    if (body.timeWindows !== undefined) patch.timeWindows = normaliseTimeWindows(body.timeWindows);
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.cronExpression !== undefined) {
      const cron = optionalString(body.cronExpression, 'cronExpression') ?? null;
      if (cron) this.assertCron(cron);
      patch.cronExpression = cron;
    }
    // Any change to the schedule re-plans the next slot from now (no back-fill).
    const cronAfter = patch.cronExpression !== undefined ? patch.cronExpression : existing.cronExpression;
    const enabledAfter = patch.enabled !== undefined ? patch.enabled : existing.enabled;
    if (patch.cronExpression !== undefined || patch.enabled !== undefined) {
      patch.nextRunAt = cronAfter && enabledAfter ? computeNextRun(cronAfter, new Date(this.now()), 'PatrolService') : null;
    }
    const updated = await this.repo.updateRoute(id, patch);
    if (!updated) throw new NotFoundError('PatrolRoute', id);
    return updated;
  }

  async deleteRoute(id: string): Promise<void> {
    const ok = await this.repo.deleteRoute(id);
    if (!ok) throw new NotFoundError('PatrolRoute', id);
  }

  private assertCron(cron: string): void {
    const v = validateCron(cron, 1);
    if (!v.valid) throw new BadRequestError(`invalid cronExpression: ${v.error ?? 'unparseable'}`);
  }

  validateCronExpression(cron: string): { valid: boolean; nextRuns: string[]; error?: string } {
    const v = validateCron(cron, 5, new Date(this.now()));
    return v.valid ? { valid: true, nextRuns: v.nextRuns ?? [] } : { valid: false, nextRuns: [], error: v.error };
  }

  /** VDA5050-style order: one node per checkpoint (+ home), sequential edges. */
  async exportVda5050(routeId: string): Promise<PatrolVda5050Export> {
    const route = await this.getRoute(routeId);
    const nodes: PatrolVda5050Export['nodes'] = [];
    const edges: PatrolVda5050Export['edges'] = [];
    const stops: Array<{ id: string; placeId: string; name: string; cp: PatrolCheckpoint | null }> = route.checkpoints.map(
      (cp) => ({ id: cp.id, placeId: cp.placeId, name: cp.name, cp }),
    );
    if (route.homePlaceId) stops.push({ id: 'home', placeId: route.homePlaceId, name: 'Home', cp: null });
    stops.forEach((stop, i) => {
      const actions: PatrolVda5050Export['nodes'][number]['actions'] = [];
      if (stop.cp) {
        if (stop.cp.headingDeg !== null && stop.cp.headingDeg !== undefined) {
          actions.push({
            actionId: `${stop.id}-align`,
            actionType: 'alignHeading',
            blockingType: 'HARD',
            actionParameters: [{ key: 'headingDeg', value: stop.cp.headingDeg }],
          });
        }
        for (const a of stop.cp.actions) {
          if (a === 'capture') {
            actions.push({ actionId: `${stop.id}-capture`, actionType: 'capturePhoto', blockingType: 'HARD',
              actionParameters: [{ key: 'checkpointId', value: stop.id }] });
          } else if (a === 'dwell') {
            actions.push({ actionId: `${stop.id}-dwell`, actionType: 'wait', blockingType: 'HARD',
              actionParameters: [{ key: 'durationMs', value: stop.cp.dwellMs ?? 0 }] });
          } else if (a === 'scan') {
            actions.push({ actionId: `${stop.id}-scan`, actionType: 'scanRoom', blockingType: 'HARD' });
          }
        }
        if (stop.cp.expectations?.length) {
          actions.push({ actionId: `${stop.id}-inspect`, actionType: 'inspect', blockingType: 'SOFT',
            actionParameters: stop.cp.expectations.map((e, k) => ({ key: `expectation${k + 1}`, value: e })) });
        }
      }
      nodes.push({
        nodeId: stop.placeId,
        sequenceId: i * 2,
        released: true,
        nodeDescription: stop.name,
        actions,
      });
      if (i > 0) {
        edges.push({
          edgeId: `${stops[i - 1].placeId}->${stop.placeId}`,
          sequenceId: i * 2 - 1,
          startNodeId: stops[i - 1].placeId,
          endNodeId: stop.placeId,
          released: true,
          actions: [],
        });
      }
    });
    return {
      headerId: 0,
      timestamp: new Date(this.now()).toISOString(),
      version: '2.0.0',
      manufacturer: 'NeoDEM',
      serialNumber: route.robotId ?? '',
      orderId: route.id,
      orderUpdateId: 0,
      nodes,
      edges,
    };
  }

  // --------------------------------------------------------------------------
  // Robot proxies
  // --------------------------------------------------------------------------

  private async robotClient(robotId: string, timeoutMs: number): Promise<Pick<HttpClient, 'get' | 'post'> | null> {
    const registered = await this.robots.getRegisteredRobot(robotId);
    if (!registered) return null;
    return this.httpClient(registered.baseUrl, timeoutMs, agentServiceAuthHeaders());
  }

  private resolveRobotId(route: PatrolRoute, robotId?: string | null): string {
    const id = (robotId && robotId.trim()) || route.robotId;
    if (!id) throw new BadRequestError('robotId is required: the route is not bound to a robot');
    return id;
  }

  /**
   * Start a run: POST the route inline to the robot. Refusals come back as
   * `{accepted:false, reason}` with HTTP 200 (the robot ALSO emits the skipped
   * run, which the ingest path alerts on). Unreachable → the server records
   * the skipped run itself and raises the warning alert.
   */
  async startRun(routeId: string, opts: StartRunOptions = {}): Promise<StartRunOutcome> {
    const route = await this.getRoute(routeId);
    const robotId = this.resolveRobotId(route, opts.robotId);
    const mode: PatrolRunMode = opts.mode && PatrolRunModes.includes(opts.mode) ? opts.mode : 'patrol';
    const origin: PatrolRunOrigin = opts.origin && PatrolRunOrigins.includes(opts.origin) ? opts.origin : 'operator';
    const client = await this.robotClient(robotId, START_TIMEOUT_MS);
    if (!client) throw new NotFoundError('Robot', robotId);

    const wire: PatrolRoute = {
      id: route.id, name: route.name, robotId: route.robotId, twinId: route.twinId,
      checkpoints: route.checkpoints, cronExpression: route.cronExpression, enabled: route.enabled,
      timeWindows: route.timeWindows, homePlaceId: route.homePlaceId, createdAt: route.createdAt, updatedAt: route.updatedAt,
    };
    try {
      const answer = await client.post<unknown>(`/api/v1/robots/${encodeURIComponent(robotId)}/agent-mode/patrol`, {
        routeId: route.id,
        mode,
        origin,
        route: wire,
      });
      if (!isRecord(answer) || typeof answer.accepted !== 'boolean') {
        throw new HttpClientError('robot returned no PatrolStartResult', undefined, 'invalid_response');
      }
      const result: PatrolStartResult = {
        accepted: answer.accepted,
        runId: typeof answer.runId === 'string' ? answer.runId : undefined,
        message: typeof answer.message === 'string' ? answer.message : answer.accepted ? 'accepted' : 'refused',
        reason: typeof answer.reason === 'string' ? answer.reason : undefined,
      };
      return { result, unreachable: false, robotId, route };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      console.warn(`[Patrol] start ${route.name} on ${robotId} failed: ${why}`);
      await this.recordUnreachableRun(route, robotId, mode, origin, why);
      return {
        result: { accepted: false, reason: 'unreachable', message: `Robot ${robotId} could not be reached: ${why}` },
        unreachable: true,
        robotId,
        route,
      };
    }
  }

  /** The server's own record of a start that never reached the robot. */
  private async recordUnreachableRun(
    route: PatrolRouteRecord,
    robotId: string,
    mode: PatrolRunMode,
    origin: PatrolRunOrigin,
    why: string,
  ): Promise<PatrolRunRecord> {
    const nowIso = new Date(this.now()).toISOString();
    const run: PatrolRun = {
      runId: uuidv4(),
      routeId: route.id,
      routeName: route.name,
      robotId,
      mode,
      origin,
      window: null,
      status: 'skipped',
      reason: `unreachable: ${why}`,
      startedAt: nowIso,
      finishedAt: nowIso,
      legs: skippedLegsFor(route),
      findingCount: 0,
      planId: null,
    };
    const stored = await this.repo.upsertRun(run);
    await this.raiseSkippedAlert(stored);
    await this.audit(robotId, run.runId, 'patrol.run.skipped', `Patrol "${route.name}" skipped: unreachable`, {
      routeId: route.id, mode, origin, reason: run.reason,
    }, 'warning');
    return stored;
  }

  async abortRun(routeId: string, robotId?: string | null, reason?: string): Promise<{ ok: boolean; runId?: string }> {
    const route = await this.getRoute(routeId);
    const rid = this.resolveRobotId(route, robotId);
    return this.abortOnRobot(rid, reason);
  }

  async abortOnRobot(robotId: string, reason?: string): Promise<{ ok: boolean; runId?: string }> {
    const client = await this.robotClient(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) throw new NotFoundError('Robot', robotId);
    const answer = await client.post<unknown>(`/api/v1/robots/${encodeURIComponent(robotId)}/agent-mode/patrol/abort`, {
      reason: reason ?? 'operator abort',
    });
    return isRecord(answer)
      ? { ok: answer.ok === true, runId: typeof answer.runId === 'string' ? answer.runId : undefined }
      : { ok: false };
  }

  async promoteRun(runId: string): Promise<{ ok: boolean }> {
    const run = await this.repo.findRunById(runId);
    if (!run) throw new NotFoundError('PatrolRun', runId);
    const client = await this.robotClient(run.robotId, HTTP_TIMEOUTS.MEDIUM);
    if (!client) throw new NotFoundError('Robot', run.robotId);
    const answer = await client.post<unknown>(
      `/api/v1/robots/${encodeURIComponent(run.robotId)}/agent-mode/patrol/runs/${encodeURIComponent(runId)}/promote`,
      {},
    );
    const ok = isRecord(answer) && answer.ok === true;
    // The robot rewrote its per-checkpoint baseline for this route+window; remember
    // it here too so getBaseline (and the app's photo pairs) follow the promotion.
    if (ok) await this.repo.setRunPromoted(runId, new Date(this.now()));
    return { ok };
  }

  /** The robot's known places, for the route editor. */
  async listPlaces(robotId: string): Promise<{ places: unknown[] }> {
    const client = await this.robotClient(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) throw new NotFoundError('Robot', robotId);
    const answer = await client.get<unknown>(`/api/v1/robots/${encodeURIComponent(robotId)}/places`);
    if (isRecord(answer) && Array.isArray(answer.places)) return { places: answer.places };
    if (Array.isArray(answer)) return { places: answer };
    return { places: [] };
  }

  // --------------------------------------------------------------------------
  // Runs & findings (reads)
  // --------------------------------------------------------------------------

  async listRuns(filters: PatrolRunFilters = {}): Promise<PatrolRunRecord[]> {
    return this.repo.listRuns(filters);
  }

  async getRunWithFindings(runId: string): Promise<PatrolRunRecord & { findings: PatrolFindingRecord[] }> {
    const run = await this.repo.findRunById(runId);
    if (!run) throw new NotFoundError('PatrolRun', runId);
    const findings = await this.repo.listFindingsForRun(runId);
    return { ...run, findings };
  }

  /**
   * The baseline for a route (+ window): the most recently promoted run when
   * an operator promoted one ("Promote to baseline"), else the latest finished
   * `baseline` run (any non-skipped one when none finished). Photos keyed by
   * checkpoint id, values are keys relative to that run (`<checkpointId>.jpg`).
   */
  async getBaseline(routeId: string, window?: string | null): Promise<PatrolBaselineInfo | null> {
    await this.getRoute(routeId);
    let pick: PatrolRunRecord | null = await this.repo.findLatestPromotedRun(routeId, window ?? null);
    if (!pick) {
      const runs = await this.repo.listRuns({ routeId, mode: 'baseline', limit: 100 });
      const candidates = runs.filter((r) => r.status !== 'skipped' && (window ? r.window === window : true));
      pick = candidates.find((r) => r.status === 'done') ?? candidates[0] ?? null;
    }
    if (!pick) return null;
    const photos: Record<string, string> = {};
    for (const leg of pick.legs) {
      if (leg.photoKey) photos[leg.checkpointId] = leg.photoKey.split('/').pop() ?? leg.photoKey;
    }
    return { runId: pick.runId, window: pick.window, photos, robotId: pick.robotId, finishedAt: pick.finishedAt ?? null };
  }

  async listFindings(filters: PatrolFindingFilters = {}): Promise<PatrolFindingRecord[]> {
    return this.repo.listFindings(filters);
  }

  async getFinding(id: string): Promise<PatrolFindingRecord> {
    const f = await this.repo.findFindingById(id);
    if (!f) throw new NotFoundError('PatrolFinding', id);
    return f;
  }

  // --------------------------------------------------------------------------
  // Findings (actions)
  // --------------------------------------------------------------------------

  async acknowledgeFinding(id: string, userId?: string): Promise<PatrolFindingRecord> {
    const f = await this.getFinding(id);
    if (f.alertId) {
      try {
        await this.alerts.acknowledgeAlert(f.alertId, userId);
      } catch (err) {
        console.warn(`[Patrol] acknowledge alert ${f.alertId} failed:`, err instanceof Error ? err.message : err);
      }
    }
    const updated = await this.repo.updateFindingServerFields(id, { status: 'acknowledged' });
    return updated ?? f;
  }

  /** "This is normal": dismiss + teach the robot's baseline (best effort). */
  async markFindingNormal(id: string, userId?: string): Promise<PatrolFindingRecord & { robotNotified: boolean }> {
    const f = await this.getFinding(id);
    if (f.alertId) {
      try {
        await this.alerts.acknowledgeAlert(f.alertId, userId);
      } catch {
        /* best effort */
      }
    }
    let robotNotified = false;
    try {
      const client = await this.robotClient(f.robotId, HTTP_TIMEOUTS.MEDIUM);
      if (client) {
        const answer = await client.post<unknown>(
          `/api/v1/robots/${encodeURIComponent(f.robotId)}/agent-mode/patrol/findings/${encodeURIComponent(id)}/normal`,
          { runId: f.runId },
        );
        robotNotified = isRecord(answer) && answer.ok === true;
      }
    } catch (err) {
      console.warn(`[Patrol] markNormal → robot ${f.robotId} failed:`, err instanceof Error ? err.message : err);
    }
    const updated = await this.repo.updateFindingServerFields(id, { status: 'dismissed_normal' });
    await this.audit(f.robotId, f.runId, 'patrol.finding.dismissed_normal', `Finding ${id} marked normal`, {
      findingId: id, robotNotified, type: f.type, place: f.place,
    });
    return { ...(updated ?? f), robotNotified };
  }

  /** Escalate: status + an incident when the incident service is available (best effort). */
  async escalateFinding(id: string, userId?: string): Promise<PatrolFindingRecord> {
    const f = await this.getFinding(id);
    let incidentId: string | null = f.incidentId ?? null;
    if (!incidentId && this.incidents) {
      try {
        const run = await this.repo.findRunById(f.runId);
        const type: IncidentType = f.type === 'person' || f.type === 'door_open' ? 'security' : 'safety';
        const severity: IncidentSeverity = f.severity === 'high' ? 'high' : f.severity === 'medium' ? 'medium' : 'low';
        const incident = await this.incidents.createIncident({
          type,
          severity,
          title: `Patrol finding: ${f.summary}`,
          description: findingAlertMessage(f, run),
          robotId: f.robotId,
          alertIds: f.alertId ? [f.alertId] : [],
          detectedAt: new Date(f.at),
          createdBy: userId,
        });
        incidentId = incident.id;
      } catch (err) {
        console.warn(`[Patrol] escalate ${id}: incident not created:`, err instanceof Error ? err.message : err);
      }
    }
    const updated = await this.repo.updateFindingServerFields(id, { status: 'escalated', incidentId });
    await this.audit(f.robotId, f.runId, 'patrol.finding.escalated', `Finding ${id} escalated`, {
      findingId: id, incidentId, type: f.type, severity: f.severity,
    }, 'warning');
    return updated ?? f;
  }

  // --------------------------------------------------------------------------
  // Ingest (robot → server)
  // --------------------------------------------------------------------------

  /**
   * Handle an `agent:patrol:*` / `agent:finding:*` event: upsert the run,
   * upsert the finding, alert exactly once per finding (first sight) and once
   * per skipped run, and leave a compliance trail. Never throws — the events
   * route must not fail for reasons the robot cannot act on.
   */
  async ingest(event: AgentModeEvent): Promise<void> {
    const runId = isPatrolRun(event.patrol)
      ? event.patrol.runId
      : isPatrolFinding(event.finding)
        ? event.finding.runId
        : null;
    if (!runId) {
      await this.ingestUnserialised(event);
      return;
    }
    // The events route answers the robot before ingest finishes and the robot's
    // mirror pushes each event on its own connection, so two events for the
    // same run may be in flight at once. Chain them per run so a stale
    // snapshot can never be applied on top of a newer one.
    const prev = this.ingestChains.get(runId) ?? Promise.resolve();
    const next = prev.then(() => this.ingestUnserialised(event));
    this.ingestChains.set(runId, next);
    try {
      await next;
    } finally {
      if (this.ingestChains.get(runId) === next) this.ingestChains.delete(runId);
    }
  }

  private async ingestUnserialised(event: AgentModeEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'agent:patrol:started':
        case 'agent:patrol:leg':
        case 'agent:patrol:finished':
          await this.ingestRun(event);
          return;
        case 'agent:finding:detected':
        case 'agent:finding:confirmed':
          if (isPatrolRun(event.patrol)) await this.ingestRun(event, /* quiet */ true);
          await this.ingestFinding(event);
          return;
        default:
          return;
      }
    } catch (error) {
      console.error(`[Patrol] ingest ${event.type} failed:`, error);
    }
  }

  private async ingestRun(event: AgentModeEvent, quiet = false): Promise<PatrolRunRecord | null> {
    if (!isPatrolRun(event.patrol)) {
      console.warn(`[Patrol] ${event.type} without a patrol payload — ignored`);
      return null;
    }
    const run: PatrolRun = { ...event.patrol, robotId: event.patrol.robotId || event.robotId };
    const before = await this.repo.findRunById(run.runId);
    // Stale snapshot (a late `leg`, or a finding's embedded run that predates
    // the `finished` already stored): never let it overwrite the newer row.
    if (isRunDowngrade(before, run)) {
      console.warn(`[Patrol] ${event.type} for run ${run.runId} carries an older snapshot (${run.status}) than stored (${before?.status}) — ignored`);
      return before;
    }
    const stored = await this.repo.upsertRun(run);
    if (quiet) return stored;

    if (event.type === 'agent:patrol:started' || (!before && run.status === 'running')) {
      await this.audit(run.robotId, run.runId, 'patrol.run.started', `Patrol "${run.routeName}" started (${run.mode}, ${run.origin})`, {
        routeId: run.routeId, mode: run.mode, origin: run.origin, window: run.window, legs: run.legs.length,
      });
    }
    if (event.type === 'agent:patrol:finished') {
      await this.audit(run.robotId, run.runId, 'patrol.run.finished', `Patrol "${run.routeName}" ${run.status}${run.reason ? `: ${run.reason}` : ''}`, {
        routeId: run.routeId, mode: run.mode, origin: run.origin, status: run.status, reason: run.reason ?? null,
        findingCount: run.findingCount, legs: run.legs.map((l) => ({ checkpointId: l.checkpointId, status: l.status })),
      }, run.status === 'skipped' || run.status === 'failed' ? 'warning' : 'info');
      if (run.status === 'skipped' && !stored.alertId) {
        await this.raiseSkippedAlert(stored);
      }
    }
    return stored;
  }

  private async raiseSkippedAlert(run: PatrolRunRecord): Promise<void> {
    if (run.alertId) return;
    try {
      const alert = await this.alerts.createRobotAlert(
        run.robotId,
        'warning',
        `Patrol ${run.routeName} skipped: ${run.reason ?? 'unknown reason'}`,
        `Patrol "${run.routeName}" (${run.mode}, ${run.origin}) was skipped: ${run.reason ?? 'unknown reason'} · run: ${run.runId} · at: ${run.startedAt} [run:${run.runId}]`,
      );
      await this.repo.setRunAlert(run.runId, alert.id);
    } catch (err) {
      console.error('[Patrol] skipped-run alert failed:', err);
    }
  }

  private async ingestFinding(event: AgentModeEvent): Promise<void> {
    if (!isPatrolFinding(event.finding)) {
      console.warn(`[Patrol] ${event.type} without a finding payload — ignored`);
      return;
    }
    const incoming: PatrolFinding = { ...event.finding, robotId: event.finding.robotId || event.robotId };
    if (!PatrolFindingTypes.includes(incoming.type)) incoming.type = 'other';

    const existing = await this.repo.findFindingById(incoming.id);
    if (existing) {
      // Re-observation: evidence moves, the human's status and the alert stay.
      await this.repo.updateFindingObservation(incoming.id, {
        summary: incoming.summary,
        evidence: incoming.evidence ?? {},
        confidence: incoming.confidence,
        pose: incoming.pose ?? null,
        place: incoming.place ?? null,
        model: incoming.model ?? null,
      });
      return;
    }

    // First sight: derive severity by type × window (the server owns this),
    // persist, alert once, audit.
    const run = isPatrolRun(event.patrol) ? event.patrol : await this.repo.findRunById(incoming.runId);
    const route = await this.repo.findRouteById(incoming.routeId).catch(() => null);
    const night = isNightWindow(run?.window ?? null, route?.timeWindows ?? []);
    const severity = deriveFindingSeverity(incoming.type, night);
    const toStore: PatrolFinding = {
      ...incoming,
      severity: PatrolFindingSeverities.includes(severity) ? severity : incoming.severity,
      status: 'open',
      alertId: null,
      incidentId: null,
    };
    // A finding needs its run row for the FK; a `detected` racing ahead of
    // `started` is possible on a busy mirror, so make sure the run exists.
    if (!(await this.repo.findRunById(toStore.runId))) {
      if (run && run.runId === toStore.runId) await this.repo.upsertRun({ ...run, robotId: run.robotId || event.robotId });
      else {
        console.warn(`[Patrol] finding ${toStore.id} for unknown run ${toStore.runId} — ignored`);
        return;
      }
    }
    let stored = await this.repo.createFinding(toStore);
    try {
      // Findings wait for a human verdict — never the 10 s auto-dismiss that
      // an `info` robot alert gets by default.
      const alert = await this.alerts.createRobotAlert(
        stored.robotId,
        alertSeverityFor(stored.severity),
        stored.summary,
        findingAlertMessage(stored, run ?? null),
        { persistent: true },
      );
      stored = (await this.repo.updateFindingServerFields(stored.id, { alertId: alert.id })) ?? stored;
    } catch (err) {
      console.error('[Patrol] finding alert failed:', err);
    }
    await this.audit(stored.robotId, stored.runId, 'patrol.finding.confirmed', `Finding: ${stored.summary}`, {
      findingId: stored.id, routeId: stored.routeId, type: stored.type, severity: stored.severity, source: stored.source,
      place: stored.place, checkpointId: stored.checkpointId ?? null, alertId: stored.alertId ?? null,
      hasPhoto: Boolean(stored.evidence?.currentPhotoKey), model: stored.model,
    }, stored.severity === 'high' ? 'warning' : 'info');
  }

  // --------------------------------------------------------------------------
  // Compliance
  // --------------------------------------------------------------------------

  private async audit(
    robotId: string,
    runId: string,
    eventName: string,
    description: string,
    metadata: Record<string, unknown>,
    severity: 'info' | 'warning' | 'error' | 'critical' = 'info',
  ): Promise<void> {
    try {
      await this.compliance.logSystemEvent({
        sessionId: `patrol-${runId}`,
        robotId,
        severity,
        payload: { eventName, component: 'patrol', description, metadata },
      });
    } catch (err) {
      console.warn('[Patrol] compliance log failed:', err instanceof Error ? err.message : err);
    }
  }
}

export const patrolService = new PatrolService();
