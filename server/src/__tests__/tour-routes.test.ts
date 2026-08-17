/**
 * @file tour-routes.test.ts
 * @description Route smoke tests for /api/tour (TASK-213): shapes, status
 *              codes, error mapping, the places proxy shared with patrol, and
 *              the events route carrying `tour`/`turn` into TourService.ingest
 *              plus the WebSocket fan-out.
 * @feature tour
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockTourService, mockPatrolService } = vi.hoisted(() => ({
  mockTourService: {
    listRoutes: vi.fn(),
    createRoute: vi.fn(),
    getRoute: vi.fn(),
    updateRoute: vi.fn(),
    deleteRoute: vi.fn(),
    startRun: vi.fn(),
    abortRun: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
    ingest: vi.fn(async () => undefined),
  },
  // Only `listPlaces` is reached from tour.routes; the rest of the patrol
  // service is irrelevant here and stays unmocked-by-omission.
  mockPatrolService: { listPlaces: vi.fn(), ingest: vi.fn(async () => undefined) },
}));

vi.mock('../services/TourService.js', async () => {
  const actual = await vi.importActual<typeof import('../services/TourService.js')>('../services/TourService.js');
  return { ...actual, tourService: mockTourService };
});

vi.mock('../services/PatrolService.js', async () => {
  const actual = await vi.importActual<typeof import('../services/PatrolService.js')>('../services/PatrolService.js');
  return { ...actual, patrolService: mockPatrolService };
});

vi.mock('../services/RobotManager.js', () => ({ robotManager: { getRegisteredRobot: vi.fn() } }));

import { tourRoutes } from '../routes/tour.routes.js';
import { agentModeRoutes } from '../routes/agent-mode.routes.js';
import { agentModeService } from '../services/AgentModeService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { HttpClientError } from '../services/HttpClient.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tour', tourRoutes);
  app.use('/api/robots', agentModeRoutes);
  return app;
}

const ROUTE = {
  id: 'tour-route-1',
  name: 'ZeMA Besucherrundgang',
  robotId: 'robot-001',
  twinId: null,
  language: 'de',
  greetingPlaceId: 'STAGING',
  greeting: 'Hallo, schön dass Sie da sind.',
  offer: 'Soll ich Ihnen alles zeigen?',
  farewell: 'Danke für Ihren Besuch.',
  siteCard: ['Ich bin ein Unitree G1.'],
  stops: [{ id: 'stop-1-staging', placeId: 'STAGING', headline: 'Startplatz', talkTrack: 'Hier ist mein Startplatz.', facts: [], dwellS: 12, askToContinue: false }],
  enabled: true,
  autoGreet: false,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
};

const RUN = {
  runId: 'run-1',
  routeId: 'tour-route-1',
  routeName: 'ZeMA Besucherrundgang',
  robotId: 'robot-001',
  origin: 'visitor',
  status: 'done',
  reason: null,
  startedAt: '2026-08-17T10:00:00.000Z',
  finishedAt: '2026-08-17T10:08:00.000Z',
  legs: [],
  turns: [{ at: '2026-08-17T10:01:00.000Z', stopId: 'stop-1-staging', question: 'Was kostet der Roboter?', answer: 'Das weiß ich nicht.', answered: 'declined', language: 'de' }],
  language: 'de',
  disclosureSpoken: true,
  planId: 'plan-1',
  alertId: null,
};

describe('tour routes', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ---- routes CRUD -------------------------------------------------------
  it('GET /api/tour/routes?robotId= lists', async () => {
    mockTourService.listRoutes.mockResolvedValue([ROUTE]);
    const res = await request(app).get('/api/tour/routes?robotId=robot-001');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([ROUTE]);
    expect(mockTourService.listRoutes).toHaveBeenCalledWith({ robotId: 'robot-001' });
  });

  it('POST /api/tour/routes → 201; a validation error → 400 with the reason', async () => {
    mockTourService.createRoute.mockResolvedValue(ROUTE);
    const ok = await request(app).post('/api/tour/routes').send({ name: 'ZeMA Besucherrundgang', stops: [{ placeId: 'STAGING', talkTrack: 'x' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.id).toBe('tour-route-1');

    mockTourService.createRoute.mockRejectedValue(new BadRequestError('at least one stop is required'));
    const bad = await request(app).post('/api/tour/routes').send({ name: 'Leer', stops: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/at least one stop/);
  });

  it('GET/PUT/DELETE /api/tour/routes/:id incl. 404', async () => {
    mockTourService.getRoute.mockResolvedValue(ROUTE);
    expect((await request(app).get('/api/tour/routes/tour-route-1')).status).toBe(200);
    mockTourService.getRoute.mockRejectedValue(new NotFoundError('TourRoute', 'nope'));
    expect((await request(app).get('/api/tour/routes/nope')).status).toBe(404);

    mockTourService.updateRoute.mockResolvedValue({ ...ROUTE, name: 'Kurzrundgang' });
    const put = await request(app).put('/api/tour/routes/tour-route-1').send({ name: 'Kurzrundgang' });
    expect(put.status).toBe(200);
    expect(put.body.name).toBe('Kurzrundgang');

    mockTourService.deleteRoute.mockResolvedValue(undefined);
    expect((await request(app).delete('/api/tour/routes/tour-route-1')).status).toBe(204);
  });

  it('GET /api/tour/places?robotId= reuses the patrol proxy; 400 without robotId', async () => {
    mockPatrolService.listPlaces.mockResolvedValue({ places: [{ id: 'STAGING', name: 'Staging', placeType: 'staging', keepout: false }] });
    const res = await request(app).get('/api/tour/places?robotId=robot-001');
    expect(res.status).toBe(200);
    expect(res.body.places).toHaveLength(1);
    expect(mockPatrolService.listPlaces).toHaveBeenCalledWith('robot-001');
    expect((await request(app).get('/api/tour/places')).status).toBe(400);
  });

  // ---- start / abort -----------------------------------------------------
  it('POST /api/tour/routes/:id/start passes the TourStartResult through (200 even when refused), 502 when unreachable', async () => {
    mockTourService.startRun.mockResolvedValue({ result: { accepted: true, runId: 'run-1', message: 'ok' }, unreachable: false });
    const ok = await request(app).post('/api/tour/routes/tour-route-1/start').send({ origin: 'visitor' });
    expect(ok.status).toBe(200);
    expect(ok.body.runId).toBe('run-1');
    expect(mockTourService.startRun).toHaveBeenCalledWith('tour-route-1', { robotId: undefined, origin: 'visitor' });

    mockTourService.startRun.mockResolvedValue({ result: { accepted: false, reason: 'person_too_close', message: 'give me room' }, unreachable: false });
    const refused = await request(app).post('/api/tour/routes/tour-route-1/start').send({});
    expect(refused.status).toBe(200);
    expect(refused.body.reason).toBe('person_too_close');

    mockTourService.startRun.mockResolvedValue({ result: { accepted: false, reason: 'unreachable', message: 'x' }, unreachable: true });
    expect((await request(app).post('/api/tour/routes/tour-route-1/start').send({})).status).toBe(502);

    expect((await request(app).post('/api/tour/routes/tour-route-1/start').send({ origin: 'scheduled' })).status).toBe(400);

    mockTourService.startRun.mockRejectedValue(new NotFoundError('Robot', 'ghost'));
    expect((await request(app).post('/api/tour/routes/tour-route-1/start').send({ robotId: 'ghost' })).status).toBe(404);
  });

  it("a 4xx from the robot reaches the operator verbatim instead of a generic 502", async () => {
    const body = { code: 'ROBOT_NOT_FOUND', message: 'This agent serves robot g1-edu-01' };
    mockTourService.startRun.mockRejectedValue(new HttpClientError(`HTTP 404: ${JSON.stringify(body)}`, 404, '/x', undefined, body));
    const res = await request(app).post('/api/tour/routes/tour-route-1/start').send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual(body);
  });

  it('POST /api/tour/routes/:id/abort → {ok}; a dead robot is a 502', async () => {
    mockTourService.abortRun.mockResolvedValue({ ok: true, runId: 'run-1' });
    const res = await request(app).post('/api/tour/routes/tour-route-1/abort').send({ reason: 'visitor left' });
    expect(res.status).toBe(200);
    expect(mockTourService.abortRun).toHaveBeenCalledWith('tour-route-1', undefined, 'visitor left');

    mockTourService.abortRun.mockRejectedValue(
      new HttpClientError('connect ECONNREFUSED', undefined, '/x', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
    );
    expect((await request(app).post('/api/tour/routes/tour-route-1/abort').send({})).status).toBe(502);
  });

  // ---- runs --------------------------------------------------------------
  it('GET /api/tour/runs filters and /runs/:runId returns the transcript', async () => {
    mockTourService.listRuns.mockResolvedValue([RUN]);
    const list = await request(app).get('/api/tour/runs?routeId=tour-route-1&robotId=robot-001&limit=5&status=done,declined');
    expect(list.status).toBe(200);
    expect(mockTourService.listRuns).toHaveBeenCalledWith({
      routeId: 'tour-route-1',
      robotId: 'robot-001',
      status: ['done', 'declined'],
      limit: 5,
    });

    // An unknown status is dropped rather than 400ing the whole list.
    await request(app).get('/api/tour/runs?status=sideways');
    expect(mockTourService.listRuns).toHaveBeenLastCalledWith({ routeId: undefined, robotId: undefined, status: undefined, limit: 50 });

    mockTourService.getRun.mockResolvedValue(RUN);
    const one = await request(app).get('/api/tour/runs/run-1');
    expect(one.status).toBe(200);
    expect(one.body.turns[0].answered).toBe('declined');
    expect(one.body.disclosureSpoken).toBe(true);

    mockTourService.getRun.mockRejectedValue(new NotFoundError('TourRun', 'x'));
    expect((await request(app).get('/api/tour/runs/x')).status).toBe(404);
  });

  // ---- events ingest -----------------------------------------------------
  it('POST /api/robots/:id/agent-mode/events hands agent:tour:* to TourService.ingest and fans it out with tour+turn intact', async () => {
    const seen: any[] = [];
    const off = agentModeService.onAgentModeEvent((e) => seen.push(e));
    const tour = { ...RUN };
    const turn = RUN.turns[0];
    const res = await request(app)
      .post('/api/robots/robot-001/agent-mode/events')
      .send({ type: 'agent:tour:turn', robotId: 'robot-001', tour, turn, timestamp: '2026-08-17T10:01:00.000Z' });
    off();
    expect(res.status).toBe(200);
    expect(mockTourService.ingest).toHaveBeenCalledTimes(1);
    const ev = (mockTourService.ingest.mock.calls as unknown as Array<[any]>)[0][0];
    expect(ev.type).toBe('agent:tour:turn');
    expect(ev.tour).toEqual(tour);
    expect(ev.turn).toEqual(turn);
    // The WS envelope carries both fields — the app's store reads them off the
    // same `agent:` channel it already listens on.
    expect(seen).toHaveLength(1);
    expect(seen[0].tour).toEqual(tour);
    expect(seen[0].turn).toEqual(turn);
    expect(mockPatrolService.ingest).not.toHaveBeenCalled();
  });

  it('does not hand a patrol or plan event to TourService.ingest', async () => {
    await request(app)
      .post('/api/robots/robot-001/agent-mode/events')
      .send({ type: 'agent:block:started', robotId: 'robot-001', block: { id: 'b', kind: 'present', params: {}, status: 'running' } });
    expect(mockTourService.ingest).not.toHaveBeenCalled();
  });
});
