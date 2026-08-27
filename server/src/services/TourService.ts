/**
 * @file TourService.ts
 * @description Host mode (TASK-213): tour routes CRUD (source of record), run
 *              history, ingest of the robot's `agent:tour:*` events (persist +
 *              one alert per skipped/failed run + one compliance record per
 *              finished run), and the start/abort proxies to the robot agent.
 *
 *              Deliberately smaller than PatrolService: a tour has no cron, no
 *              time windows, no baseline and no findings, because it is
 *              triggered by a person standing in front of the robot and its
 *              output is speech, not photographs.
 * @feature tour
 */

import { alertService as defaultAlertService } from './AlertService.js';
import { complianceLogService as defaultComplianceLogService } from './ComplianceLogService.js';
import { robotManager as defaultRobotManager } from './RobotManager.js';
import { HttpClient, HttpClientError, HTTP_TIMEOUTS } from './HttpClient.js';
import { agentServiceAuthHeaders } from './agentServiceAuth.js';
import {
  tourRepository as defaultTourRepository,
  type TourRepository,
  type TourRouteRecord,
  type TourRunRecord,
  type CreateTourRouteInput,
  type UpdateTourRouteInput,
  type TourRunFilters,
} from '../repositories/TourRepository.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import {
  SpokenLanguages,
  TourRunOrigins,
  TOUR_FACTS_MAX,
  TOUR_FACT_MAX,
  TOUR_HEADLINE_MAX,
  TOUR_SITE_CARD_MAX,
  TOUR_STOPS_MAX,
  TOUR_TALK_TRACK_MAX,
  type AgentModeEvent,
  type SpokenLanguage,
  type TourDemo,
  type TourLeg,
  type TourLegStatus,
  type TourRoute,
  type TourRun,
  type TourRunOrigin,
  type TourRunStatus,
  type TourStartResult,
  type TourStop,
  TOUR_DWELL_MAX_S,
} from '../types/agent-mode.types.js';

// ============================================================================
// TYPES
// ============================================================================

/** What the routes accept for POST/PUT /api/tour/routes. */
export interface TourRouteInputBody {
  name?: unknown;
  robotId?: unknown;
  twinId?: unknown;
  language?: unknown;
  greetingPlaceId?: unknown;
  greeting?: unknown;
  offer?: unknown;
  farewell?: unknown;
  siteCard?: unknown;
  stops?: unknown;
  enabled?: unknown;
  autoGreet?: unknown;
}

export interface StartTourOptions {
  robotId?: string | null;
  origin?: TourRunOrigin;
}

/**
 * Outcome of a start attempt. `unreachable` = the robot never gave a usable
 * answer — no answer at all (transport) or a 5xx; the caller answers 502.
 * Otherwise `result` is the robot's own {@link TourStartResult} (HTTP 200 even
 * when refused: the robot then emits a `skipped` run, which the ingest path
 * alerts on). A 4xx is neither — the robot answered and named what is
 * misconfigured, so {@link TourService.startRun} re-throws the
 * {@link HttpClientError} and the caller forwards the robot's status and body.
 */
export interface StartTourOutcome {
  result: TourStartResult;
  unreachable: boolean;
  robotId: string;
  route: TourRouteRecord;
}

/** Minimal robot lookup the service needs; RobotManager satisfies it. */
export interface TourRobotLookup {
  getRegisteredRobot(robotId: string): Promise<{ baseUrl: string } | null | undefined>;
}

