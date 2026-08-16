/**
 * @file PatrolSchedulerService.test.ts
 * @description The patrol scheduler (TASK-212) fires a due route once per
 *              slot with origin 'scheduled' / mode 'patrol', initialises a
 *              fresh schedule without back-fill, retries exactly once after
 *              PATROL_RETRY_MIN on refusal/unreachable (a stale 'running' row
 *              no longer blocks that retry), reconciles stale runs each tick,
 *              records a skip when the start throws, and honours the env
 *              switch.
 * @feature patrol
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PatrolSchedulerService, patrolSchedulerEnabled, patrolRetryMinutes } from '../services/PatrolSchedulerService.js';
import { FakePatrolRepository } from './patrol-test-fakes.js';

const T0 = Date.parse('2026-08-16T21:59:00.000Z');

const STALE_MS = 60 * 60_000;

function build(startImpl?: (routeId: string, opts: any) => Promise<any>) {
  const repo = new FakePatrolRepository();
  let now = T0;
  const startRun = vi.fn(startImpl ?? (async () => ({ result: { accepted: true, runId: 'r' }, unreachable: false })));
  const recordFailedStart = vi.fn(async () => {});
  const reconcileStaleRuns = vi.fn(async () => 0);
  const svc = new PatrolSchedulerService({
    repo: repo.asRepo(),
    starter: { startRun: startRun as any, recordFailedStart: recordFailedStart as any, reconcileStaleRuns: reconcileStaleRuns as any },
    now: () => now,
    retryMinutes: () => 10,
    staleRunMs: () => STALE_MS,
  });
  return { repo, svc, startRun, recordFailedStart, reconcileStaleRuns, setNow: (t: number) => { now = t; }, at: () => new Date(now) };
}

describe('PatrolSchedulerService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('env switch: default on, "false"/"0" off; retry minutes default 10', () => {
    expect(patrolSchedulerEnabled({})).toBe(true);
    expect(patrolSchedulerEnabled({ PATROL_SCHEDULER_ENABLED: 'false' })).toBe(false);
    expect(patrolSchedulerEnabled({ PATROL_SCHEDULER_ENABLED: '0' })).toBe(false);
    expect(patrolSchedulerEnabled({ PATROL_SCHEDULER_ENABLED: 'true' })).toBe(true);
    expect(patrolRetryMinutes({})).toBe(10);
    expect(patrolRetryMinutes({ PATROL_RETRY_MIN: '3' })).toBe(3);
    expect(patrolRetryMinutes({ PATROL_RETRY_MIN: 'x' })).toBe(10);
  });

  it('start() is a no-op when disabled, idempotent otherwise; stop is safe', () => {
    vi.stubEnv('PATROL_SCHEDULER_ENABLED', 'false');
    const { svc, startRun } = build();
    svc.start();
    svc.stop();
    expect(startRun).not.toHaveBeenCalled();
    vi.stubEnv('PATROL_SCHEDULER_ENABLED', 'true');
    svc.start();
    svc.start();
    svc.stop();
    svc.stop();
  });

  it('first sight initialises nextRunAt from now (no back-fill) and does not fire', async () => {
    const { repo, svc, startRun, at } = build();
    // Every day at 22:00 UTC-ish: cron is evaluated in server-local time, so use every-minute for determinism.
    const r = repo.seedRoute({ cronExpression: '* * * * *' });
    await svc.tick(at());
    expect(startRun).not.toHaveBeenCalled();
    const stored = repo.routes.get(r.id)!;
    expect(stored.nextRunAt).not.toBeNull();
    expect(Date.parse(stored.nextRunAt!)).toBeGreaterThan(T0);
  });

  it('fires once per due slot with origin scheduled / mode patrol, then advances the slot', async () => {
    const { repo, svc, startRun, setNow, at } = build();
    const r = repo.seedRoute({ cronExpression: '* * * * *' });
    await svc.tick(at()); // initialise
    const slot = Date.parse(repo.routes.get(r.id)!.nextRunAt!);
    setNow(slot); // exactly the slot
    await svc.tick(at());
    await svc.tick(at()); // same instant again → must not double-fire
    setNow(slot + 20_000);
    await svc.tick(at()); // 20 s later, still the same minute → no second fire
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(startRun).toHaveBeenCalledWith(r.id, { robotId: 'robot-001', mode: 'patrol', origin: 'scheduled' });
    const stored = repo.routes.get(r.id)!;
    expect(Date.parse(stored.lastFiredAt!)).toBe(slot);
    expect(Date.parse(stored.nextRunAt!)).toBeGreaterThan(slot);
    // next slot → fires again (once)
    setNow(Date.parse(stored.nextRunAt!) + 1000);
    await svc.tick(at());
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(2);
  });

  it('skips routes that are disabled, unbound or unscheduled', async () => {
    const { repo, svc, startRun, setNow, at } = build();
    repo.seedRoute({ id: 'off', cronExpression: '* * * * *', enabled: false });
    repo.seedRoute({ id: 'unbound', cronExpression: '* * * * *', robotId: null });
    repo.seedRoute({ id: 'manual', cronExpression: null });
    await svc.tick(at());
    setNow(T0 + 120_000);
    await svc.tick(at());
    expect(startRun).not.toHaveBeenCalled();
  });

  it('retries exactly once after PATROL_RETRY_MIN when refused, then gives up for that slot', async () => {
    const answers = [
      { result: { accepted: false, reason: 'busy' }, unreachable: false },
      { result: { accepted: false, reason: 'busy' }, unreachable: false },
      { result: { accepted: true, runId: 'r' }, unreachable: false },
    ];
    const { repo, svc, startRun, setNow, at } = build(async () => answers.shift() ?? { result: { accepted: true }, unreachable: false });
    // A slot far apart so the retry lands before the next slot: hourly at minute 0.
    const r = repo.seedRoute({ cronExpression: '0 * * * *' });
    await svc.tick(at());
    const slot = Date.parse(repo.routes.get(r.id)!.nextRunAt!);
    setNow(slot);
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(svc.pendingRetries()).toEqual([{ routeId: r.id, slot: new Date(slot).toISOString(), dueAt: new Date(slot + 10 * 60_000).toISOString() }]);

    setNow(slot + 5 * 60_000);
    await svc.tick(at()); // too early
    expect(startRun).toHaveBeenCalledTimes(1);

    setNow(slot + 10 * 60_000);
    await svc.tick(at()); // retry fires
    expect(startRun).toHaveBeenCalledTimes(2);
    expect(svc.pendingRetries()).toEqual([]); // refused again → no second retry

    setNow(slot + 20 * 60_000);
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(2);
  });

  it('retries once when the start path threw / robot unreachable, and an accepted retry ends it', async () => {
    let calls = 0;
    const { repo, svc, startRun, setNow, at } = build(async () => {
      calls++;
      if (calls === 1) return { result: { accepted: false, reason: 'unreachable' }, unreachable: true };
      return { result: { accepted: true, runId: 'r2' }, unreachable: false };
    });
    const r = repo.seedRoute({ cronExpression: '0 * * * *' });
    await svc.tick(at());
    const slot = Date.parse(repo.routes.get(r.id)!.nextRunAt!);
    setNow(slot);
    await svc.tick(at());
    setNow(slot + 10 * 60_000);
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(2);
    expect(svc.pendingRetries()).toEqual([]);
  });

  it('a retry and a due slot in the same tick start the route once', async () => {
    const answers = [
      { result: { accepted: false, reason: 'busy' }, unreachable: false },
    ];
    const { repo, svc, startRun, setNow, at } = build(async () => answers.shift() ?? { result: { accepted: true, runId: 'r' }, unreachable: false });
    // Cron interval == retry delay: the retry for slot A comes due exactly when slot B fires.
    const r = repo.seedRoute({ cronExpression: '*/10 * * * *' });
    await svc.tick(at());
    const slotA = Date.parse(repo.routes.get(r.id)!.nextRunAt!);
    setNow(slotA);
    await svc.tick(at()); // refused → retry at slotA + 10 min
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(svc.pendingRetries()).toHaveLength(1);

    setNow(slotA + 10 * 60_000); // == slot B and the retry's due time
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(2); // ONE start, not retry + slot
    expect(svc.pendingRetries()).toEqual([]);

    setNow(slotA + 10 * 60_000 + 30_000); // next tick: slot B still due → fires; nothing else pending
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(3);
    expect(svc.pendingRetries()).toEqual([]);
  });

  it('a newer slot firing clears a pending retry for an older slot', async () => {
    const answers = [{ result: { accepted: false, reason: 'busy' }, unreachable: false }];
    const { repo, svc, startRun, setNow, at } = build(async () => answers.shift() ?? { result: { accepted: true, runId: 'r' }, unreachable: false });
    // Cron interval (5 min) shorter than the retry delay (10 min).
    const r = repo.seedRoute({ cronExpression: '*/5 * * * *' });
    await svc.tick(at());
    const slotA = Date.parse(repo.routes.get(r.id)!.nextRunAt!);
    setNow(slotA);
    await svc.tick(at()); // refused → retry due at A+10
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(svc.pendingRetries()).toHaveLength(1);
    setNow(slotA + 5 * 60_000);
    await svc.tick(at()); // slot B fires and is accepted → the retry for A is dropped
    expect(startRun).toHaveBeenCalledTimes(2);
    expect(svc.pendingRetries()).toEqual([]);
    setNow(slotA + 10 * 60_000 + 1);
    await svc.tick(at()); // slot C fires; no extra retry start
    expect(startRun).toHaveBeenCalledTimes(3);
    expect(startRun.mock.calls.every((c: any[]) => c[1].origin === 'scheduled')).toBe(true);
  });

  it('a due retry is dropped when a run for the route is already in progress', async () => {
    const answers = [{ result: { accepted: false, reason: 'busy' }, unreachable: false }];
    const { repo, svc, startRun, setNow, at } = build(async () => answers.shift() ?? { result: { accepted: true, runId: 'r' }, unreachable: false });
    const r = repo.seedRoute({ cronExpression: '0 * * * *' });
    await svc.tick(at());
    const slot = Date.parse(repo.routes.get(r.id)!.nextRunAt!);
    setNow(slot);
    await svc.tick(at());
    expect(svc.pendingRetries()).toHaveLength(1);
    // Operator started the route by hand meanwhile: the robot is walking it.
    await repo.upsertRun({
      runId: 'run-manual', routeId: r.id, routeName: r.name, robotId: r.robotId!, mode: 'patrol', origin: 'operator',
      window: null, status: 'running', startedAt: new Date(slot + 60_000).toISOString(), legs: [], findingCount: 0,
    } as any);
    setNow(slot + 10 * 60_000);
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(1); // no retry fired
    expect(svc.pendingRetries()).toEqual([]);
  });

  it('a run stuck at "running" past the stale bound stops blocking the retry forever', async () => {
    const answers = [{ result: { accepted: false, reason: 'busy' }, unreachable: false }];
    const { repo, svc, startRun, setNow, at } = build(async () => answers.shift() ?? { result: { accepted: true, runId: 'r' }, unreachable: false });
    const r = repo.seedRoute({ cronExpression: '0 * * * *' });
    await svc.tick(at());
    const slot = Date.parse(repo.routes.get(r.id)!.nextRunAt!);
    setNow(slot);
    await svc.tick(at());
    expect(svc.pendingRetries()).toHaveLength(1);
    // A `finished` event that never arrived (agent restart, dropped push) left
    // this row at 'running' a day ago. Unbounded, it dropped EVERY retry for
    // the route for the rest of the process lifetime, with only a console.log.
    await repo.upsertRun({
      runId: 'run-lost', routeId: r.id, routeName: r.name, robotId: r.robotId!, mode: 'patrol', origin: 'scheduled',
      window: null, status: 'running', startedAt: new Date(slot - 24 * 3600_000).toISOString(), legs: [], findingCount: 0,
    } as any);
    setNow(slot + 10 * 60_000);
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(2); // the retry fires anyway
  });

  it('every tick asks the service to reconcile stale runs, and a failure there does not stop the tick', async () => {
    const { svc, reconcileStaleRuns, at } = build();
    await svc.tick(at());
    expect(reconcileStaleRuns).toHaveBeenCalledTimes(1);
    reconcileStaleRuns.mockRejectedValueOnce(new Error('robot down'));
    await expect(svc.tick(at())).resolves.toBeUndefined();
    expect(reconcileStaleRuns).toHaveBeenCalledTimes(2);
  });

  it('a start that throws (robot answered 4xx) still leaves a recorded skip for the slot', async () => {
    const { repo, svc, startRun, recordFailedStart, setNow, at } = build(async () => {
      throw new Error('HTTP 404: {"code":"ROBOT_NOT_FOUND"}');
    });
    const r = repo.seedRoute({ cronExpression: '0 * * * *' });
    await svc.tick(at());
    setNow(Date.parse(repo.routes.get(r.id)!.nextRunAt!));
    await svc.tick(at());
    expect(startRun).toHaveBeenCalledTimes(1);
    // Nobody is watching a scheduled slot: without this the round would have
    // silently not happened, with only a console.error on the server.
    expect(recordFailedStart).toHaveBeenCalledWith(r.id, r.robotId, 'patrol', 'scheduled', expect.stringContaining('ROBOT_NOT_FOUND'));
    expect(svc.pendingRetries()).toHaveLength(1); // and the slot still gets its one retry
  });

  it('a retry is dropped when the route stops being schedulable', async () => {
    const { repo, svc, startRun, setNow, at } = build(async () => ({ result: { accepted: false, reason: 'estop' }, unreachable: false }));
    const r = repo.seedRoute({ cronExpression: '0 * * * *' });
    await svc.tick(at());
    const slot = Date.parse(repo.routes.get(r.id)!.nextRunAt!);
    setNow(slot);
    await svc.tick(at());
    expect(svc.pendingRetries()).toHaveLength(1);
    await repo.updateRoute(r.id, { enabled: false });
    setNow(slot + 10 * 60_000);
    await svc.tick(at());
    expect(svc.pendingRetries()).toEqual([]);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it('a repository failure does not throw out of tick', async () => {
    const { repo, svc, at } = build();
    vi.spyOn(repo, 'listSchedulableRoutes').mockRejectedValueOnce(new Error('db down'));
    await expect(svc.tick(at())).resolves.toBeUndefined();
  });
});
