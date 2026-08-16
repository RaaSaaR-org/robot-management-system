/**
 * @file patrol-routes.test.ts
 * @description Route smoke tests for /api/patrol and the /api/robots patrol
 *              endpoints (TASK-212): shapes, status codes, error mapping,
 *              photo PUT/GET, and the events route carrying patrol/finding
 *              fields into PatrolService.ingest + the WebSocket fan-out.
 * @feature patrol
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const { mockPatrolService, photoDir } = vi.hoisted(() => ({
  mockPatrolService: {
    listRoutes: vi.fn(),
    createRoute: vi.fn(),
    getRoute: vi.fn(),
    updateRoute: vi.fn(),
    deleteRoute: vi.fn(),
    validateCronExpression: vi.fn(),
    exportVda5050: vi.fn(),
    getBaseline: vi.fn(),
    startRun: vi.fn(),
    abortRun: vi.fn(),
    abortOnRobot: vi.fn(),
    promoteRun: vi.fn(),
    listPlaces: vi.fn(),
    listRuns: vi.fn(),
    getRunWithFindings: vi.fn(),
    listFindings: vi.fn(),
    getFinding: vi.fn(),
    acknowledgeFinding: vi.fn(),
    markFindingNormal: vi.fn(),
    escalateFinding: vi.fn(),
    ingest: vi.fn(async () => undefined),
  },
  photoDir: `${process.env.TMPDIR ?? '/tmp'}/patrol-routes-test-${process.pid}`,
}));

vi.mock('../services/PatrolService.js', async () => {
  const actual = await vi.importActual<typeof import('../services/PatrolService.js')>('../services/PatrolService.js');
  return { ...actual, patrolService: mockPatrolService };
});

// Real photo store, pointed at a temp dir (forceLocal so an initialised RustFS
// in another test cannot leak in).
vi.mock('../services/PatrolPhotoStore.js', async () => {
  const actual = await vi.importActual<typeof import('../services/PatrolPhotoStore.js')>('../services/PatrolPhotoStore.js');
  return { ...actual, patrolPhotoStore: new actual.PatrolPhotoStore({ localDir: photoDir, forceLocal: true }) };
});

vi.mock('../services/RobotManager.js', () => ({ robotManager: { getRegisteredRobot: vi.fn() } }));

import { patrolRoutes, patrolRobotRoutes } from '../routes/patrol.routes.js';
import { agentModeRoutes } from '../routes/agent-mode.routes.js';
import { agentModeService } from '../services/AgentModeService.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { HttpClientError } from '../services/HttpClient.js';

function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/patrol', patrolRoutes);
  app.use('/api/robots', patrolRobotRoutes);
  app.use('/api/robots', agentModeRoutes);
  return app;
}

const ROUTE = {
  id: 'route-1', name: 'Night round', robotId: 'robot-001', twinId: null,
  checkpoints: [{ id: 'cp-1', placeId: 'hallway', name: 'Hallway', headingDeg: 90, actions: ['capture'] }],
  cronExpression: '0 22 * * *', enabled: true, timeWindows: [], homePlaceId: 'dock',
  createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z', lastFiredAt: null, nextRunAt: '2026-08-16T22:00:00.000Z',
};
const RUN = { runId: 'run-1', routeId: 'route-1', routeName: 'Night round', robotId: 'robot-001', mode: 'patrol', origin: 'operator', window: 'night', status: 'done', reason: null, startedAt: '2026-08-16T01:00:00.000Z', finishedAt: '2026-08-16T01:10:00.000Z', legs: [], findingCount: 1, planId: 'p', alertId: null };
const FINDING = { id: 'finding-1', runId: 'run-1', routeId: 'route-1', robotId: 'robot-001', legIndex: 0, type: 'unexpected_object', severity: 'medium', source: 'enroute_both', place: 'hallway', pose: null, at: '2026-08-16T01:02:00.000Z', summary: 'crate in Hallway', evidence: {}, model: null, confidence: 0.8, status: 'open', alertId: 'alert-1', incidentId: null };

describe('patrol routes', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(async () => {
    await fs.rm(photoDir, { recursive: true, force: true });
  });

  // ---- routes CRUD -------------------------------------------------------
  it('GET /api/patrol/routes?robotId= lists', async () => {
    mockPatrolService.listRoutes.mockResolvedValue([ROUTE]);
    const res = await request(app).get('/api/patrol/routes?robotId=robot-001');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([ROUTE]);
    expect(mockPatrolService.listRoutes).toHaveBeenCalledWith({ robotId: 'robot-001' });
  });

  it('POST /api/patrol/routes → 201; validation errors → 400', async () => {
    mockPatrolService.createRoute.mockResolvedValue(ROUTE);
    const res = await request(app).post('/api/patrol/routes').send({ name: 'Night round', checkpoints: [{ placeId: 'hallway' }] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('route-1');
    mockPatrolService.createRoute.mockRejectedValue(new BadRequestError('name is required'));
    const bad = await request(app).post('/api/patrol/routes').send({});
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/name/);
  });

  it('GET/PUT/DELETE /api/patrol/routes/:id incl. 404', async () => {
    mockPatrolService.getRoute.mockResolvedValue(ROUTE);
    expect((await request(app).get('/api/patrol/routes/route-1')).status).toBe(200);
    mockPatrolService.getRoute.mockRejectedValue(new NotFoundError('PatrolRoute', 'nope'));
    expect((await request(app).get('/api/patrol/routes/nope')).status).toBe(404);
    mockPatrolService.updateRoute.mockResolvedValue({ ...ROUTE, name: 'Renamed' });
    const put = await request(app).put('/api/patrol/routes/route-1').send({ name: 'Renamed' });
    expect(put.status).toBe(200);
    expect(put.body.name).toBe('Renamed');
    mockPatrolService.deleteRoute.mockResolvedValue(undefined);
    expect((await request(app).delete('/api/patrol/routes/route-1')).status).toBe(204);
  });

  it('POST /api/patrol/cron/validate', async () => {
    mockPatrolService.validateCronExpression.mockReturnValue({ valid: true, nextRuns: ['a', 'b', 'c', 'd', 'e'] });
    const ok = await request(app).post('/api/patrol/cron/validate').send({ cronExpression: '0 22 * * *' });
    expect(ok.status).toBe(200);
    expect(ok.body.nextRuns).toHaveLength(5);
    mockPatrolService.validateCronExpression.mockReturnValue({ valid: false, nextRuns: [], error: 'bad' });
    expect((await request(app).post('/api/patrol/cron/validate').send({ cronExpression: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/patrol/cron/validate').send({})).status).toBe(400);
  });

  it('GET /api/patrol/routes/:id/export/vda5050.json is a download', async () => {
    mockPatrolService.exportVda5050.mockResolvedValue({ nodes: [], edges: [] });
    const res = await request(app).get('/api/patrol/routes/route-1/export/vda5050.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('vda5050.json');
    expect(res.body).toEqual({ nodes: [], edges: [] });
  });

  it('GET /api/patrol/routes/:id/baseline?window= → info or 404', async () => {
    mockPatrolService.getBaseline.mockResolvedValue({ runId: 'b1', window: 'night', photos: { 'cp-1': 'cp-1.jpg' } });
    const res = await request(app).get('/api/patrol/routes/route-1/baseline?window=night');
    expect(res.status).toBe(200);
    expect(mockPatrolService.getBaseline).toHaveBeenCalledWith('route-1', 'night');
    mockPatrolService.getBaseline.mockResolvedValue(null);
    expect((await request(app).get('/api/patrol/routes/route-1/baseline')).status).toBe(404);
  });

  it('GET /api/patrol/places?robotId= proxies; 400 without robotId', async () => {
    mockPatrolService.listPlaces.mockResolvedValue({ places: [{ id: 'hallway', name: 'Hallway', placeType: 'room', keepout: false }] });
    const res = await request(app).get('/api/patrol/places?robotId=robot-001');
    expect(res.status).toBe(200);
    expect(res.body.places).toHaveLength(1);
    expect((await request(app).get('/api/patrol/places')).status).toBe(400);
  });

  // ---- start / abort -----------------------------------------------------
  it('POST /api/patrol/routes/:id/start passes the PatrolStartResult through (200 even when refused), 502 when unreachable', async () => {
    mockPatrolService.startRun.mockResolvedValue({ result: { accepted: false, reason: 'battery', message: 'low' }, unreachable: false });
    const refused = await request(app).post('/api/patrol/routes/route-1/start').send({ mode: 'patrol' });
    expect(refused.status).toBe(200);
    expect(refused.body).toEqual({ accepted: false, reason: 'battery', message: 'low' });
    expect(mockPatrolService.startRun).toHaveBeenCalledWith('route-1', { robotId: undefined, mode: 'patrol', origin: undefined });

    mockPatrolService.startRun.mockResolvedValue({ result: { accepted: false, reason: 'unreachable', message: 'x' }, unreachable: true });
    expect((await request(app).post('/api/patrol/routes/route-1/start').send({ mode: 'baseline' })).status).toBe(502);

    expect((await request(app).post('/api/patrol/routes/route-1/start').send({ mode: 'fly' })).status).toBe(400);
    mockPatrolService.startRun.mockRejectedValue(new NotFoundError('Robot', 'ghost'));
    expect((await request(app).post('/api/patrol/routes/route-1/start').send({ robotId: 'ghost' })).status).toBe(404);
  });

  it('a 4xx from the robot reaches the operator verbatim instead of a phantom 502 "could not be reached"', async () => {
    // Agent id mismatch: the robot answered instantly and said exactly what is
    // wrong. startRun re-throws instead of recording an 'unreachable' run.
    const body = { code: 'ROBOT_NOT_FOUND', message: 'This agent serves robot g1-edu-01' };
    mockPatrolService.startRun.mockRejectedValue(new HttpClientError(`HTTP 404: ${JSON.stringify(body)}`, 404, '/x', undefined, body));
    const res = await request(app).post('/api/patrol/routes/route-1/start').send({ mode: 'patrol' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual(body);
  });

  it('POST /api/robots/:id/agent-mode/patrol (+/abort) aliases', async () => {
    mockPatrolService.startRun.mockResolvedValue({ result: { accepted: true, runId: 'run-9', message: 'ok' }, unreachable: false });
    const res = await request(app).post('/api/robots/robot-001/agent-mode/patrol').send({ routeId: 'route-1', mode: 'baseline' });
    expect(res.status).toBe(200);
    expect(res.body.runId).toBe('run-9');
    expect(mockPatrolService.startRun).toHaveBeenCalledWith('route-1', { robotId: 'robot-001', mode: 'baseline', origin: 'operator' });
    expect((await request(app).post('/api/robots/robot-001/agent-mode/patrol').send({})).status).toBe(400);

    mockPatrolService.abortOnRobot.mockResolvedValue({ ok: true, runId: 'run-9' });
    const ab = await request(app).post('/api/robots/robot-001/agent-mode/patrol/abort').send({ reason: 'test' });
    expect(ab.status).toBe(200);
    expect(mockPatrolService.abortOnRobot).toHaveBeenCalledWith('robot-001', 'test');

    mockPatrolService.abortRun.mockResolvedValue({ ok: true });
    expect((await request(app).post('/api/patrol/routes/route-1/abort').send({})).status).toBe(200);
    mockPatrolService.abortRun.mockRejectedValue(new HttpClientError('connect ECONNREFUSED', undefined, '/x', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })));
    expect((await request(app).post('/api/patrol/routes/route-1/abort').send({})).status).toBe(502);
  });

  // ---- runs & findings ---------------------------------------------------
  it('GET /api/patrol/runs, /runs/:runId, POST /runs/:runId/promote', async () => {
    mockPatrolService.listRuns.mockResolvedValue([RUN]);
    const list = await request(app).get('/api/patrol/runs?routeId=route-1&robotId=robot-001&limit=5&status=done,skipped');
    expect(list.status).toBe(200);
    expect(mockPatrolService.listRuns).toHaveBeenCalledWith({ routeId: 'route-1', robotId: 'robot-001', status: ['done', 'skipped'], limit: 5 });
    mockPatrolService.getRunWithFindings.mockResolvedValue({ ...RUN, findings: [FINDING] });
    const one = await request(app).get('/api/patrol/runs/run-1');
    expect(one.status).toBe(200);
    expect(one.body.findings[0].id).toBe('finding-1');
    mockPatrolService.getRunWithFindings.mockRejectedValue(new NotFoundError('PatrolRun', 'x'));
    expect((await request(app).get('/api/patrol/runs/x')).status).toBe(404);
    mockPatrolService.promoteRun.mockResolvedValue({ ok: true });
    expect((await request(app).post('/api/patrol/runs/run-1/promote')).body).toEqual({ ok: true });
  });

  it('GET /api/patrol/findings(+/:id) and the three actions', async () => {
    mockPatrolService.listFindings.mockResolvedValue([FINDING]);
    const list = await request(app).get('/api/patrol/findings?status=open&routeId=route-1');
    expect(list.status).toBe(200);
    expect(mockPatrolService.listFindings).toHaveBeenCalledWith({ status: 'open', routeId: 'route-1', robotId: undefined, runId: undefined, limit: 100 });
    mockPatrolService.getFinding.mockResolvedValue(FINDING);
    expect((await request(app).get('/api/patrol/findings/finding-1')).body.id).toBe('finding-1');

    mockPatrolService.acknowledgeFinding.mockResolvedValue({ ...FINDING, status: 'acknowledged' });
    expect((await request(app).post('/api/patrol/findings/finding-1/acknowledge')).body.status).toBe('acknowledged');
    mockPatrolService.markFindingNormal.mockResolvedValue({ ...FINDING, status: 'dismissed_normal', robotNotified: true });
    const n = await request(app).post('/api/patrol/findings/finding-1/normal');
    expect(n.body.status).toBe('dismissed_normal');
    expect(n.body.robotNotified).toBe(true);
    mockPatrolService.escalateFinding.mockResolvedValue({ ...FINDING, status: 'escalated', incidentId: 'inc-1' });
    expect((await request(app).post('/api/patrol/findings/finding-1/escalate')).body.incidentId).toBe('inc-1');
    mockPatrolService.escalateFinding.mockRejectedValue(new NotFoundError('PatrolFinding', 'x'));
    expect((await request(app).post('/api/patrol/findings/x/escalate')).status).toBe(404);
  });

  // ---- photos ------------------------------------------------------------
  it('PUT then GET /api/robots/:id/patrol-runs/:runId/photos/:key round-trips a JPEG', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const put = await request(app)
      .put('/api/robots/robot-001/patrol-runs/run-1/photos/cp-1.jpg')
      .send({ imageB64: jpeg.toString('base64'), contentType: 'image/jpeg', kind: 'control', checkpointId: 'cp-1', routeId: 'route-1', capturedAt: '2026-08-16T01:00:00.000Z' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ ok: true, key: 'cp-1.jpg', url: '/api/robots/robot-001/patrol-runs/run-1/photos/cp-1.jpg', kind: 'control' });

    const get = await request(app).get('/api/robots/robot-001/patrol-runs/run-1/photos/cp-1.jpg').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toMatch(/image\/jpeg/);
    expect(get.headers['x-patrol-photo-kind']).toBe('control');
    expect(Buffer.compare(get.body as Buffer, jpeg)).toBe(0);

    const list = await request(app).get('/api/robots/robot-001/patrol-runs/run-1/photos');
    expect(list.body).toEqual([expect.objectContaining({ key: 'cp-1.jpg', kind: 'control', checkpointId: 'cp-1' })]);

    expect((await request(app).get('/api/robots/robot-001/patrol-runs/run-1/photos/missing.jpg')).status).toBe(404);
    expect((await request(app).put('/api/robots/robot-001/patrol-runs/run-1/photos/cp-1.jpg').send({})).status).toBe(400);
    expect((await request(app).get('/api/robots/robot-001/patrol-runs/..%2Frun-1/photos/cp-1.jpg')).status).toBe(400);
  });

  // ---- events ingest -----------------------------------------------------
  it('POST /api/robots/:id/agent-mode/events hands patrol/finding events to PatrolService.ingest and fans them out with the fields intact', async () => {
    const seen: any[] = [];
    const off = agentModeService.onAgentModeEvent((e) => seen.push(e));
    const patrol = { ...RUN };
    const finding = { ...FINDING };
    const res = await request(app).post('/api/robots/robot-001/agent-mode/events').send({ type: 'agent:finding:detected', robotId: 'robot-001', patrol, finding, timestamp: '2026-08-16T01:02:00.000Z' });
    off();
    expect(res.status).toBe(200);
    expect(mockPatrolService.ingest).toHaveBeenCalledTimes(1);
    const ev = (mockPatrolService.ingest.mock.calls as unknown as Array<[any]>)[0][0];
    expect(ev.type).toBe('agent:finding:detected');
    expect(ev.patrol).toEqual(patrol);
    expect(ev.finding).toEqual(finding);
    expect(seen).toHaveLength(1);
    expect(seen[0].patrol).toEqual(patrol);
    expect(seen[0].finding).toEqual(finding);

    // a non-patrol event is not handed over
    await request(app).post('/api/robots/robot-001/agent-mode/events').send({ type: 'agent:block:started', robotId: 'robot-001', block: { id: 'b', kind: 'walk', params: {}, status: 'running' } });
    expect(mockPatrolService.ingest).toHaveBeenCalledTimes(1);
  });
});