export interface TourServiceDeps {
  repo?: TourRepository;
  alerts?: Pick<typeof defaultAlertService, 'createRobotAlert'>;
  compliance?: Pick<typeof defaultComplianceLogService, 'logSystemEvent'>;
  robots?: TourRobotLookup;
  /** Factory so tests can fake the transport. */
  httpClient?: (baseUrl: string, timeoutMs: number, headers?: Record<string, string>) => Pick<HttpClient, 'get' | 'post'>;
  now?: () => number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Robot answers "accepted/refused" fast; the tour itself is asynchronous. */
const START_TIMEOUT_MS = HTTP_TIMEOUTS.MEDIUM;

/** Seconds a stop waits for questions when the author did not say. */
export const TOUR_DEFAULT_DWELL_S = 12;

/**
 * Upper bound for `dwellS` — re-exported from the wire contract rather than
 * chosen here.
 *
 * It used to be 120 while the robot's route parser clamped at 60 and the
 * `wait` block clamped at 30, so a route could be saved promising a 2-minute
 * pause, shown in the editor's duration estimate as 2 minutes, and executed as
 * 30 seconds. One number, in the contract both sides read.
 */
export { TOUR_DWELL_MAX_S } from '../types/agent-mode.types.js';

/** Default for `TourDemo.expectSeconds` — roughly one apple pick-and-place. */
const DEFAULT_DEMO_SECONDS = 30;

// ============================================================================
// PURE HELPERS (exported for tests)
// ============================================================================

const TERMINAL_RUN_STATUSES: ReadonlySet<TourRunStatus> = new Set([
  'done',
  'declined',
  'abandoned',
  'aborted',
  'failed',
  'skipped',
]);

/** Statuses that end a run badly enough to put an alert in front of an operator. */
const ALERTING_RUN_STATUSES: ReadonlySet<TourRunStatus> = new Set(['skipped', 'failed']);

const SETTLED_LEG_STATUSES: ReadonlySet<TourLegStatus> = new Set(['done', 'failed', 'skipped']);

function settledLegCount(legs: TourLeg[] | undefined): number {
  return (legs ?? []).filter((l) => SETTLED_LEG_STATUSES.has(l.status)).length;
}

/**
 * How many legs have been STARTED — the count that orders a leg-start snapshot
 * against the settle immediately before it.
 *
 * `startedAt` is stamped once, when the leg begins, and never cleared, so this
 * only ever grows within a run. A leg the runner skipped never starts and never
 * stamps it, so a skipped leg does not inflate the count on either side of a
 * comparison.
 */
function startedLegCount(legs: TourLeg[] | undefined): number {
  return (legs ?? []).filter((l) => l.startedAt).length;
}

/**
 * True when `incoming` is an OLDER snapshot of the run than `stored`: it would
 * move a terminal run back to 'running', drop `finishedAt`, report fewer
 * started or settled legs, or lose turns already recorded. Every `agent:tour:*` event
 * carries the whole run and the robot pushes them fire-and-forget over
 * separate connections, so a `leg` or a `turn` can land after the `finished`
 * it preceded — such a snapshot must never replace the newer row.
 *
 * The turn count is the one test patrol does not have: a tour's transcript
 * only ever grows, and a late `leg` snapshot taken before the last question
 * would otherwise silently delete an answered question from the record.
 */
export function isRunDowngrade(stored: TourRun | null | undefined, incoming: TourRun): boolean {
  if (!stored) return false;
  const storedTerminal = TERMINAL_RUN_STATUSES.has(stored.status);
  const incomingTerminal = TERMINAL_RUN_STATUSES.has(incoming.status);
  if (storedTerminal && !incomingTerminal) return true;
  if (stored.finishedAt && !incoming.finishedAt) return true;
  if (settledLegCount(incoming.legs) < settledLegCount(stored.legs)) return true;
  // Settled legs alone stopped being enough when TASK-222 added the leg-START
  // event. `settle(leg i-1)` and `start(leg i)` leave the runner a few lines
  // apart and carry the SAME settled count — [done, pending, …] and
  // [done, running, …] both settle exactly one leg — so the clause above cannot
  // order them, and a reordered `settle(i-1)` landing second walked leg i back
  // to `pending` and dropped its `startedAt`. That put the banner on its generic
  // fallback for the whole of leg i: the very thing TASK-222 exists to remove.
  if (startedLegCount(incoming.legs) < startedLegCount(stored.legs)) return true;
  if ((incoming.turns ?? []).length < (stored.turns ?? []).length) return true;
  return false;
}

/**
 * The tail the alert list parses to deep-link into the run.
 *
 * `tour-run`, NOT patrol's bare `run` — the app's alert-link parser maps a
 * bare `[run:<id>]` to `/patrol/runs/<id>`, so reusing the tag would send an
 * operator clicking a tour alert to a patrol run detail page that has never
 * heard of that id. Distinct tag, distinct destination.
 */
export function runAlertTail(runId: string): string {
  return `[tour-run:${runId}]`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTourRun(v: unknown): v is TourRun {
  return isRecord(v) && typeof v.runId === 'string' && typeof v.routeId === 'string' && typeof v.status === 'string';
}

// ============================================================================
// VALIDATION
// ============================================================================

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'stop';
}

function requiredString(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new BadRequestError(`${field} is required`);
  const s = v.trim();
  if (s.length > max) throw new BadRequestError(`${field} must be at most ${max} characters (got ${s.length})`);
  return s;
}

function optionalString(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new BadRequestError(`${field} must be a string`);
  return v.trim();
}

/** Spoken text that is not the talk track (greeting/offer/farewell): same cap, may be empty. */
function spokenString(v: unknown, field: string): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new BadRequestError(`${field} must be a string`);
  const s = v.trim();
  if (s.length > TOUR_TALK_TRACK_MAX) {
    throw new BadRequestError(`${field} must be at most ${TOUR_TALK_TRACK_MAX} characters (got ${s.length})`);
  }
  return s;
}

