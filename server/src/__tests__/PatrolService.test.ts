/**
 * @file PatrolService.test.ts
 * @description PatrolService (TASK-212): ingest persists runs/findings, raises
 *              exactly one alert per finding and one per skipped run, is
 *              idempotent; severity by type × window; route validation; the
 *              start proxy (unreachable vs. a robot 4xx/5xx answer); stale-run
 *              reconciliation; VDA5050 export; finding actions; baseline
 *              lookup incl. expired photos. Plus (TASK-222) the leg-START
 *              snapshot: it applies on top of the settle before it, is
 *              rejected when it arrives after its own settle, and leaves
 *              findings, alerts and the compliance trail alone.
 * @feature patrol
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PatrolService,
  deriveFindingSeverity,
  isNightWindow,
  alertSeverityFor,
  findingAlertMessage,
  normaliseCheckpoints,
  normaliseTimeWindows,
  DEFAULT_TIME_WINDOWS,
} from '../services/PatrolService.js';
import { HttpClientError } from '../services/HttpClient.js';
import { FakePatrolRepository, fakeAlerts, fakeCompliance, fakePhotos, makeRun, makeFinding } from './patrol-test-fakes.js';
import type { AgentModeEvent, PatrolLeg, PatrolLegStatus } from '../types/agent-mode.types.js';

function build(opts: { post?: ReturnType<typeof vi.fn>; get?: ReturnType<typeof vi.fn>; robot?: boolean; incidents?: any } = {}) {
  const repo = new FakePatrolRepository();
  const alerts = fakeAlerts();
  const compliance = fakeCompliance();
  const post = opts.post ?? vi.fn(async () => ({ accepted: true, runId: 'run-x', message: 'ok' }));
  const get = opts.get ?? vi.fn(async () => ({ places: [] }));
  const photos = fakePhotos(repo);
  const httpCalls: Array<{ baseUrl: string; timeout: number }> = [];
  const service = new PatrolService({
    repo: repo.asRepo(),
    alerts,
    compliance,
    photos,
    incidents: opts.incidents === undefined ? null : opts.incidents,
    robots: { getRegisteredRobot: async () => (opts.robot === false ? null : { baseUrl: 'http://robot:41243' }) },
    httpClient: (baseUrl, timeout) => {
      httpCalls.push({ baseUrl, timeout });
      return { post, get } as any;
    },
    now: () => Date.parse('2026-08-16T01:00:00.000Z'),
  });
  return { repo, alerts, compliance, photos, post, get, service, httpCalls };
}

function ev(type: AgentModeEvent['type'], extra: Partial<AgentModeEvent>): AgentModeEvent {
  return { type, robotId: 'robot-001', timestamp: '2026-08-16T01:00:00.000Z', ...extra };
}

describe('PatrolService — pure helpers', () => {
  it('derives severity by type × window', () => {
    expect(deriveFindingSeverity('person', true)).toBe('high');
    expect(deriveFindingSeverity('door_open', true)).toBe('high');
    expect(deriveFindingSeverity('person', false)).toBe('medium');
    expect(deriveFindingSeverity('unexpected_object', false)).toBe('medium');
    expect(deriveFindingSeverity('object_on_floor', true)).toBe('medium');
    for (const t of ['missing_object', 'out_of_place', 'lights_on', 'expectation_failed', 'other'] as const) {
      expect(deriveFindingSeverity(t, true)).toBe('low');
    }
  });

  it('maps finding severity onto AlertSeverity (never critical)', () => {
    expect(alertSeverityFor('high')).toBe('error');
    expect(alertSeverityFor('medium')).toBe('warning');
    expect(alertSeverityFor('low')).toBe('info');
  });

  it('recognises night windows by id/name or by wrapping midnight', () => {
    expect(isNightWindow('night', DEFAULT_TIME_WINDOWS)).toBe(true);
    expect(isNightWindow('day', DEFAULT_TIME_WINDOWS)).toBe(false);
    expect(isNightWindow('late', [{ id: 'late', name: 'Late shift', startHour: 22, endHour: 5 }])).toBe(true);
    expect(isNightWindow('w1', [{ id: 'w1', name: 'Morning', startHour: 6, endHour: 12 }])).toBe(false);
    expect(isNightWindow('night', [])).toBe(true); // no route to consult → id decides
    expect(isNightWindow(null, DEFAULT_TIME_WINDOWS)).toBe(false);
  });

  it('alert message carries route/run/place/time and the [finding:… run:…] tail', () => {
    const msg = findingAlertMessage(makeFinding(), makeRun());
    expect(msg).toContain('route: Night round');
    expect(msg).toContain('run: run-1');
    expect(msg).toContain('place: hallway');
    expect(msg).toContain('at: 2026-08-16T01:02:00.000Z');
    expect(msg.endsWith('[finding:finding-1 run:run-1]')).toBe(true);
  });

  it('normalises checkpoints: mints ids, defaults name/actions, validates', () => {
    const cps = normaliseCheckpoints([{ placeId: 'Hallway North' }, { id: 'k', placeId: 'kitchen', actions: ['dwell'], dwellMs: 1500, headingDeg: 45, expectations: ['door closed', ''] }]);
    expect(cps[0]).toEqual({ id: 'cp-1-hallway-north', placeId: 'Hallway North', name: 'Hallway North', headingDeg: null, actions: ['capture'] });
    expect(cps[1]).toEqual({ id: 'k', placeId: 'kitchen', name: 'kitchen', headingDeg: 45, actions: ['dwell'], dwellMs: 1500, expectations: ['door closed'] });
    expect(() => normaliseCheckpoints([{ name: 'no place' }])).toThrow(/placeId/);
    expect(() => normaliseCheckpoints([{ placeId: 'a', actions: ['fly'] }])).toThrow(/unknown action/);
    expect(() => normaliseCheckpoints('nope')).toThrow(/array/);
  });

  it('normalises time windows: defaults day/night when omitted, validates hours', () => {
    expect(normaliseTimeWindows(undefined)).toEqual(DEFAULT_TIME_WINDOWS);
    expect(normaliseTimeWindows([])).toEqual([]);
    expect(normaliseTimeWindows([{ name: 'Late', startHour: 22, endHour: 5 }])).toEqual([{ id: 'late', name: 'Late', startHour: 22, endHour: 5 }]);
    expect(() => normaliseTimeWindows([{ id: 'x', name: 'x', startHour: 25, endHour: 1 }])).toThrow(/startHour/);
  });
});

describe('PatrolService — routes', () => {
  it('creates a route with defaults and a nextRunAt when scheduled', async () => {
    const { service } = build();
    const r = await service.createRoute({ name: 'Round', robotId: 'robot-001', checkpoints: [{ placeId: 'hallway' }], cronExpression: '0 22 * * *' });
    expect(r.name).toBe('Round');
    expect(r.enabled).toBe(true);
    expect(r.timeWindows).toEqual(DEFAULT_TIME_WINDOWS);
    expect(r.nextRunAt).not.toBeNull();
    expect(new Date(r.nextRunAt!).getTime()).toBeGreaterThan(Date.parse('2026-08-16T01:00:00.000Z'));
  });

  it('rejects an empty name, no checkpoints, a bad cron', async () => {
    const { service } = build();
    await expect(service.createRoute({ checkpoints: [{ placeId: 'a' }] })).rejects.toThrow(/name/);
    await expect(service.createRoute({ name: 'x', checkpoints: [] })).rejects.toThrow(/checkpoint/);
    await expect(service.createRoute({ name: 'x', checkpoints: [{ placeId: 'a' }], cronExpression: 'garbage' })).rejects.toThrow(/cron/);
  });

  it('update re-plans nextRunAt when the cron or enabled flag changes, clears it when disabled', async () => {
    const { service, repo } = build();
    const r = repo.seedRoute({ cronExpression: '0 22 * * *' });
    const u1 = await service.updateRoute(r.id, { cronExpression: '0 3 * * *' });
    expect(u1.cronExpression).toBe('0 3 * * *');
    expect(u1.nextRunAt).not.toBeNull();
    const u2 = await service.updateRoute(r.id, { enabled: false });
    expect(u2.nextRunAt).toBeNull();
    const u3 = await service.updateRoute(r.id, { name: 'Renamed' });
    expect(u3.name).toBe('Renamed');
    await expect(service.updateRoute('missing', { name: 'x' })).rejects.toThrow(/not found/);
  });

  it('exports VDA5050 nodes/edges in checkpoint order + home', async () => {
    const { service, repo } = build();
    const r = repo.seedRoute({});
    const order = await service.exportVda5050(r.id);
    expect(order.orderId).toBe(r.id);
    expect(order.nodes.map((n) => n.nodeId)).toEqual(['hallway', 'kitchen', 'dock']);
    expect(order.nodes.map((n) => n.sequenceId)).toEqual([0, 2, 4]);
    expect(order.edges.map((e) => [e.startNodeId, e.endNodeId, e.sequenceId])).toEqual([['hallway', 'kitchen', 1], ['kitchen', 'dock', 3]]);
    expect(order.nodes[0].actions.map((a) => a.actionType)).toEqual(['alignHeading', 'capturePhoto']);
    expect(order.nodes[1].actions.map((a) => a.actionType)).toEqual(['capturePhoto', 'wait']);
    expect(order.nodes[2].actions).toEqual([]);
  });

  it('cron validate returns 5 next runs', () => {
    const { service } = build();
    const v = service.validateCronExpression('0 22,3 * * 1-5');
    expect(v.valid).toBe(true);
    expect(v.nextRuns).toHaveLength(5);
    expect(service.validateCronExpression('bad').valid).toBe(false);
  });
});

describe('PatrolService — start proxy', () => {
  it('posts the route inline to the robot and passes the PatrolStartResult through', async () => {
    const { service, repo, post, httpCalls } = build();
    const r = repo.seedRoute({});
    const out = await service.startRun(r.id, { mode: 'baseline' });
    expect(out.unreachable).toBe(false);
    expect(out.result).toEqual({ accepted: true, runId: 'run-x', message: 'ok', reason: undefined });
    expect(httpCalls[0].baseUrl).toBe('http://robot:41243');
    expect(post).toHaveBeenCalledWith('/api/v1/robots/robot-001/agent-mode/patrol', expect.objectContaining({
      routeId: r.id, mode: 'baseline', origin: 'operator', route: expect.objectContaining({ id: r.id, checkpoints: r.checkpoints }),
    }));
  });

  it('a refusal is not an error: HTTP body passes through, no server-side run (the robot emits it)', async () => {
    const post = vi.fn(async () => ({ accepted: false, reason: 'battery', message: 'battery 12%' }));
    const { service, repo, alerts } = build({ post });
    const r = repo.seedRoute({});
    const out = await service.startRun(r.id, {});
    expect(out.unreachable).toBe(false);
    expect(out.result.accepted).toBe(false);
    expect(out.result.reason).toBe('battery');
    expect(repo.runs.size).toBe(0);
    expect(alerts.createRobotAlert).not.toHaveBeenCalled();
  });

  it('unreachable robot: records a skipped run (reason unreachable, all legs skipped) + one warning alert', async () => {
    const post = vi.fn(async () => { throw new HttpClientError('connect ECONNREFUSED', undefined, '/x', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })); });
    const { service, repo, alerts, compliance } = build({ post });
    const r = repo.seedRoute({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await service.startRun(r.id, { origin: 'scheduled' });
    expect(out.unreachable).toBe(true);
    expect(out.result.accepted).toBe(false);
    expect(out.result.reason).toBe('unreachable');
    const runs = [...repo.runs.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('skipped');
    expect(runs[0].origin).toBe('scheduled');
    expect(runs[0].reason).toMatch(/^unreachable/);
    expect(runs[0].legs.map((l) => l.status)).toEqual(['skipped', 'skipped']);
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
    expect(alerts.createRobotAlert.mock.calls[0][1]).toBe('warning');
    expect(alerts.createRobotAlert.mock.calls[0][2]).toMatch(/^Patrol Night round skipped: unreachable/);
    expect(runs[0].alertId).toBe('alert-1');
    expect(compliance.logSystemEvent).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ eventName: 'patrol.run.skipped' }) }));
  });

  it('a robot 4xx is an ANSWER, not "unreachable": it rejects out, with no phantom run and no alert', async () => {
    // The agent serves another robot id (re-provisioned box, mixed fleet):
    // 404 {code:'ROBOT_NOT_FOUND'}. Recording that as an unreachable skipped
    // run buried the diagnostic and, on a cron route, minted a phantom run +
    // warning alert every slot forever.
    const body = { code: 'ROBOT_NOT_FOUND', message: 'This agent serves robot g1-edu-01' };
    const post = vi.fn(async () => { throw new HttpClientError(`HTTP 404: ${JSON.stringify(body)}`, 404, '/x', undefined, body); });
    const { service, repo, alerts, compliance } = build({ post });
    const r = repo.seedRoute({});
    await expect(service.startRun(r.id, { origin: 'scheduled' })).rejects.toMatchObject({ statusCode: 404, responseBody: body });
    expect(repo.runs.size).toBe(0);
    expect(alerts.createRobotAlert).not.toHaveBeenCalled();
    expect(compliance.logSystemEvent).not.toHaveBeenCalled();
  });

  it('a robot 5xx still records the skipped run + alert, but not as "unreachable"', async () => {
    const post = vi.fn(async () => { throw new HttpClientError('HTTP 500: {"error":"boom"}', 500, '/x', undefined, { error: 'boom' }); });
    const { service, repo, alerts } = build({ post });
    const r = repo.seedRoute({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await service.startRun(r.id, { origin: 'scheduled' });
    expect(out.result.reason).toBe('robot_error');
    expect(out.result.message).toMatch(/rejected the start/);
    const runs = [...repo.runs.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('skipped');
    expect(runs[0].reason).toMatch(/^robot rejected start: HTTP 500/);
    expect(runs[0].reason).not.toMatch(/unreachable/);
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
    expect(alerts.createRobotAlert.mock.calls[0][2]).toMatch(/^Patrol Night round skipped: robot rejected start/);
  });

  it('recordFailedStart leaves a trace for a scheduled slot whose start threw', async () => {
    const { service, repo, alerts } = build();
    const r = repo.seedRoute({});
    await service.recordFailedStart(r.id, null, 'patrol', 'scheduled', 'HTTP 404: {"code":"ROBOT_NOT_FOUND"}');
    const runs = [...repo.runs.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'skipped', origin: 'scheduled', robotId: 'robot-001' });
    expect(runs[0].reason).toMatch(/^start rejected: HTTP 404/);
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
  });

  it('needs a robot: 400 when the route is unbound and none given, 404 when unknown', async () => {
    const { service, repo } = build({ robot: false });
    const r = repo.seedRoute({ robotId: null });
    await expect(service.startRun(r.id, {})).rejects.toThrow(/robotId is required/);
    await expect(service.startRun(r.id, { robotId: 'ghost' })).rejects.toThrow(/not found/);
  });
});

describe('PatrolService — ingest', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.repo.seedRoute({ id: 'route-1' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('persists the run on started/leg/finished (upsert by runId) and audits start + end', async () => {
    const { service, repo, compliance } = ctx;
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun() }));
    expect(repo.runs.get('run-1')?.status).toBe('running');
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: [{ index: 0, checkpointId: 'cp-1', placeId: 'hallway', name: 'Hallway', status: 'done', findingIds: [] }] }) }));
    expect(repo.runs.get('run-1')?.legs).toHaveLength(1);
    await service.ingest(ev('agent:patrol:finished', { patrol: makeRun({ status: 'done', finishedAt: '2026-08-16T01:10:00.000Z', findingCount: 0 }) }));
    expect(repo.runs.size).toBe(1);
    expect(repo.runs.get('run-1')?.status).toBe('done');
    const names = compliance.logSystemEvent.mock.calls.map((c: any[]) => c[0].payload.eventName);
    expect(names).toEqual(['patrol.run.started', 'patrol.run.finished']);
    expect(compliance.logSystemEvent.mock.calls[0][0].sessionId).toBe('patrol-run-1');
  });

  it('a skipped run raises exactly one warning alert, even when the finished event is repeated', async () => {
    const { service, repo, alerts } = ctx;
    const skipped = makeRun({ runId: 'run-s', status: 'skipped', reason: 'battery', finishedAt: '2026-08-16T01:00:01.000Z' });
    await service.ingest(ev('agent:patrol:finished', { patrol: skipped }));
    await service.ingest(ev('agent:patrol:finished', { patrol: skipped }));
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
    // The `[run:<id>]` tag is what the app parses into "Open run →" and
    // strips from the prose — so the run id must appear ONCE, in the tag: it
    // used to be printed twice, the second time as a raw bracketed uuid.
    const [, , title, message] = alerts.createRobotAlert.mock.calls[0];
    expect(title).toBe('Patrol Night round skipped: battery');
    expect(message.endsWith('[run:run-s]')).toBe(true);
    expect(message.match(/run-s/g)).toHaveLength(1);
    expect(message).not.toMatch(/run: run-s/);
    expect(repo.runs.get('run-s')?.alertId).toBe('alert-1');
  });

  it('a finding is persisted once, alerted once (severity by type × window), and re-observations only update', async () => {
    const { service, repo, alerts, compliance } = ctx;
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun() }));
    const f = makeFinding({ type: 'person', severity: 'low', place: 'kitchen' });
    await service.ingest(ev('agent:finding:detected', { patrol: makeRun({ findingCount: 1 }), finding: f }));
    await service.ingest(ev('agent:finding:detected', { patrol: makeRun({ findingCount: 1 }), finding: f })); // duplicate push
    await service.ingest(ev('agent:finding:confirmed', { patrol: makeRun({ findingCount: 1 }), finding: { ...f, confidence: 0.95, evidence: { ...f.evidence, observations: 3 } } }));

    expect(repo.findings.size).toBe(1);
    const stored = repo.findings.get('finding-1')!;
    expect(stored.severity).toBe('high'); // person at night → server-derived, overrides the robot's 'low'
    expect(stored.status).toBe('open');
    expect(stored.confidence).toBe(0.95);
    expect(stored.evidence.observations).toBe(3);
    expect(stored.alertId).toBe('alert-1');
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
    const [robotId, sev, title, message] = alerts.createRobotAlert.mock.calls[0];
    expect(robotId).toBe('robot-001');
    expect(sev).toBe('error');
    expect(title).toBe(`Patrol finding: ${f.summary}`);
    expect(message).not.toContain(f.summary); // the title carries it — the banner used to read it twice
    expect(message).toContain('[finding:finding-1 run:run-1]');
    expect(message).toContain('place: kitchen');
    expect(compliance.logSystemEvent.mock.calls.map((c: any[]) => c[0].payload.eventName)).toContain('patrol.finding.confirmed');
    // the run row got the newest snapshot too
    expect(repo.runs.get('run-1')?.findingCount).toBe(1);
  });

  it('day-window findings get medium/low severities → warning/info alerts', async () => {
    const { service, alerts } = ctx;
    const dayRun = makeRun({ runId: 'run-d', window: 'day' });
    await service.ingest(ev('agent:finding:detected', { patrol: dayRun, finding: makeFinding({ id: 'f-obj', runId: 'run-d', type: 'unexpected_object' }) }));
    await service.ingest(ev('agent:finding:detected', { patrol: dayRun, finding: makeFinding({ id: 'f-light', runId: 'run-d', type: 'lights_on' }) }));
    expect(alerts.createRobotAlert.mock.calls.map((c: any[]) => c[1])).toEqual(['warning', 'info']);
    // A low finding is an info alert that still waits for a human — no 10 s auto-dismiss.
    expect(alerts.createRobotAlert.mock.calls.map((c: any[]) => c[4])).toEqual([{ persistent: true }, { persistent: true }]);
  });

  it('a finding whose run was never seen and that carries no run is ignored (no orphan rows, no alert)', async () => {
    const { service, repo, alerts } = ctx;
    await service.ingest(ev('agent:finding:detected', { finding: makeFinding({ id: 'orphan', runId: 'run-never' }) }));
    expect(repo.findings.size).toBe(0);
    expect(alerts.createRobotAlert).not.toHaveBeenCalled();
  });

  it('a stale snapshot never downgrades a finished run (leg after finished, finding run after finished)', async () => {
    const { service, repo } = ctx;
    const legDone = { index: 0, checkpointId: 'cp-1', placeId: 'hallway', name: 'Hallway', status: 'done' as const, findingIds: [] };
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun() }));
    await service.ingest(ev('agent:patrol:finished', { patrol: makeRun({ status: 'done', finishedAt: '2026-08-16T01:10:00.000Z', legs: [legDone] }) }));
    // The last leg event lands late (separate connection): ignored.
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: [legDone] }) }));
    expect(repo.runs.get('run-1')?.status).toBe('done');
    expect(repo.runs.get('run-1')?.finishedAt).toBe('2026-08-16T01:10:00.000Z');
    // A finding carrying a still-running run snapshot only guarantees the row exists; it does not downgrade it.
    await service.ingest(ev('agent:finding:detected', { patrol: makeRun({ legs: [legDone], findingCount: 1 }), finding: makeFinding() }));
    expect(repo.runs.get('run-1')?.status).toBe('done');
    expect(repo.findings.size).toBe(1);
    // Fewer settled legs than stored is a downgrade too.
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ status: 'running', legs: [{ ...legDone, status: 'running' }] }) }));
    expect(repo.runs.get('run-1')?.legs[0].status).toBe('done');
    // A repeated terminal snapshot with newer information still applies.
    await service.ingest(ev('agent:patrol:finished', { patrol: makeRun({ status: 'done', finishedAt: '2026-08-16T01:10:00.000Z', legs: [legDone], findingCount: 1 }) }));
    expect(repo.runs.get('run-1')?.findingCount).toBe(1);
  });

  it('concurrent ingests for one run are applied in arrival order (finished after leg, even when leg is slower)', async () => {
    const { service, repo } = ctx;
    // Make the first findRunById slow so the leg's read/write would otherwise straddle the finished write.
    const realFind = repo.findRunById.bind(repo);
    let slowOnce = true;
    repo.findRunById = async (id: string) => {
      if (slowOnce) { slowOnce = false; await new Promise((r) => setTimeout(r, 20)); }
      return realFind(id);
    };
    const legDone = { index: 0, checkpointId: 'cp-1', placeId: 'hallway', name: 'Hallway', status: 'done' as const, findingIds: [] };
    const p1 = service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: [legDone] }) }));
    const p2 = service.ingest(ev('agent:patrol:finished', { patrol: makeRun({ status: 'aborted', reason: 'stop', finishedAt: '2026-08-16T01:10:00.000Z', legs: [legDone] }) }));
    await Promise.all([p1, p2]);
    expect(repo.runs.get('run-1')?.status).toBe('aborted');
    expect(repo.runs.get('run-1')?.finishedAt).toBe('2026-08-16T01:10:00.000Z');
  });

  it('a run for a route the server no longer has is still recorded and its skipped alert raised', async () => {
    const { service, repo, alerts } = ctx;
    const skipped = makeRun({ runId: 'run-gone', routeId: 'route-deleted', status: 'skipped', reason: 'route_unknown', finishedAt: '2026-08-16T01:00:01.000Z' });
    await service.ingest(ev('agent:patrol:finished', { patrol: skipped }));
    expect(repo.runs.get('run-gone')?.status).toBe('skipped');
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
  });

  it('a human status survives re-observation and ingest never throws on bad payloads', async () => {
    const { service, repo } = ctx;
    await service.ingest(ev('agent:finding:detected', { patrol: makeRun(), finding: makeFinding() }));
    await service.acknowledgeFinding('finding-1', 'u1');
    await service.ingest(ev('agent:finding:confirmed', { patrol: makeRun(), finding: makeFinding({ confidence: 0.99 }) }));
    expect(repo.findings.get('finding-1')?.status).toBe('acknowledged');
    expect(repo.findings.get('finding-1')?.confidence).toBe(0.99);
    await expect(service.ingest(ev('agent:patrol:started', {}))).resolves.toBeUndefined();
    await expect(service.ingest(ev('agent:finding:detected', { finding: { nope: true } as any }))).resolves.toBeUndefined();
    await expect(service.ingest(ev('agent:plan:updated', {}))).resolves.toBeUndefined();
  });
});

/**
 * The three-checkpoint fixture the TASK-222 tests walk, stamped the way
 * `PatrolRunner` stamps a leg: `startedAt` the moment it goes `running`, the
 * rest of the leg (photo, inspection) only once it settles.
 */
