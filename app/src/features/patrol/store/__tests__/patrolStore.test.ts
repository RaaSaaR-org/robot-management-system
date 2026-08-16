/**
 * @file patrolStore.test.ts
 * @description Store reducers/actions for patrol (TASK-212): live events fold
 *              into runs/findings idempotently, skipped runs are remembered per
 *              robot for the announcer, and the finding actions replace the
 *              finding the server hands back.
 * @feature patrol
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePatrolStore, selectActiveRuns, selectOverlayRun, selectLastSkipped } from '../patrolStore';
import { patrolApi } from '../../api/patrolApi';
import type { AgentModeEvent, PatrolFinding, PatrolRun } from '../../types/patrol.types';

vi.mock('../../api/patrolApi', () => ({
  patrolApi: {
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
    createRoute: vi.fn(),
    updateRoute: vi.fn(),
    deleteRoute: vi.fn(),
    startRoute: vi.fn(),
    abortRoute: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
    getBaseline: vi.fn(),
    promoteRun: vi.fn(),
    acknowledgeFinding: vi.fn(),
    markFindingNormal: vi.fn(),
    escalateFinding: vi.fn(),
    listPlaces: vi.fn(),
    validateCron: vi.fn(),
  },
  photoKeyBasename: (k: string) => k.split('/').pop(),
}));

const api = vi.mocked(patrolApi);

const run = (over: Partial<PatrolRun> = {}): PatrolRun => ({
  runId: 'run-1',
  routeId: 'route-1',
  routeName: 'Night round',
  robotId: 'g1',
  mode: 'patrol',
  origin: 'scheduled',
  window: 'night',
  status: 'running',
  startedAt: '2026-08-16T01:00:00.000Z',
  legs: [
    { index: 0, checkpointId: 'cp-a', placeId: 'hall', name: 'Hall', status: 'running', findingIds: [] },
    { index: 1, checkpointId: 'cp-b', placeId: 'kitchen', name: 'Kitchen', status: 'pending', findingIds: [] },
  ],
  findingCount: 0,
  ...over,
});

const finding = (over: Partial<PatrolFinding> = {}): PatrolFinding => ({
  id: 'f-1',
  runId: 'run-1',
  routeId: 'route-1',
  robotId: 'g1',
  legIndex: 0,
  type: 'unexpected_object',
  severity: 'medium',
  source: 'enroute_both',
  place: 'hall',
  pose: { x: 1, y: 2, yawDeg: 0 },
  at: '2026-08-16T01:02:00.000Z',
  summary: 'unexpected object in Hall (0.4 m²)',
  evidence: { observations: 2 },
  model: null,
  confidence: 0.8,
  status: 'open',
  ...over,
});

const event = (type: AgentModeEvent['type'], patrol?: PatrolRun, f?: PatrolFinding): AgentModeEvent => ({
  type,
  robotId: 'g1',
  patrol,
  finding: f,
  timestamp: '2026-08-16T01:00:00.000Z',
});

beforeEach(() => {
  usePatrolStore.getState().reset();
  vi.clearAllMocks();
});

describe('patrolStore.applyEvent', () => {
  it('a started run becomes the robot’s active run and heads the list', () => {
    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run()));
    const s = usePatrolStore.getState();
    expect(s.activeRunByRobot.g1?.runId).toBe('run-1');
    expect(s.runs.map((r) => r.runId)).toEqual(['run-1']);
    expect(selectOverlayRun('g1')(s)?.runId).toBe('run-1');
    expect(selectActiveRuns(s)).toHaveLength(1);
  });

  it('a leg event replaces the run in place instead of duplicating it', () => {
    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run()));
    const progressed = run({ legs: [{ ...run().legs[0], status: 'done' }, run().legs[1]] });
    usePatrolStore.getState().applyEvent(event('agent:patrol:leg', progressed));
    const s = usePatrolStore.getState();
    expect(s.runs).toHaveLength(1);
    expect(s.runsById['run-1'].legs[0].status).toBe('done');
  });

  it('a finished run leaves the active slot but stays the overlay’s last run', () => {
    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run()));
    usePatrolStore.getState().applyEvent(event('agent:patrol:finished', run({ status: 'done', finishedAt: '2026-08-16T01:10:00.000Z' })));
    const s = usePatrolStore.getState();
    expect(s.activeRunByRobot.g1).toBeUndefined();
    expect(selectActiveRuns(s)).toHaveLength(0);
    expect(selectOverlayRun('g1')(s)?.status).toBe('done');
  });

  it('a skipped run is remembered per robot for the announcer', () => {
    usePatrolStore.getState().applyEvent(
      event('agent:patrol:finished', run({ runId: 'run-skip', status: 'skipped', reason: 'battery 12% below minimum' }))
    );
    const s = usePatrolStore.getState();
    expect(selectLastSkipped('g1')(s)?.reason).toBe('battery 12% below minimum');
    expect(selectLastSkipped('other')(s)).toBeNull();
    expect(s.activeRunByRobot.g1).toBeUndefined();
  });

  it('detected + confirmed for the same finding id upsert into ONE finding', () => {
    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run()));
    usePatrolStore.getState().applyEvent(event('agent:finding:detected', run({ findingCount: 1 }), finding()));
    usePatrolStore
      .getState()
      .applyEvent(event('agent:finding:confirmed', run({ findingCount: 1 }), finding({ evidence: { observations: 3 } })));
    const s = usePatrolStore.getState();
    expect(s.findingsByRun['run-1']).toHaveLength(1);
    expect(s.findingsByRun['run-1'][0].evidence.observations).toBe(3);
    expect(s.runsById['run-1'].findingCount).toBe(1);
  });

  it('ignores events that are not about patrol', () => {
    usePatrolStore.getState().applyEvent({ type: 'agent:scene:updated', robotId: 'g1', timestamp: 'now' });
    expect(usePatrolStore.getState().runs).toHaveLength(0);
  });
});

describe('patrolStore actions', () => {
  it('fetchRuns sorts newest first and seeds active/last per robot', async () => {
    api.listRuns.mockResolvedValue([
      run({ runId: 'old', status: 'done', startedAt: '2026-08-15T01:00:00.000Z' }),
      run({ runId: 'new', status: 'running', startedAt: '2026-08-16T01:00:00.000Z' }),
    ]);
    await usePatrolStore.getState().fetchRuns();
    const s = usePatrolStore.getState();
    expect(s.runs.map((r) => r.runId)).toEqual(['new', 'old']);
    expect(s.activeRunByRobot.g1?.runId).toBe('new');
    expect(s.lastRunByRobot.g1?.runId).toBe('new');
    expect(s.runsStatus).toBe('ok');
  });

  it('fetchRuns/fetchRun clear an active run the server now reports as finished (missed WS event)', async () => {
    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run()));
    expect(usePatrolStore.getState().activeRunByRobot.g1?.runId).toBe('run-1');

    api.listRuns.mockResolvedValue([run({ status: 'done', finishedAt: '2026-08-16T01:30:00.000Z' })]);
    await usePatrolStore.getState().fetchRuns();
    expect(usePatrolStore.getState().activeRunByRobot.g1).toBeUndefined();
    expect(selectActiveRuns(usePatrolStore.getState())).toHaveLength(0);

    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run({ runId: 'run-2' })));
    api.getRun.mockResolvedValue({ ...run({ runId: 'run-2', status: 'aborted' }), findings: [] });
    await usePatrolStore.getState().fetchRun('run-2');
    expect(usePatrolStore.getState().activeRunByRobot.g1).toBeUndefined();
  });

  it('an unfiltered fetchRuns drops active runs the server no longer lists', async () => {
    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run({ runId: 'ghost' })));
    api.listRuns.mockResolvedValue([run({ runId: 'other', robotId: 'h1', status: 'done' })]);
    await usePatrolStore.getState().fetchRuns();
    expect(usePatrolStore.getState().activeRunByRobot.g1).toBeUndefined();
    // …but a filtered fetch is not authoritative for robots outside the filter.
    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run({ runId: 'ghost' })));
    await usePatrolStore.getState().fetchRuns({ robotId: 'h1' });
    expect(usePatrolStore.getState().activeRunByRobot.g1?.runId).toBe('ghost');
  });

  it('fetchRun stores the run and its findings separately', async () => {
    api.getRun.mockResolvedValue({ ...run({ status: 'done', findingCount: 1 }), findings: [finding()] });
    const r = await usePatrolStore.getState().fetchRun('run-1');
    expect(r?.runId).toBe('run-1');
    expect(usePatrolStore.getState().findingsByRun['run-1']).toHaveLength(1);
    expect(usePatrolStore.getState().runDetailStatus['run-1']).toBe('ok');
  });

  it('acknowledgeFinding replaces the finding the server returns', async () => {
    api.getRun.mockResolvedValue({ ...run({ status: 'done', findingCount: 1 }), findings: [finding()] });
    await usePatrolStore.getState().fetchRun('run-1');
    api.acknowledgeFinding.mockResolvedValue(finding({ status: 'acknowledged' }));
    const ok = await usePatrolStore.getState().acknowledgeFinding('f-1');
    expect(ok).toBe(true);
    expect(usePatrolStore.getState().findingsByRun['run-1'][0].status).toBe('acknowledged');
    expect(usePatrolStore.getState().busyFindingId).toBeNull();
  });

  it('markFindingNormal accepts both answer shapes', async () => {
    api.getRun.mockResolvedValue({ ...run({ status: 'done', findingCount: 1 }), findings: [finding()] });
    await usePatrolStore.getState().fetchRun('run-1');
    api.markFindingNormal.mockResolvedValue({ finding: finding({ status: 'dismissed_normal' }), robotNotified: true });
    await usePatrolStore.getState().markFindingNormal('f-1');
    expect(usePatrolStore.getState().findingsByRun['run-1'][0].status).toBe('dismissed_normal');
  });

  it('a refused start is a result, not an error', async () => {
    api.startRoute.mockResolvedValue({ accepted: false, reason: 'battery', message: 'Battery 12% is below the minimum.' });
    const res = await usePatrolStore.getState().startRun('route-1', 'patrol', 'g1');
    expect(res?.accepted).toBe(false);
    expect(usePatrolStore.getState().lastStartResult?.reason).toBe('battery');
    expect(usePatrolStore.getState().error).toBeNull();
    expect(api.startRoute).toHaveBeenCalledWith('route-1', 'patrol', 'g1');
  });

  it('a failed request lands in `error` and does not throw', async () => {
    api.listRoutes.mockRejectedValue(new Error('boom'));
    await usePatrolStore.getState().fetchRoutes();
    expect(usePatrolStore.getState().routesStatus).toBe('error');
    expect(usePatrolStore.getState().routesError).toContain('boom');
  });

  it('saveRoute upserts into the routes list', async () => {
    const route = {
      id: 'route-9',
      name: 'Round',
      robotId: 'g1',
      twinId: null,
      checkpoints: [],
      cronExpression: null,
      enabled: true,
      timeWindows: [],
      homePlaceId: null,
      createdAt: 'x',
      updatedAt: 'x',
    };
    api.createRoute.mockResolvedValue(route);
    await usePatrolStore.getState().saveRoute({ name: 'Round', checkpoints: [] });
    api.updateRoute.mockResolvedValue({ ...route, name: 'Round 2' });
    await usePatrolStore.getState().saveRoute({ name: 'Round 2', checkpoints: [] }, 'route-9');
    expect(usePatrolStore.getState().routes).toHaveLength(1);
    expect(usePatrolStore.getState().routes[0].name).toBe('Round 2');
  });
});