export function normaliseLanguage(raw: unknown, fallback: SpokenLanguage = 'en'): SpokenLanguage {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string' || !SpokenLanguages.includes(raw as SpokenLanguage)) {
    throw new BadRequestError(`language must be one of: ${SpokenLanguages.join(', ')}`);
  }
  return raw as SpokenLanguage;
}

/**
 * Validate + normalise a fact list. Facts are the ONLY ground the robot may
 * answer a visitor from, so they are trimmed, de-duplicated and capped here —
 * an operator who pastes an essay into a fact would push the planner prompt
 * past the point where the grounding rule still bites.
 */
export function normaliseFacts(raw: unknown, field: string, max: number): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new BadRequestError(`${field} must be an array of strings`);
  const out: string[] = [];
  raw.forEach((f, i) => {
    if (typeof f !== 'string') throw new BadRequestError(`${field}[${i}] must be a string`);
    const s = f.trim();
    if (!s) return;
    if (s.length > TOUR_FACT_MAX) {
      throw new BadRequestError(`${field}[${i}] must be at most ${TOUR_FACT_MAX} characters (got ${s.length})`);
    }
    if (!out.includes(s)) out.push(s);
  });
  if (out.length > max) throw new BadRequestError(`${field} may hold at most ${max} entries (got ${out.length})`);
  return out;
}

function normaliseDemo(raw: unknown, where: string): TourDemo | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) throw new BadRequestError(`${where}.demo must be an object`);
  const skillId = requiredString(raw.skillId, `${where}.demo.skillId`, 200);
  const skillName = typeof raw.skillName === 'string' && raw.skillName.trim() ? raw.skillName.trim() : skillId;
  const expectSecondsRaw = raw.expectSeconds;
  const expectSeconds =
    expectSecondsRaw === undefined || expectSecondsRaw === null
      ? DEFAULT_DEMO_SECONDS
      : typeof expectSecondsRaw === 'number' && Number.isFinite(expectSecondsRaw) && expectSecondsRaw >= 0
        ? Math.round(expectSecondsRaw)
        : (() => {
            throw new BadRequestError(`${where}.demo.expectSeconds must be a non-negative number`);
          })();
  return {
    skillId,
    skillName,
    modelVersionId: optionalString(raw.modelVersionId, `${where}.demo.modelVersionId`) ?? null,
    expectSeconds,
  };
}

/**
 * Validate + normalise stops. Ids are minted when missing (`stop-<n>-<slug>`),
 * headlines default to the place id. Fields the wire contract does not know
 * are DROPPED rather than stored: the robot reads these objects straight off
 * the route, and a stray key that survives a round trip is a promise nobody
 * implements.
 */