const PATROL_LEG_NAMES: ReadonlyArray<readonly [string, string, string]> = [
  ['cp-1', 'hallway', 'Hallway'],
  ['cp-2', 'kitchen', 'Kitchen'],
  ['cp-3', 'dock', 'Loading dock'],
];

function leg(i: number, status: PatrolLegStatus): PatrolLeg {
  const [checkpointId, placeId, name] = PATROL_LEG_NAMES[i];
  const l: PatrolLeg = { index: i, checkpointId, placeId, name, status, findingIds: [] };
  if (status !== 'pending') l.startedAt = `2026-08-16T01:0${i * 2}:00.000Z`;
  if (status === 'done') {
    l.finishedAt = `2026-08-16T01:0${i * 2 + 1}:00.000Z`;
    l.photoKey = `run-1/${checkpointId}.jpg`;
    l.inspection = 'same';
  }
  return l;
}

/**
 * The whole `legs` array as the robot's own snapshot has it at one moment of
 * the round: every leg before `at` settled `done`, leg `at` in `status`, every
 * leg after it still `pending`.
 */
function legsAt(at: number, status: PatrolLegStatus): PatrolLeg[] {
  return PATROL_LEG_NAMES.map((_, i) => leg(i, i < at ? 'done' : i > at ? 'pending' : status));
}

