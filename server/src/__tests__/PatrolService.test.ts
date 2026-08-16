/**
 * @file PatrolService.test.ts
 * @description PatrolService (TASK-212): ingest persists runs/findings, raises
 *              exactly one alert per finding and one per skipped run, is
 *              idempotent; severity by type × window; route validation; the
 *              start proxy records an 'unreachable' skipped run; VDA5050
 *              export; finding actions.
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
import { FakePatrolRepository, fakeAlerts, fakeCompliance, makeRun, makeFinding } from './patrol-test-fakes.js';
import type { AgentModeEvent } from '../types/agent-mode.types.js';

function build(opts: { post?: ReturnType<typeof vi.fn>; get?: ReturnType<typeof vi.fn>; robot?: boolean; incidents?: any } = {}) {
  const repo = new FakePatrolRepository();
  const alerts = fakeAlerts();
  const compliance = fakeCompliance();
  const post = opts.post ?? vi.fn(async () => ({ accepted: true, runId: 'run-x', message: 'ok' }));
  const get = opts.get ?? vi.fn(async () => ({ places: [] }));
  const httpCalls: Array<{ baseUrl: string; timeout: number }> = [];
  const service = new PatrolService({
    repo: repo.asRepo(),
    alerts,
    compliance,
    incidents: opts.incidents === undefined ? null : opts.incidents,
    robots: { getRegisteredRobot: async () => (opts.robot === false ? null : { baseUrl: 'http://robot:41243' }) },
    httpClient: (baseUrl, timeout) => {
      httpCalls.push({ baseUrl, timeout });
      return { post, get } as any;
    },
    now: () => Date.parse('2026-08-16T01:00:00.000Z'),
  });
  return { repo, alerts, compliance, post, get, service, httpCalls };
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
    expect(alerts.createRobotAlert.mock.calls[0]).toEqual(['robot-001', 'warning', 'Patrol Night round skipped: battery', expect.stringContaining('[run:run-s]')]);
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
    expect(title).toBe(f.summary);
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
});