export function normaliseStops(raw: unknown): TourStop[] {
  if (!Array.isArray(raw)) throw new BadRequestError('stops must be an array');
  if (raw.length > TOUR_STOPS_MAX) {
    throw new BadRequestError(`a tour may have at most ${TOUR_STOPS_MAX} stops (got ${raw.length})`);
  }
  const seen = new Set<string>();
  return raw.map((s, i) => {
    const where = `stops[${i}]`;
    if (!isRecord(s)) throw new BadRequestError(`${where} must be an object`);
    const placeId = requiredString(s.placeId, `${where}.placeId`, 200);
    const headlineRaw = typeof s.headline === 'string' && s.headline.trim() ? s.headline : placeId;
    const headline = requiredString(headlineRaw, `${where}.headline`, TOUR_HEADLINE_MAX);
    // A stop IS a sentence the robot says out loud; one with nothing to say is
    // an authoring slip that would show up as a silent walk-to in front of a
    // visitor, which is the one failure mode a guest cannot interpret.
    const talkTrack = requiredString(s.talkTrack, `${where}.talkTrack`, TOUR_TALK_TRACK_MAX);
    let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `stop-${i + 1}-${slug(placeId)}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const dwellS =
      s.dwellS === undefined || s.dwellS === null
        ? TOUR_DEFAULT_DWELL_S
        : typeof s.dwellS === 'number' && Number.isFinite(s.dwellS) && s.dwellS >= 0
          ? Math.min(Math.round(s.dwellS), TOUR_DWELL_MAX_S)
          : (() => {
              throw new BadRequestError(`${where}.dwellS must be a non-negative number`);
            })();
    const stop: TourStop = {
      id,
      placeId,
      headline,
      talkTrack,
      facts: normaliseFacts(s.facts, `${where}.facts`, TOUR_FACTS_MAX),
      dwellS,
      askToContinue: s.askToContinue === true,
    };
    const demo = normaliseDemo(s.demo, where);
    if (demo) stop.demo = demo;
    return stop;
  });
}

// ============================================================================
// SERVICE
// ============================================================================

export class TourService {
  private readonly repo: TourRepository;
  private readonly alerts: NonNullable<TourServiceDeps['alerts']>;
  private readonly compliance: NonNullable<TourServiceDeps['compliance']>;
  private readonly robots: TourRobotLookup;
  private readonly httpClient: NonNullable<TourServiceDeps['httpClient']>;
  private readonly now: () => number;
  /** runId → tail of the ingest chain: events for one run are applied in arrival order, never interleaved. */
  private readonly ingestChains = new Map<string, Promise<void>>();

  constructor(deps: TourServiceDeps = {}) {
    this.repo = deps.repo ?? defaultTourRepository;
    this.alerts = deps.alerts ?? defaultAlertService;
    this.compliance = deps.compliance ?? defaultComplianceLogService;
    this.robots = deps.robots ?? (defaultRobotManager as unknown as TourRobotLookup);
    this.httpClient = deps.httpClient ?? ((baseUrl, timeoutMs, headers) => new HttpClient(baseUrl, timeoutMs, headers));
    this.now = deps.now ?? (() => Date.now());
  }

  // --------------------------------------------------------------------------
  // Routes
  // --------------------------------------------------------------------------

  async listRoutes(filters: { robotId?: string } = {}): Promise<TourRouteRecord[]> {
    return this.repo.listRoutes(filters);
  }

  async getRoute(id: string): Promise<TourRouteRecord> {
    const route = await this.repo.findRouteById(id);
    if (!route) throw new NotFoundError('TourRoute', id);
    return route;
  }

  async createRoute(body: TourRouteInputBody): Promise<TourRouteRecord> {
    const stops = normaliseStops(body.stops ?? []);
    if (stops.length === 0) throw new BadRequestError('at least one stop is required');
    const input: CreateTourRouteInput = {
      name: requiredString(body.name, 'name', 200),
      robotId: optionalString(body.robotId, 'robotId') ?? null,
      twinId: optionalString(body.twinId, 'twinId') ?? null,
      language: normaliseLanguage(body.language),
      greetingPlaceId: requiredString(body.greetingPlaceId, 'greetingPlaceId', 200),
      greeting: requiredString(body.greeting, 'greeting', TOUR_TALK_TRACK_MAX),
      offer: spokenString(body.offer, 'offer'),
      farewell: spokenString(body.farewell, 'farewell'),
      siteCard: normaliseFacts(body.siteCard, 'siteCard', TOUR_SITE_CARD_MAX),
      stops,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      autoGreet: body.autoGreet === true,
    };
    return this.repo.createRoute(input);
  }

  async updateRoute(id: string, body: TourRouteInputBody): Promise<TourRouteRecord> {
    await this.getRoute(id);
    const patch: UpdateTourRouteInput = {};
    if (body.name !== undefined) patch.name = requiredString(body.name, 'name', 200);
    if (body.stops !== undefined) {
      patch.stops = normaliseStops(body.stops);
      if (patch.stops.length === 0) throw new BadRequestError('at least one stop is required');
    }
    if (body.robotId !== undefined) patch.robotId = optionalString(body.robotId, 'robotId') ?? null;
    if (body.twinId !== undefined) patch.twinId = optionalString(body.twinId, 'twinId') ?? null;
    if (body.language !== undefined) patch.language = normaliseLanguage(body.language);
    if (body.greetingPlaceId !== undefined) patch.greetingPlaceId = requiredString(body.greetingPlaceId, 'greetingPlaceId', 200);
    if (body.greeting !== undefined) patch.greeting = requiredString(body.greeting, 'greeting', TOUR_TALK_TRACK_MAX);
    if (body.offer !== undefined) patch.offer = spokenString(body.offer, 'offer');
    if (body.farewell !== undefined) patch.farewell = spokenString(body.farewell, 'farewell');
    if (body.siteCard !== undefined) patch.siteCard = normaliseFacts(body.siteCard, 'siteCard', TOUR_SITE_CARD_MAX);
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.autoGreet !== undefined) patch.autoGreet = Boolean(body.autoGreet);
    const updated = await this.repo.updateRoute(id, patch);
    if (!updated) throw new NotFoundError('TourRoute', id);
    return updated;
  }

  /**
   * Delete a route. Its RUNS stay: they are the record of what was said to a
   * visitor and of the Art. 50 disclosure, which no route edit may erase (the
   * run row therefore carries `routeId` as a plain column, not an FK).
   */
  async deleteRoute(id: string): Promise<void> {
    const ok = await this.repo.deleteRoute(id);
    if (!ok) throw new NotFoundError('TourRoute', id);
  }

  // --------------------------------------------------------------------------
  // Robot proxies
  // --------------------------------------------------------------------------

  private async robotClient(robotId: string, timeoutMs: number): Promise<Pick<HttpClient, 'get' | 'post'> | null> {
    const registered = await this.robots.getRegisteredRobot(robotId);
    if (!registered) return null;
    return this.httpClient(registered.baseUrl, timeoutMs, agentServiceAuthHeaders());
  }

  private resolveRobotId(route: TourRoute, robotId?: string | null): string {
    const id = (robotId && robotId.trim()) || route.robotId;
    if (!id) throw new BadRequestError('robotId is required: the route is not bound to a robot');
    return id;
  }

  /**
   * Start a tour: POST the route inline to the robot, exactly as patrol does,
   * so a robot whose disk cache is stale still speaks the route the operator
   * is looking at.
   *
   * Unlike patrol this does NOT record a server-side `skipped` run when the
   * robot is unreachable. A patrol start can happen at 03:00 with nobody to
   * tell, so its only trace would be a console line; every tour start has a
   * caller waiting on the response — an operator pressing Start, or a visitor
   * standing in front of a robot that is by definition reachable. A phantom
   * run would add a row and an alert nobody needs.
   */
  async startRun(routeId: string, opts: StartTourOptions = {}): Promise<StartTourOutcome> {
    const route = await this.getRoute(routeId);
    const robotId = this.resolveRobotId(route, opts.robotId);
    const origin: TourRunOrigin = opts.origin && TourRunOrigins.includes(opts.origin) ? opts.origin : 'operator';
    const client = await this.robotClient(robotId, START_TIMEOUT_MS);
    if (!client) throw new NotFoundError('Robot', robotId);

    const wire: TourRoute = {
      id: route.id,
      name: route.name,
      robotId: route.robotId,
      twinId: route.twinId,
      language: route.language,
      greetingPlaceId: route.greetingPlaceId,
      greeting: route.greeting,
      offer: route.offer,
      farewell: route.farewell,
      siteCard: route.siteCard,
      stops: route.stops,
      enabled: route.enabled,
      autoGreet: route.autoGreet,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt,
    };
    try {
      const answer = await client.post<unknown>(`/api/v1/robots/${encodeURIComponent(robotId)}/agent-mode/tour`, {
        routeId: route.id,
        origin,
        route: wire,
      });
      if (!isRecord(answer) || typeof answer.accepted !== 'boolean') {
        throw new HttpClientError('robot returned no TourStartResult', undefined, 'invalid_response');
      }
      const result: TourStartResult = {
        accepted: answer.accepted,
        runId: typeof answer.runId === 'string' ? answer.runId : undefined,
        message: typeof answer.message === 'string' ? answer.message : answer.accepted ? 'accepted' : 'refused',
        reason: typeof answer.reason === 'string' ? answer.reason : undefined,
      };
      return { result, unreachable: false, robotId, route };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      const status = error instanceof HttpClientError ? error.statusCode : undefined;
      // The robot ANSWERED with a 4xx: an id mismatch, an agent too old to know
      // the tour endpoint, a rejected body. That is a configuration error and
      // the robot's own body is the only diagnostic that explains it, so it
      // passes through untouched (tour.routes' respondError forwards both).
      if (status !== undefined && status >= 400 && status < 500) throw error;
      console.warn(`[Tour] start ${route.name} on ${robotId} failed: ${why}`);
      const answered = status !== undefined;
      return {
        result: {
          accepted: false,
          reason: answered ? 'robot_error' : 'unreachable',
          message: answered
            ? `Robot ${robotId} rejected the start: ${why}`
            : `Robot ${robotId} could not be reached: ${why}`,
        },
        unreachable: true,
        robotId,
        route,
      };
    }
  }

  async abortRun(routeId: string, robotId?: string | null, reason?: string): Promise<{ ok: boolean; runId?: string }> {
    const route = await this.getRoute(routeId);
    const rid = this.resolveRobotId(route, robotId);
    return this.abortOnRobot(rid, reason);
  }

  async abortOnRobot(robotId: string, reason?: string): Promise<{ ok: boolean; runId?: string }> {
    const client = await this.robotClient(robotId, HTTP_TIMEOUTS.SHORT);
    if (!client) throw new NotFoundError('Robot', robotId);
    const answer = await client.post<unknown>(`/api/v1/robots/${encodeURIComponent(robotId)}/agent-mode/tour/abort`, {
      reason: reason ?? 'operator abort',
    });
    return isRecord(answer)
      ? { ok: answer.ok === true, runId: typeof answer.runId === 'string' ? answer.runId : undefined }
      : { ok: false };
  }

  // --------------------------------------------------------------------------
  // Runs (reads)
  // --------------------------------------------------------------------------

  async listRuns(filters: TourRunFilters = {}): Promise<TourRunRecord[]> {
    return this.repo.listRuns(filters);
  }

  async getRun(runId: string): Promise<TourRunRecord> {
    const run = await this.repo.findRunById(runId);
    if (!run) throw new NotFoundError('TourRun', runId);
    return run;
  }

  // --------------------------------------------------------------------------
  // Ingest (robot → server)
  // --------------------------------------------------------------------------

  /**
   * Handle an `agent:tour:*` event: upsert the run (turns included), alert
   * once on a run that ended skipped/failed, and write the compliance record
   * when it finishes. Never throws — the events route must not fail for
   * reasons the robot cannot act on.
   */
  async ingest(event: AgentModeEvent): Promise<void> {
    const runId = isTourRun(event.tour) ? event.tour.runId : null;
    if (!runId) {
      await this.ingestUnserialised(event);
      return;
    }
    // The events route answers the robot before ingest finishes and the robot's
    // mirror pushes each event on its own connection, so two events for the
    // same run may be in flight at once. Chain them per run so a stale snapshot
    // can never be applied on top of a newer one.
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
        case 'agent:tour:started':
        case 'agent:tour:leg':
        case 'agent:tour:turn':
        case 'agent:tour:finished':
          await this.ingestRun(event);
          return;
        default:
          return;
      }
    } catch (error) {
      console.error(`[Tour] ingest ${event.type} failed:`, error);
    }
  }

  private async ingestRun(event: AgentModeEvent): Promise<TourRunRecord | null> {
    if (!isTourRun(event.tour)) {
      console.warn(`[Tour] ${event.type} without a tour payload — ignored`);
      return null;
    }
    const run: TourRun = { ...event.tour, robotId: event.tour.robotId || event.robotId };
    const before = await this.repo.findRunById(run.runId);
    if (isRunDowngrade(before, run)) {
      console.warn(
        `[Tour] ${event.type} for run ${run.runId} carries an older snapshot (${run.status}) than stored (${before?.status}) — ignored`,
      );
      return before;
    }
    const stored = await this.repo.upsertRun(run);

    if (event.type === 'agent:tour:finished') {
      await this.recordFinished(stored);
      if (ALERTING_RUN_STATUSES.has(stored.status)) await this.raiseRunAlert(stored);
    }
    return stored;
  }

  /**
   * One alert per run that ended skipped or failed — a tour the robot refused
   * to start or could not finish is the operator-visible failure of host mode,
   * the way a skipped patrol is for the night round. `declined` and
   * `abandoned` raise nothing: a visitor saying "no thanks" or walking away is
   * the expected outcome of a good greeting, not an incident.
   */
  private async raiseRunAlert(run: TourRunRecord): Promise<void> {
    if (run.alertId) return;
    try {
      const alert = await this.alerts.createRobotAlert(
        run.robotId,
        'warning',
        `Tour ${run.routeName} ${run.status}: ${run.reason ?? 'unknown reason'}`,
        // The `[tour-run:<id>]` tail is the app's machine tag: the alert list
        // strips it from the prose and renders a link into the run. The id is
        // therefore NOT repeated in the prose.
        `Tour "${run.routeName}" (${run.origin}) ended ${run.status}: ${run.reason ?? 'unknown reason'} · at: ${run.startedAt} ${runAlertTail(run.runId)}`,
      );
      await this.repo.setRunAlert(run.runId, alert.id);
    } catch (err) {
      console.error('[Tour] run alert failed:', err);
    }
  }

  /**
   * The compliance record for a finished tour — EXACTLY ONE per run, and the
   * EU AI Act Art. 50 evidence: it records whether the disclosure ("you are
   * talking to an AI-driven robot") was actually spoken to this visitor, which
   * is the one fact an authority can ask us to produce. `disclosureSpoken`
   * comes from the robot, which knows whether the sentence reached the
   * speaker; the server never assumes it.
   *
   * The visitor's questions are NOT copied in here. They live on the run row
   * under its retention sweep; a compliance log is the wrong place for text a
   * member of the public spoke, so this carries counts instead.
   */
  private async recordFinished(run: TourRunRecord): Promise<void> {
    const turns = run.turns ?? [];
    const metadata = {
      routeId: run.routeId,
      origin: run.origin,
      status: run.status,
      reason: run.reason ?? null,
      language: run.language,
      disclosureSpoken: run.disclosureSpoken,
      stops: run.legs.length,
      stopsDone: run.legs.filter((l) => l.status === 'done').length,
      questions: turns.length,
      declined: turns.filter((t) => t.answered === 'declined').length,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
    };
    try {
      await this.compliance.logSystemEvent({
        sessionId: `tour-${run.runId}`,
        robotId: run.robotId,
        severity: ALERTING_RUN_STATUSES.has(run.status) ? 'warning' : 'info',
        payload: {
          eventName: 'tour.run.finished',
          component: 'tour',
          description: `Tour "${run.routeName}" ${run.status}${run.reason ? `: ${run.reason}` : ''} (AI disclosure ${run.disclosureSpoken ? 'spoken' : 'NOT spoken'})`,
          metadata,
        },
      });
    } catch (err) {
      console.warn('[Tour] compliance log failed:', err instanceof Error ? err.message : err);
    }
  }
}

export const tourService = new TourService();