describe('PatrolService — a leg reported at its start (TASK-222)', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
    ctx.repo.seedRoute({ id: 'route-1' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('applies a leg-start snapshot on top of the settle before it', async () => {
    const { service, repo } = ctx;
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun({ legs: legsAt(0, 'pending') }) }));
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(0, 'done') }) }));
    // Same settled-leg count as the settle before it (1), still `running`,
    // still no `finishedAt` — patrol's `isRunDowngrade` has no turns clause to
    // separate them either, and all three of its clauses fall through, so the
    // snapshot is applied.
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(1, 'running') }) }));

    const stored = repo.runs.get('run-1');
    expect(stored?.legs.map((l) => l.status)).toEqual(['done', 'running', 'pending']);
    expect(stored?.legs[1].startedAt).toBe('2026-08-16T01:02:00.000Z');
    expect(stored?.legs[1].finishedAt).toBeUndefined();
  });

  it('rejects a leg-start snapshot that arrives after the settle it precedes', async () => {
    const { service, repo } = ctx;
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun({ legs: legsAt(0, 'pending') }) }));
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(1, 'done') }) }));
    // One settled leg fewer than stored: dropped, so the checkpoint keeps its
    // photo, its inspection verdict and its `finishedAt`.
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(1, 'running') }) }));

    const stored = repo.runs.get('run-1');
    expect(stored?.legs.map((l) => l.status)).toEqual(['done', 'done', 'pending']);
    expect(stored?.legs[1].finishedAt).toBe('2026-08-16T01:03:00.000Z');
    expect(stored?.legs[1].photoKey).toBe('run-1/cp-2.jpg');
  });

  it('writes no compliance record and raises no alert for any leg event of a run it already knows', async () => {
    const { service, compliance, alerts } = ctx;
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun({ legs: legsAt(0, 'pending') }) }));
    for (let i = 0; i < PATROL_LEG_NAMES.length; i++) {
      await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(i, 'running') }) }));
      await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(i, 'done') }) }));
    }
    // `patrol.run.started` once, from `started` itself, and nothing from the
    // six leg events that follow it.
    expect(compliance.logSystemEvent.mock.calls.map((c: any[]) => c[0].payload.eventName)).toEqual(['patrol.run.started']);
    expect(alerts.createRobotAlert).not.toHaveBeenCalled();

    await service.ingest(
      ev('agent:patrol:finished', {
        patrol: makeRun({ legs: legsAt(2, 'done'), status: 'skipped', reason: 'battery too low', finishedAt: '2026-08-16T01:10:00.000Z' }),
      }),
    );
    expect(compliance.logSystemEvent.mock.calls.map((c: any[]) => c[0].payload.eventName)).toEqual([
      'patrol.run.started',
      'patrol.run.finished',
    ]);
    expect(alerts.createRobotAlert).toHaveBeenCalledTimes(1);
  });

  it('leaves findings alone: a leg event neither creates, re-alerts nor re-audits one', async () => {
    const { service, repo, alerts, compliance } = ctx;
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun({ legs: legsAt(0, 'pending') }) }));
    await service.ingest(
      ev('agent:finding:detected', {
        patrol: makeRun({ legs: legsAt(0, 'running'), findingCount: 1 }),
        finding: makeFinding({ type: 'person' }),
      }),
    );
    const alertsAfterFinding = alerts.createRobotAlert.mock.calls.length;
    const auditsAfterFinding = compliance.logSystemEvent.mock.calls.length;

    // The leg-start of the NEXT checkpoint carries the run — findings are keyed
    // off `agent:finding:*` alone, so it can only move the run row.
    const withFinding = legsAt(1, 'running');
    withFinding[0].findingIds = ['finding-1'];
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: withFinding, findingCount: 1 }) }));

    expect(repo.findings.size).toBe(1);
    const finding = repo.findings.get('finding-1')!;
    expect(finding.severity).toBe('high'); // server-derived at first sight, untouched since
    expect(finding.status).toBe('open');
    expect(finding.alertId).toBe('alert-1');
    expect(alerts.createRobotAlert.mock.calls).toHaveLength(alertsAfterFinding);
    expect(compliance.logSystemEvent.mock.calls).toHaveLength(auditsAfterFinding);
    expect(repo.runs.get('run-1')?.legs[1].status).toBe('running');
  });

  /**
   * The tour twin of this carries the full reasoning. `settle(i-1)` and
   * `start(i)` leave the runner a few lines apart on separate fire-and-forget
   * connections, and every ORIGINAL clause of `isRunDowngrade` read them as
   * equals (same settled-leg count, both `running`, both without
   * `finishedAt`), while `ingestChains` orders by ARRIVAL. Patrol was the worse
   * off of the two: it has no turns clause to break the tie at all.
   * `startedLegCount` breaks it for both.
   */
  it('rejects a settle that overtakes the next leg-start, so the leg keeps its start', async () => {
    const { service, repo } = ctx;
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun({ legs: legsAt(0, 'pending') }) }));
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(1, 'running') }) })); // emitted second
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(0, 'done') }) })); // emitted first

    expect(repo.runs.get('run-1')?.legs.map((l) => l.status)).toEqual(['done', 'running', 'pending']);
    expect(repo.runs.get('run-1')?.legs[1].startedAt).toBeDefined();
  });

  /**
   * The compliance-trail half of the same reordering window, which is patrol's
   * alone — tour has no equivalent arm.
   *
   * `ingestRun` writes `patrol.run.started` on `event.type ===
   * 'agent:patrol:started' || (!before && run.status === 'running')`, and
   * `audit()` does not dedupe. The second arm fires for ANY run-carrying event
   * that is the first the server has seen for that run, a leg event included.
   * Until TASK-222 the first leg event was a settle emitted a checkpoint later
   * and could not race `started`; the leg-START event can.
   *
   * `startedLegCount` closes it, because the two events do NOT carry the same
   * legs: `agent:patrol:started` is emitted at the top of `drive()`, before the
   * leg loop, so every leg in its snapshot is still `pending` (zero legs
   * started), while `start(leg 0)` has begun one. Arriving second, `started` is
   * refused as the older snapshot and never reaches the audit.
   *
   * The residual: were the two payloads ever byte-identical, no content-based
   * guard could order them and the record would still be written twice. That is
   * accepted rather than closed by special-casing the audit — a duplicated
   * compliance record is recoverable; a missing one is not.
   *
   * The dedupe key that was rejected here ("the row already exists") was
   * rejected because it is ALSO true when a finding event created the row
   * without auditing. That hole is now closed at its source rather than worked
   * around: the first-sighting audit sits above `ingestRun`'s quiet return, so
   * the finding that creates the row writes the record itself. See the test
   * below.
   */
  it('still writes patrol.run.started when a FINDING is the first event for the run', async () => {
    // The mirror image of the test below, and the case the started-leg and
    // finding clauses opened. A finding's embedded run is ingested `quiet`, so
    // before this fix it created the row and wrote nothing; the real `started`
    // then arrived carrying zero legs started and findingCount 0 against a row
    // with one of each, was refused by BOTH new clauses, and returned at the
    // downgrade check. The run existed with no `patrol.run.started` record at
    // all — the missing record the guard was explicitly chosen to avoid.
    const { service, compliance } = ctx;
    await service.ingest(
      ev('agent:finding:detected', {
        patrol: makeRun({ legs: legsAt(0, 'running'), findingCount: 1 }),
        finding: makeFinding(),
      }),
    );
    const names = () => compliance.logSystemEvent.mock.calls.map((c: any[]) => c[0].payload.eventName);
    expect(names()).toContain('patrol.run.started');

    // And the late `started`, refused as the older snapshot, does not add a second.
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun({ legs: legsAt(0, 'pending') }) }));
    expect(names().filter((n: string) => n === 'patrol.run.started')).toHaveLength(1);
  });

  it('writes patrol.run.started once when a leg-start overtakes `started`', async () => {
    const { service, compliance } = ctx;
    // Emitted second, delivered first — and the first event the server sees.
    await service.ingest(ev('agent:patrol:leg', { patrol: makeRun({ legs: legsAt(0, 'running') }) }));
    expect(compliance.logSystemEvent.mock.calls.map((c: any[]) => c[0].payload.eventName)).toEqual(['patrol.run.started']);

    // The real `started` payload: emitted before the leg loop, so nothing has begun.
    await service.ingest(ev('agent:patrol:started', { patrol: makeRun({ legs: legsAt(0, 'pending') }) }));
    expect(compliance.logSystemEvent.mock.calls.map((c: any[]) => c[0].payload.eventName)).toEqual(['patrol.run.started']);
  });
});

