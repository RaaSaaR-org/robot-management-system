/**
 * @file TourService.test.ts
 * @description TourService (TASK-213): route validation (caps, no stops,
 *              unknown fields), ingest of the four `agent:tour:*` events incl.
 *              a late/out-of-order snapshot, one compliance record per finished
 *              run carrying `disclosureSpoken`, one alert per skipped/failed
 *              run, the start proxy, tenant scoping and a run that survives
 *              deleting its route.
 * @feature tour
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { TourService, isRunDowngrade, normaliseFacts, normaliseStops, normaliseLanguage, TOUR_DEFAULT_DWELL_S } from '../services/TourService.js';
import { HttpClientError } from '../services/HttpClient.js';
import { FakeTourRepository, fakeAlerts, fakeCompliance, makeRun, makeTurn } from './tour-test-fakes.js';
import { TOUR_FACT_MAX, TOUR_TALK_TRACK_MAX, type AgentModeEvent } from '../types/agent-mode.types.js';
import { ZEMA_TOUR_ROUTE } from '../database/seeds/tour-zema.seed.js';

function build(opts: { post?: ReturnType<typeof vi.fn>; robot?: boolean } = {}) {
  const repo = new FakeTourRepository();
  const alerts = fakeAlerts();
  const compliance = fakeCompliance();
  const post = opts.post ?? vi.fn(async () => ({ accepted: true, runId: 'run-x', message: 'ok' }));
  const get = vi.fn(async () => ({ places: [] }));
  const httpCalls: Array<{ baseUrl: string; timeout: number }> = [];
  const service = new TourService({
    repo: repo.asRepo(),
    alerts,
    compliance,
    robots: { getRegisteredRobot: async () => (opts.robot === false ? null : { baseUrl: 'http://robot:41243' }) },
    httpClient: (baseUrl, timeout) => {
      httpCalls.push({ baseUrl, timeout });
      return { post, get } as any;
    },
    now: () => Date.parse('2026-08-17T10:00:00.000Z'),
  });
  return { repo, alerts, compliance, post, get, service, httpCalls };
}

function ev(type: AgentModeEvent['type'], extra: Partial<AgentModeEvent>): AgentModeEvent {
  return { type, robotId: 'robot-001', timestamp: '2026-08-17T10:00:00.000Z', ...extra };
}

/** A route body that passes validation, for tests that vary one field. */
function routeBody(over: Record<string, unknown> = {}) {
  return {
    name: 'ZeMA Besucherrundgang',
    language: 'de',
    greetingPlaceId: 'STAGING',
    greeting: 'Hallo, schön dass Sie da sind.',
    offer: 'Soll ich Ihnen alles zeigen?',
    farewell: 'Danke für Ihren Besuch.',
    siteCard: ['Ich bin ein Unitree G1.'],
    stops: [{ placeId: 'STAGING', headline: 'Startplatz', talkTrack: 'Hier ist mein Startplatz.' }],
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('TourService — validation', () => {
  it('rejects a route with no stops', async () => {
    const { service } = build();
    await expect(service.createRoute(routeBody({ stops: [] }))).rejects.toThrow(/at least one stop/);
    await expect(service.createRoute(routeBody({ stops: undefined }))).rejects.toThrow(/at least one stop/);
  });

  it('rejects a talk track over the cap and keeps one exactly at it', async () => {
    const { service } = build();
    const tooLong = 'a'.repeat(TOUR_TALK_TRACK_MAX + 1);
    await expect(
      service.createRoute(routeBody({ stops: [{ placeId: 'STAGING', talkTrack: tooLong }] })),
    ).rejects.toThrow(/talkTrack must be at most 600/);
    const atCap = 'b'.repeat(TOUR_TALK_TRACK_MAX);
    const route = await service.createRoute(routeBody({ stops: [{ placeId: 'STAGING', talkTrack: atCap }] }));
    expect(route.stops[0].talkTrack).toHaveLength(TOUR_TALK_TRACK_MAX);
  });

  it('drops fields the wire contract does not know and mints ids/defaults', () => {
    const stops = normaliseStops([
      {
        placeId: 'AISLE-1',
        talkTrack: 'Hier ist meine Arbeitsstation.',
        // Not part of TourStop: must not survive the round trip, or the robot
        // would be handed a promise nobody implements.
        photoOnArrival: true,
        headingDeg: 90,
      },
    ]);
    expect(stops[0]).toEqual({
      id: 'stop-1-aisle-1',
      placeId: 'AISLE-1',
      headline: 'AISLE-1',
      talkTrack: 'Hier ist meine Arbeitsstation.',
      facts: [],
      dwellS: TOUR_DEFAULT_DWELL_S,
      askToContinue: false,
    });
    expect('photoOnArrival' in stops[0]).toBe(false);
  });

  it('enforces the fact caps and the stop count', () => {
    expect(() => normaliseFacts(['x'.repeat(TOUR_FACT_MAX + 1)], 'facts', 8)).toThrow(/at most 200/);
    expect(() => normaliseFacts(['a', 'b', 'c'], 'siteCard', 2)).toThrow(/at most 2 entries/);
    // Empty and duplicate facts are dropped rather than rejected — an editor
    // with an empty last row is not an authoring error.
    expect(normaliseFacts(['  a  ', '', 'a'], 'facts', 8)).toEqual(['a']);
    const many = Array.from({ length: 13 }, () => ({ placeId: 'STAGING', talkTrack: 'x' }));
    expect(() => normaliseStops(many)).toThrow(/at most 12 stops/);
  });

  it('accepts only en|de as the language', () => {
    expect(normaliseLanguage('de')).toBe('de');
    expect(normaliseLanguage(undefined)).toBe('en');
    expect(() => normaliseLanguage('fr')).toThrow(/language must be one of/);
  });

  it('requires a place, a headline within the cap and something to say per stop', () => {
    expect(() => normaliseStops([{ talkTrack: 'x' }])).toThrow(/placeId is required/);
    expect(() => normaliseStops([{ placeId: 'STAGING' }])).toThrow(/talkTrack is required/);
    expect(() => normaliseStops([{ placeId: 'STAGING', headline: 'h'.repeat(61), talkTrack: 'x' }])).toThrow(
      /headline must be at most 60/,
    );
  });

  it('normalises a demo and defaults its display name + duration', () => {
    const [stop] = normaliseStops([
      { placeId: 'AISLE-1', talkTrack: 'x', demo: { skillId: 'g1_apple_pnp' } },
    ]);
    expect(stop.demo).toEqual({ skillId: 'g1_apple_pnp', skillName: 'g1_apple_pnp', modelVersionId: null, expectSeconds: 30 });
  });

  it('updates a route without losing the fields the body omits', async () => {
    const { service, repo } = build();
    const created = await service.createRoute(routeBody({ autoGreet: true }));
    const updated = await service.updateRoute(created.id, { name: 'Rundgang kurz' });
    expect(updated.name).toBe('Rundgang kurz');
    expect(updated.autoGreet).toBe(true);
    expect(updated.stops).toHaveLength(1);
    expect(repo.routes.get(created.id)?.name).toBe('Rundgang kurz');
  });
});

describe('TourService — ingest', () => {
  it('persists the run from each of the four events, transcript included', async () => {
    const { service, repo } = build();
    await service.ingest(ev('agent:tour:started', { tour: makeRun() }));
    expect(repo.runs.get('run-1')?.status).toBe('running');

    // Every event carries the WHOLE run, so each snapshot below is the run as
    // it stood when that event fired — legs included.
    const legs = [
      { index: 0, stopId: 'stop-1-staging', placeId: 'STAGING', name: 'Startplatz', status: 'done' as const },
      { index: 1, stopId: 'stop-2-aisle-1', placeId: 'AISLE-1', name: 'Arbeitsstation', status: 'done' as const },
    ];
    await service.ingest(ev('agent:tour:leg', { tour: makeRun({ legs }) }));
    expect(repo.runs.get('run-1')?.legs.filter((l) => l.status === 'done')).toHaveLength(2);

    const turn = makeTurn();
    await service.ingest(ev('agent:tour:turn', { tour: makeRun({ legs, turns: [turn] }), turn }));
    expect(repo.runs.get('run-1')?.turns).toEqual([turn]);

    await service.ingest(
      ev('agent:tour:finished', {
        tour: makeRun({ legs, status: 'done', finishedAt: '2026-08-17T10:08:00.000Z', turns: [turn] }),
      }),
    );
    const stored = repo.runs.get('run-1');
    expect(stored?.status).toBe('done');
    expect(stored?.finishedAt).toBe('2026-08-17T10:08:00.000Z');
    expect(stored?.turns).toHaveLength(1);
  });

  it('ignores a late snapshot that would undo a finished run or drop a turn', async () => {
    const { service, repo } = build();
    const turn = makeTurn();
    await service.ingest(
      ev('agent:tour:finished', {
        tour: makeRun({ status: 'done', finishedAt: '2026-08-17T10:08:00.000Z', turns: [turn] }),
      }),
    );
    // A `leg` pushed on another connection, taken before the last question and
    // before the run ended, lands after `finished`.
    await service.ingest(ev('agent:tour:leg', { tour: makeRun({ status: 'running', turns: [] }) }));
    const stored = repo.runs.get('run-1');
    expect(stored?.status).toBe('done');
    expect(stored?.finishedAt).toBe('2026-08-17T10:08:00.000Z');
    expect(stored?.turns).toHaveLength(1);
  });

  it('isRunDowngrade compares terminality, finishedAt, settled legs and turns', () => {
    const running = makeRun();
    const done = makeRun({ status: 'done', finishedAt: '2026-08-17T10:08:00.000Z' });
    expect(isRunDowngrade(null, running)).toBe(false);
    expect(isRunDowngrade(running, done)).toBe(false);
    expect(isRunDowngrade(done, running)).toBe(true);
    expect(isRunDowngrade(makeRun({ turns: [makeTurn()] }), makeRun({ turns: [] }))).toBe(true);
    expect(
      isRunDowngrade(makeRun(), makeRun({ legs: [{ index: 0, stopId: 's', placeId: 'p', name: 'n', status: 'pending' }] })),
    ).toBe(true);
  });

  it('writes exactly one compliance record per finished run, carrying disclosureSpoken', async () => {
    const { service, compliance } = build();
    const turns = [makeTurn(), makeTurn({ answered: 'grounded', question: 'Was ist das?' })];
    await service.ingest(ev('agent:tour:started', { tour: makeRun() }));
    await service.ingest(ev('agent:tour:turn', { tour: makeRun({ turns }), turn: turns[0] }));
    expect(compliance.logSystemEvent).not.toHaveBeenCalled();

    await service.ingest(
      ev('agent:tour:finished', {
        tour: makeRun({ status: 'done', finishedAt: '2026-08-17T10:08:00.000Z', turns, disclosureSpoken: true }),
      }),
    );
    expect(compliance.logSystemEvent).toHaveBeenCalledTimes(1);
    const record = compliance.logSystemEvent.mock.calls[0][0];
    expect(record.sessionId).toBe('tour-run-1');
    expect(record.robotId).toBe('robot-001');
    expect(record.payload.eventName).toBe('tour.run.finished');
    expect(record.payload.metadata.disclosureSpoken).toBe(true);
    expect(record.payload.metadata.questions).toBe(2);
    expect(record.payload.metadata.declined).toBe(1);
    // The visitor's words stay on the run row (retention-swept), never in the
    // compliance log.
    expect(JSON.stringify(record)).not.toContain('Was kostet der Roboter?');
  });

  it('records a run whose disclosure never reached the speaker as such', async () => {
    const { service, compliance } = build();
    await service.ingest(
      ev('agent:tour:finished', {
        tour: makeRun({ status: 'failed', reason: 'voice service unreachable', disclosureSpoken: false, finishedAt: '2026-08-17T10:01:00.000Z' }),
      }),
    );
    const record = compliance.logSystemEvent.mock.calls[0][0];
    expect(record.severity).toBe('warning');
    expect(record.payload.metadata.disclosureSpoken).toBe(false);
    expect(record.payload.description).toMatch(/NOT spoken/);
  });

  it('alerts once on a skipped or failed run, and never on declined/abandoned', async () => {
    const { service, alerts, repo } = build();
    await service.ingest(
      ev('agent:tour:finished', {
        tour: makeRun({ runId: 'run-skip', status: 'skipped', reason: 'battery too low', finishedAt: '2026-08-17T10:00:10.000Z' }),
      }),
    );
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
    const [, severity, title, message] = alerts.createRobotAlert.mock.calls[0];
    expect(severity).toBe('warning');
    expect(title).toMatch(/skipped/);
    // The machine tag the app parses to link into the run.
    expect(message).toContain('[tour-run:run-skip]');
    expect(repo.runs.get('run-skip')?.alertId).toBe('alert-1');

    // A re-delivered `finished` must not raise a second alert.
    await service.ingest(
      ev('agent:tour:finished', {
        tour: makeRun({ runId: 'run-skip', status: 'skipped', reason: 'battery too low', finishedAt: '2026-08-17T10:00:10.000Z' }),
      }),
    );
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);

    for (const status of ['declined', 'abandoned'] as const) {
      await service.ingest(
        ev('agent:tour:finished', {
          tour: makeRun({ runId: `run-${status}`, status, finishedAt: '2026-08-17T10:00:20.000Z' }),
        }),
      );
    }
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
  });

  it('ignores an event without a tour payload and never throws', async () => {
    const { service, repo } = build();
    await expect(service.ingest(ev('agent:tour:leg', {}))).resolves.toBeUndefined();
    await expect(service.ingest(ev('agent:plan:started', { tour: makeRun() }))).resolves.toBeUndefined();
    expect(repo.runs.size).toBe(0);
  });

  it('takes the robot id from the event when the payload omits it', async () => {
    const { service, repo } = build();
    await service.ingest(ev('agent:tour:started', { tour: makeRun({ robotId: '' }) }));
    expect(repo.runs.get('run-1')?.robotId).toBe('robot-001');
  });
});

describe('TourService — runs outlive their route', () => {
  it('keeps the run and its transcript after the route is deleted', async () => {
    const { service, repo } = build();
    const route = await service.createRoute(routeBody());
    const turn = makeTurn();
    await service.ingest(
      ev('agent:tour:finished', {
        tour: makeRun({ routeId: route.id, status: 'done', finishedAt: '2026-08-17T10:08:00.000Z', turns: [turn] }),
      }),
    );

    await service.deleteRoute(route.id);
    expect(repo.routes.has(route.id)).toBe(false);

    const run = await service.getRun('run-1');
    expect(run.routeId).toBe(route.id);
    expect(run.routeName).toBe('ZeMA Besucherrundgang'); // denormalised: readable without the route
    expect(run.turns).toEqual([turn]);
    expect(await service.listRuns({ routeId: route.id })).toHaveLength(1);
  });

  it('records a run the server has no route for at all (robot ran from its disk cache)', async () => {
    const { service, repo } = build();
    await service.ingest(ev('agent:tour:started', { tour: makeRun({ routeId: 'route-the-server-never-saw' }) }));
    expect(repo.runs.get('run-1')?.routeId).toBe('route-the-server-never-saw');
  });
});

describe('TourService — start / abort', () => {
  it('POSTs the route inline to the robot and returns its answer', async () => {
    const { service, post, httpCalls } = build();
    const route = await service.createRoute(routeBody({ robotId: 'robot-001' }));
    const outcome = await service.startRun(route.id, { origin: 'visitor' });
    expect(outcome.unreachable).toBe(false);
    expect(outcome.result).toEqual({ accepted: true, runId: 'run-x', message: 'ok', reason: undefined });
    expect(httpCalls[0].baseUrl).toBe('http://robot:41243');
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/api/v1/robots/robot-001/agent-mode/tour');
    expect(body.origin).toBe('visitor');
    expect(body.routeId).toBe(route.id);
    expect(body.route.stops[0].talkTrack).toBe('Hier ist mein Startplatz.');
  });

  it('defaults the origin to operator and rejects a route bound to no robot', async () => {
    const { service, post } = build();
    const bound = await service.createRoute(routeBody({ robotId: 'robot-001' }));
    await service.startRun(bound.id);
    expect(post.mock.calls[0][1].origin).toBe('operator');

    const unbound = await service.createRoute(routeBody({ robotId: null }));
    await expect(service.startRun(unbound.id)).rejects.toThrow(/robotId is required/);
  });

  it('reports an unreachable robot without inventing a run', async () => {
    const post = vi.fn(async () => {
      throw new HttpClientError('connect ECONNREFUSED', undefined, 'http://robot:41243');
    });
    const { service, repo } = build({ post });
    const route = await service.createRoute(routeBody({ robotId: 'robot-001' }));
    const outcome = await service.startRun(route.id);
    expect(outcome.unreachable).toBe(true);
    expect(outcome.result.reason).toBe('unreachable');
    // Deliberately different from patrol: no scheduler, so the caller waiting
    // on this response is the whole audience — no phantom run, no alert.
    expect(repo.runs.size).toBe(0);
  });

  it("re-throws the robot's own 4xx so the caller sees what is misconfigured", async () => {
    const post = vi.fn(async () => {
      throw new HttpClientError('HTTP 404: unknown route', 404, 'http://robot:41243', undefined, { error: 'unknown route' });
    });
    const { service } = build({ post });
    const route = await service.createRoute(routeBody({ robotId: 'robot-001' }));
    await expect(service.startRun(route.id)).rejects.toBeInstanceOf(HttpClientError);
  });

  it('aborts through the robot', async () => {
    const post = vi.fn(async (_url: string, _body: unknown) => ({ ok: true, runId: 'run-1' }));
    const { service } = build({ post });
    const route = await service.createRoute(routeBody({ robotId: 'robot-001' }));
    expect(await service.abortRun(route.id, undefined, 'visitor left')).toEqual({ ok: true, runId: 'run-1' });
    expect(post.mock.calls[0][0]).toBe('/api/v1/robots/robot-001/agent-mode/tour/abort');
    expect(post.mock.calls[0][1]).toEqual({ reason: 'visitor left' });
  });

  it('404s when the robot is not registered', async () => {
    const { service } = build({ robot: false });
    const route = await service.createRoute(routeBody({ robotId: 'robot-001' }));
    await expect(service.startRun(route.id)).rejects.toThrow(/Robot/);
  });
});

describe('the ZeMA seed route', () => {
  // The seed is demo content that gets spoken to real visitors, so it goes
  // through the same validation the editor does — a talk track that grew past
  // the cap must fail here, not in front of a school class.
  it('passes route validation and keeps the workstation demo', async () => {
    const { service } = build();
    const route = await service.createRoute(ZEMA_TOUR_ROUTE);
    expect(route.language).toBe('de');
    expect(route.greetingPlaceId).toBe('STAGING');
    expect(route.stops.map((s) => s.placeId)).toEqual(['STAGING', 'AISLE-1', 'DOCK-1', 'CHARGING-A']);
    const workstation = route.stops[1];
    expect(workstation.talkTrack).toContain('Arbeitsstation');
    expect(workstation.demo?.skillId).toBe('g1_apple_pnp');
    // Unprompted greeting stays off until a site turns it on deliberately.
    expect(route.autoGreet).toBe(false);
  });
});

describe('tour models are tenant-scoped', () => {
  // Isolation is enforced by the Prisma client extension, not by the
  // repository, so the only thing a unit test can assert is that host mode's
  // two models are actually enrolled in it — a `tenantId` column that no
  // allowlist mentions is a silent cross-tenant read.
  const root = path.resolve(__dirname, '../..');

  it('carries a tenantId column and sits in the isolation allowlist', () => {
    const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    for (const model of ['TourRoute', 'TourRun']) {
      const block = schema.slice(schema.indexOf(`model ${model} {`), schema.indexOf(`model ${model} {`) + 2000);
      expect(block).toMatch(/tenantId\s+String\?/);
      expect(block).toMatch(/tenant\s+Tenant\?\s+@relation/);
    }
    const client = readFileSync(path.join(root, 'src/database/client.ts'), 'utf8');
    expect(client).toContain("'TourRoute'");
    expect(client).toContain("'TourRun'");
  });
});