describe('PatrolService — stale run reconciliation', () => {
  const T0 = Date.parse('2026-08-16T01:00:00.000Z');
  /** A run that started three hours ago and never finished — the lost `finished` event. */
  function stale(over: Record<string, unknown> = {}) {
    return makeRun({ runId: 'run-lost', status: 'running', startedAt: '2026-08-15T22:00:00.000Z', finishedAt: null, ...over });
  }

  it('closes a run the robot no longer knows, so the live banner and the retry guard let go', async () => {
    const get = vi.fn(async () => ({ enabled: true, active: null, lastRun: null }));
    const { service, repo, compliance } = build({ get });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await repo.upsertRun(stale());
    expect(await service.reconcileStaleRuns(60 * 60_000)).toBe(1);
    const run = repo.runs.get('run-lost')!;
    expect(run.status).toBe('failed');
    expect(run.finishedAt).toBe(new Date(T0).toISOString());
    expect(run.reason).toMatch(/lost contact/);
    expect(run.legs.map((l) => l.status)).toEqual(['done', 'skipped']); // pending legs settle
    expect(compliance.logSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ eventName: 'patrol.run.finished' }) }),
    );
  });

  it('adopts the robot\'s own terminal copy when it still has one', async () => {
    const robotCopy = makeRun({ runId: 'run-lost', status: 'done', startedAt: '2026-08-15T22:00:00.000Z', finishedAt: '2026-08-15T22:30:00.000Z', findingCount: 2 });
    const get = vi.fn(async () => ({ enabled: true, active: null, lastRun: robotCopy }));
    const { service, repo } = build({ get });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await repo.upsertRun(stale());
    expect(await service.reconcileStaleRuns(60 * 60_000)).toBe(1);
    expect(repo.runs.get('run-lost')).toMatchObject({ status: 'done', finishedAt: '2026-08-15T22:30:00.000Z', findingCount: 2 });
  });

  it('leaves a run alone when the robot is still walking it, when it cannot be asked, or when it is fresh', async () => {
    // Still active on the robot.
    const active = build({ get: vi.fn(async () => ({ enabled: true, active: makeRun({ runId: 'run-lost' }), lastRun: null })) });
    await active.repo.upsertRun(stale());
    expect(await active.service.reconcileStaleRuns(60 * 60_000)).toBe(0);
    expect(active.repo.runs.get('run-lost')?.status).toBe('running');

    // Robot unreachable: silence is not proof the run ended.
    const down = build({ get: vi.fn(async () => { throw new HttpClientError('Connection refused: /x'); }) });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await down.repo.upsertRun(stale());
    expect(await down.service.reconcileStaleRuns(60 * 60_000)).toBe(0);
    expect(down.repo.runs.get('run-lost')?.status).toBe('running');

    // A long route that pushed a leg two minutes ago is not stale, and is never asked about.
    const walking = build({ get: vi.fn(async () => ({ enabled: true, active: null, lastRun: null })) });
    await walking.repo.upsertRun(stale({
      legs: [{ index: 0, checkpointId: 'cp-1', placeId: 'hallway', name: 'Hallway', status: 'done', finishedAt: '2026-08-16T00:58:00.000Z', findingIds: [] }],
    }));
    expect(await walking.service.reconcileStaleRuns(60 * 60_000)).toBe(0);
    expect(walking.get).not.toHaveBeenCalled();
    expect(walking.repo.runs.get('run-lost')?.status).toBe('running');
  });
});

describe('PatrolService — finding actions', () => {
  async function seeded(extra: Parameters<typeof build>[0] = {}) {
    const c = build(extra);
    c.repo.seedRoute({ id: 'route-1' });
    await c.service.ingest(ev('agent:finding:detected', { patrol: makeRun(), finding: makeFinding() }));
    return c;
  }

  it('acknowledge: status acknowledged + the alert is acknowledged', async () => {
    const { service, alerts } = await seeded();
    const f = await service.acknowledgeFinding('finding-1', 'user-9');
    expect(f.status).toBe('acknowledged');
    expect(alerts.acknowledgeAlert).toHaveBeenCalledWith('alert-1', 'user-9');
  });

  it('normal: status dismissed_normal + forwards to the robot (robotNotified)', async () => {
    const post = vi.fn(async () => ({ ok: true }));
    const { service } = await seeded({ post });
    const f = await service.markFindingNormal('finding-1');
    expect(f.status).toBe('dismissed_normal');
    expect(f.robotNotified).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/v1/robots/robot-001/agent-mode/patrol/findings/finding-1/normal', { runId: 'run-1' });
  });

  it('normal: robot down → still dismissed, robotNotified false', async () => {
    const post = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { service } = await seeded({ post });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await service.markFindingNormal('finding-1');
    expect(f.status).toBe('dismissed_normal');
    expect(f.robotNotified).toBe(false);
  });

  it('escalate: creates an incident when the service is there, tolerates its absence', async () => {
    const incidents = { createIncident: vi.fn(async (input: any) => ({ id: 'inc-1', ...input })) };
    const { service } = await seeded({ incidents });
    const f = await service.escalateFinding('finding-1', 'u1');
    expect(f.status).toBe('escalated');
    expect(f.incidentId).toBe('inc-1');
    expect(incidents.createIncident).toHaveBeenCalledWith(expect.objectContaining({ type: 'safety', severity: 'medium', robotId: 'robot-001', alertIds: ['alert-1'] }));

    const { service: s2 } = await seeded();
    const g = await s2.escalateFinding('finding-1');
    expect(g.status).toBe('escalated');
    expect(g.incidentId).toBeNull();
  });

  it('getRunWithFindings + baseline lookup', async () => {
    const { service, repo } = await seeded();
    const withF = await service.getRunWithFindings('run-1');
    expect(withF.findings.map((x) => x.id)).toEqual(['finding-1']);
    await repo.upsertRun(makeRun({ runId: 'base-old', mode: 'baseline', status: 'done', startedAt: '2026-08-10T01:00:00.000Z' }));
    await repo.upsertRun(makeRun({ runId: 'base-new', mode: 'baseline', status: 'done', startedAt: '2026-08-12T01:00:00.000Z' }));
    await repo.upsertRun(makeRun({ runId: 'base-day', mode: 'baseline', status: 'done', window: 'day', startedAt: '2026-08-13T01:00:00.000Z' }));
    const b = await service.getBaseline('route-1', 'night');
    expect(b?.runId).toBe('base-new');
    expect(b?.photos).toEqual({ 'cp-1': 'cp-1.jpg' });
    expect((await service.getBaseline('route-1', 'day'))?.runId).toBe('base-day');
    expect(await service.getBaseline('route-1', 'nope')).toBeNull();
  });

  it('getBaseline drops checkpoints whose photo the retention sweep took, and says so', async () => {
    const { service, repo, photos } = build();
    repo.seedRoute({ id: 'route-1' });
    await repo.upsertRun(makeRun({ runId: 'base-old', mode: 'baseline', status: 'done', startedAt: '2026-01-10T01:00:00.000Z' }));
    expect(await service.getBaseline('route-1', 'night')).toMatchObject({ photos: { 'cp-1': 'cp-1.jpg' }, photosExpired: false });
    // Day 31: the sweep deleted the bytes, the run record still names them.
    // Advertising that key made the baseline half of every photo pair 404 and
    // read "photo unavailable", with nothing telling the operator to re-baseline.
    photos.expire('base-old');
    expect(await service.getBaseline('route-1', 'night')).toMatchObject({ runId: 'base-old', photos: {}, photosExpired: true });
  });

  it('currentBaselineRunIds names the runs the retention sweep must keep', async () => {
    const { service, repo } = build();
    repo.seedRoute({ id: 'route-1' });
    await repo.upsertRun(makeRun({ runId: 'base-old', mode: 'baseline', status: 'done', startedAt: '2026-01-10T01:00:00.000Z' }));
    await repo.upsertRun(makeRun({ runId: 'base-new', mode: 'baseline', status: 'done', startedAt: '2026-02-10T01:00:00.000Z' }));
    await repo.upsertRun(makeRun({ runId: 'base-day', mode: 'baseline', status: 'done', window: 'day', startedAt: '2026-02-11T01:00:00.000Z' }));
    const ids = await service.currentBaselineRunIds();
    expect([...ids].sort()).toEqual(['base-day', 'base-new']); // the superseded January run ages out
  });

  it('promoteRun persists promotedAt once the robot answered ok, and getBaseline prefers the promoted run', async () => {
    const post = vi.fn(async () => ({ ok: true }));
    const { service, repo } = build({ post });
    repo.seedRoute({ id: 'route-1' });
    await repo.upsertRun(makeRun({ runId: 'base-old', mode: 'baseline', status: 'done', startedAt: '2026-08-10T01:00:00.000Z' }));
    await repo.upsertRun(makeRun({
      runId: 'patrol-2', mode: 'patrol', status: 'done', startedAt: '2026-08-14T01:00:00.000Z',
      legs: [
        { index: 0, checkpointId: 'cp-1', placeId: 'hallway', name: 'Hallway', status: 'done', photoKey: 'patrol-2/cp-1.jpg', findingIds: [] },
        { index: 1, checkpointId: 'cp-2', placeId: 'kitchen', name: 'Kitchen', status: 'done', photoKey: 'patrol-2/cp-2.jpg', findingIds: [] },
      ],
    }));
    expect((await service.getBaseline('route-1', 'night'))?.runId).toBe('base-old');

    const out = await service.promoteRun('patrol-2');
    expect(out).toEqual({ ok: true });
    expect(post).toHaveBeenCalledWith('/api/v1/robots/robot-001/agent-mode/patrol/runs/patrol-2/promote', {});
    expect((await repo.findRunById('patrol-2'))?.promotedAt).toBe('2026-08-16T01:00:00.000Z');
    expect((await repo.findRunById('base-old'))?.promotedAt).toBeNull();

    // A later run snapshot from the robot must not wipe the promotion.
    await repo.upsertRun(makeRun({ runId: 'patrol-2', mode: 'patrol', status: 'done', startedAt: '2026-08-14T01:00:00.000Z' }));
    expect((await repo.findRunById('patrol-2'))?.promotedAt).toBe('2026-08-16T01:00:00.000Z');

    const b = await service.getBaseline('route-1', 'night');
    expect(b?.runId).toBe('patrol-2');
    expect(b?.photos).toEqual({ 'cp-1': 'cp-1.jpg' });
    // Other windows still fall back to their baseline-mode runs.
    await repo.upsertRun(makeRun({ runId: 'base-day', mode: 'baseline', status: 'done', window: 'day', startedAt: '2026-08-13T01:00:00.000Z' }));
    expect((await service.getBaseline('route-1', 'day'))?.runId).toBe('base-day');
    // No window filter → the promoted run wins over any baseline run.
    expect((await service.getBaseline('route-1'))?.runId).toBe('patrol-2');
  });

  it('promoteRun does not persist promotedAt when the robot refuses', async () => {
    const post = vi.fn(async () => ({ ok: false }));
    const { service, repo } = build({ post });
    repo.seedRoute({ id: 'route-1' });
    await repo.upsertRun(makeRun({ runId: 'patrol-2', mode: 'patrol', status: 'done' }));
    expect(await service.promoteRun('patrol-2')).toEqual({ ok: false });
    expect((await repo.findRunById('patrol-2'))?.promotedAt).toBeNull();
  });
});
