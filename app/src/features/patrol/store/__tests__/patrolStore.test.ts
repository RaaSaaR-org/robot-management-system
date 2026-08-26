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
import type { AgentModeEvent, PatrolFinding, PatrolLeg, PatrolRun } from '../../types/patrol.types';

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

  it('a late leg event never resurrects a run that already finished', () => {
    // The robot pushes every event fire-and-forget over its own connection, and
    // the server broadcasts them raw, so the leg that preceded `finished` can
    // land after it. Applied blindly it put the parked robot back on the map
    // overlay as "Running" forever — the overlay has no poll to heal it.
    const finished = run({
      status: 'done',
      finishedAt: '2026-08-16T01:10:00.000Z',
      legs: [
        { ...run().legs[0], status: 'done' },
        { ...run().legs[1], status: 'done' },
      ],
    });
    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run()));
    usePatrolStore.getState().applyEvent(event('agent:patrol:finished', finished));

    const lateLeg = run({ legs: [{ ...run().legs[0], status: 'done' }, run().legs[1]] });
    usePatrolStore.getState().applyEvent(event('agent:patrol:leg', lateLeg));

    const s = usePatrolStore.getState();
    expect(s.runsById['run-1'].status).toBe('done');
    expect(s.runsById['run-1'].finishedAt).toBe('2026-08-16T01:10:00.000Z');
    expect(s.runsById['run-1'].legs[1].status).toBe('done');
    expect(s.activeRunByRobot.g1).toBeUndefined();
    expect(selectActiveRuns(s)).toHaveLength(0);
    expect(selectOverlayRun('g1')(s)?.status).toBe('done');
  });

  it('a late finding is still recorded, but its stale run snapshot is not', () => {
    usePatrolStore
      .getState()
      .applyEvent(event('agent:patrol:finished', run({ status: 'done', finishedAt: '2026-08-16T01:10:00.000Z', findingCount: 1 })));
    usePatrolStore.getState().applyEvent(event('agent:finding:confirmed', run({ status: 'running', findingCount: 1 }), finding()));

    const s = usePatrolStore.getState();
    expect(s.findingsByRun['run-1']).toHaveLength(1);
    expect(s.runsById['run-1'].status).toBe('done');
    expect(s.activeRunByRobot.g1).toBeUndefined();
  });

  it('a late leg does not erase the skip the announcer is still reading', () => {
    // The patrol branch deletes `lastSkippedByRobot` for any non-skipped run;
    // an out-of-order leg used to silently swallow an announced skip.
    const skipped = run({ runId: 'run-skip', status: 'skipped', reason: 'battery 12% below minimum', finishedAt: '2026-08-16T01:05:00.000Z' });
    usePatrolStore.getState().applyEvent(event('agent:patrol:finished', skipped));
    usePatrolStore.getState().applyEvent(event('agent:patrol:leg', run({ runId: 'run-skip' })));

    const s = usePatrolStore.getState();
    expect(selectLastSkipped('g1')(s)?.reason).toBe('battery 12% below minimum');
    expect(s.runsById['run-skip'].status).toBe('skipped');
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
    expect(usePatrolStore.getState().findingRobotNotified['f-1']).toBe(true);
  });

  it('markFindingNormal keeps robotNotified:false so the UI can say the robot was not taught', async () => {
    api.getRun.mockResolvedValue({ ...run({ status: 'done', findingCount: 1 }), findings: [finding()] });
    await usePatrolStore.getState().fetchRun('run-1');
    api.markFindingNormal.mockResolvedValue({ finding: finding({ status: 'dismissed_normal' }), robotNotified: false });
    await usePatrolStore.getState().markFindingNormal('f-1');
    expect(usePatrolStore.getState().findingsByRun['run-1'][0].status).toBe('dismissed_normal');
    expect(usePatrolStore.getState().findingRobotNotified['f-1']).toBe(false);
  });

  it('a refused start is a result, not an error', async () => {
    api.startRoute.mockResolvedValue({ accepted: false, reason: 'battery', message: 'Battery 12% is below the minimum.' });
    const res = await usePatrolStore.getState().startRun('route-1', 'patrol', 'g1');
    expect(res?.accepted).toBe(false);
    expect(usePatrolStore.getState().lastStartResult?.reason).toBe('battery');
    expect(usePatrolStore.getState().error).toBeNull();
    expect(api.startRoute).toHaveBeenCalledWith('route-1', 'patrol', 'g1');
  });

  it('an abort the robot refuses lands in `error` — the operator must not think the run was stopped', async () => {
    api.abortRoute.mockResolvedValue({ ok: false });
    const ok = await usePatrolStore.getState().abortRun('route-1', 'g1');
    expect(ok).toBe(false);
    expect(api.abortRoute).toHaveBeenCalledWith('route-1', 'g1');
    expect(usePatrolStore.getState().error).toMatch(/did not stop the run/i);
  });

  it('an abort that errors lands in `error` too, and an accepted one leaves it clean', async () => {
    api.abortRoute.mockRejectedValue(new Error('robot unreachable'));
    expect(await usePatrolStore.getState().abortRun('route-1', 'g1')).toBe(false);
    expect(usePatrolStore.getState().error).toContain('robot unreachable');

    usePatrolStore.getState().clearError();
    api.abortRoute.mockResolvedValue({ ok: true, runId: 'run-1' });
    expect(await usePatrolStore.getState().abortRun('route-1', 'g1')).toBe(true);
    expect(usePatrolStore.getState().error).toBeNull();
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

describe('selectActiveRuns', () => {
  // A three-checkpoint route, one status per checkpoint.
  const legs = (...statuses: PatrolLeg['status'][]): PatrolLeg[] =>
    statuses.map((status, index) => ({
      index,
      checkpointId: `cp-${index}`,
      placeId: `place-${index}`,
      name: `Place ${index}`,
      status,
      findingIds: [],
    }));

  // The rail re-reads this selector on every store change. The only snapshots that
  // ever show a leg as 'running' are the ones embedded in finding events — there is
  // no leg-start event — and the `leg` event that settles that same checkpoint has
  // exactly as many non-pending legs. A selector keyed on that count therefore kept
  // handing the rail the older snapshot, and the checkpoint pulsed forever.
  it('sees the leg that settles the checkpoint where a finding was raised', () => {
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', run({ legs: legs('pending', 'pending', 'pending') })));
    store.applyEvent(
      event('agent:finding:detected', run({ legs: legs('done', 'running', 'pending'), findingCount: 1 }), finding({ legIndex: 1 }))
    );
    const atFinding = selectActiveRuns(usePatrolStore.getState());
    expect(atFinding[0].legs[1].status).toBe('running');

    store.applyEvent(event('agent:patrol:leg', run({ legs: legs('done', 'done', 'pending'), findingCount: 1 })));
    const afterLeg = selectActiveRuns(usePatrolStore.getState());
    expect(afterLeg).not.toBe(atFinding);
    expect(afterLeg[0].legs[1].status).toBe('done');
  });

  it('sees the FINAL leg settle instead of pulsing it all the way home', () => {
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', run({ legs: legs('pending', 'pending', 'pending') })));
    store.applyEvent(
      event('agent:finding:detected', run({ legs: legs('done', 'done', 'running'), findingCount: 1 }), finding({ legIndex: 2 }))
    );
    const atFinding = selectActiveRuns(usePatrolStore.getState());
    expect(atFinding[0].legs[2].status).toBe('running');

    store.applyEvent(event('agent:patrol:leg', run({ legs: legs('done', 'done', 'done'), findingCount: 1 })));
    const afterLeg = selectActiveRuns(usePatrolStore.getState());
    expect(afterLeg).not.toBe(atFinding);
    expect(afterLeg[0].legs[2].status).toBe('done');
  });
});

describe('patrolStore leg-start events (TASK-222)', () => {
  // `PatrolRunner` now emits `agent:patrol:leg` when a leg STARTS as well as
  // when it settles. Before that the only snapshots holding a `running` leg were
  // the ones embedded in finding events, so the banner named a checkpoint only
  // on the rounds where something was found.

  /** A three-checkpoint route as one status per checkpoint, under its own run id. */
  const at = (runId: string, ...statuses: PatrolLeg['status'][]): PatrolRun =>
    run({
      runId,
      legs: statuses.map((status, index) => ({
        index,
        checkpointId: `cp-${index}`,
        placeId: `place-${index}`,
        name: `Place ${index}`,
        status,
        findingIds: [],
      })),
    });

  it('a leg-start event puts a running leg into the active run', () => {
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', at('pls-1', 'pending', 'pending', 'pending')));
    expect(selectActiveRuns(usePatrolStore.getState())[0].legs.some((l) => l.status === 'running')).toBe(false);

    store.applyEvent(event('agent:patrol:leg', at('pls-1', 'running', 'pending', 'pending')));
    const active = selectActiveRuns(usePatrolStore.getState())[0];
    expect(active.legs[0].status).toBe('running');
    expect(active.legs.find((l) => l.status === 'running')?.index).toBe(0);
  });

  it('the start of the NEXT checkpoint is accepted even though it settles nothing new', () => {
    // The guard rejects a snapshot reporting FEWER settled legs; a leg-start
    // carries exactly as many as the settle before it. Equal is not fewer.
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', at('pls-2', 'pending', 'pending', 'pending')));
    store.applyEvent(event('agent:patrol:leg', at('pls-2', 'running', 'pending', 'pending')));
    store.applyEvent(event('agent:patrol:leg', at('pls-2', 'done', 'pending', 'pending')));
    store.applyEvent(event('agent:patrol:leg', at('pls-2', 'done', 'running', 'pending')));

    const stored = usePatrolStore.getState().runsById['pls-2'];
    expect(stored.legs.map((l) => l.status)).toEqual(['done', 'running', 'pending']);
  });

  it('a late leg-start never walks the run back to a checkpoint the robot has left', () => {
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', at('pls-3', 'pending', 'pending', 'pending')));
    store.applyEvent(event('agent:patrol:leg', at('pls-3', 'done', 'running', 'pending')));
    store.applyEvent(event('agent:patrol:leg', at('pls-3', 'done', 'done', 'pending')));
    store.applyEvent(event('agent:patrol:leg', at('pls-3', 'done', 'running', 'pending')));

    const stored = usePatrolStore.getState().runsById['pls-3'];
    expect(stored.legs.map((l) => l.status)).toEqual(['done', 'done', 'pending']);
  });

  it('a leg-start arriving after the run finished does not resurrect it', () => {
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', at('pls-4', 'pending', 'pending', 'pending')));
    store.applyEvent(
      event('agent:patrol:finished', {
        ...at('pls-4', 'done', 'done', 'done'),
        status: 'done',
        finishedAt: '2026-08-16T01:30:00.000Z',
      })
    );
    store.applyEvent(event('agent:patrol:leg', at('pls-4', 'done', 'done', 'running')));

    const s = usePatrolStore.getState();
    expect(s.runsById['pls-4'].status).toBe('done');
    expect(s.runsById['pls-4'].legs[2].status).toBe('done');
    expect(s.activeRunByRobot.g1).toBeUndefined();
  });

  it('a leg-start that predates a finding on the same checkpoint does not erase it', () => {
    // The one window the extra emit opens that tour does not have. Both
    // snapshots show checkpoint 2 as `running`, so they report the SAME settled
    // count and the settled-leg clause cannot separate them — but the leg-start
    // was taken before the finding existed, so applying it late drops the amber
    // badge off the node and walks `findingCount` back to zero.
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', at('pls-5', 'pending', 'pending', 'pending')));

    const walking = at('pls-5', 'done', 'running', 'pending');
    const found: PatrolRun = {
      ...walking,
      findingCount: 1,
      legs: walking.legs.map((l) => (l.index === 1 ? { ...l, findingIds: ['f-1'] } : l)),
    };
    store.applyEvent(event('agent:finding:detected', found, finding({ legIndex: 1 })));
    // …and only now does that checkpoint's own start event land.
    store.applyEvent(event('agent:patrol:leg', walking));

    const stored = usePatrolStore.getState().runsById['pls-5'];
    expect(stored.legs[1].status).toBe('running');
    expect(stored.findingCount).toBe(1);
    expect(stored.legs[1].findingIds).toEqual(['f-1']);
  });

  /**
   * The same three-checkpoint snapshot as `at`, stamped the way `PatrolRunner`
   * stamps a leg: `startedAt` the moment it goes `running`, `finishedAt` when it
   * settles. `at` leaves both off, which is enough for the clauses that only
   * count statuses — but the clause the pair of tests below pins reads the STAMP,
   * so they need legs shaped the way the wire really carries them.
   */
  const stamped = (runId: string, ...statuses: PatrolLeg['status'][]): PatrolRun => {
    const base = at(runId, ...statuses);
    return {
      ...base,
      legs: base.legs.map((l) => {
        if (l.status === 'pending') return l;
        const started: PatrolLeg = { ...l, startedAt: `2026-08-16T01:0${l.index * 2}:00.000Z` };
        if (l.status === 'running') return started;
        return { ...started, finishedAt: `2026-08-16T01:0${l.index * 2 + 1}:00.000Z` };
      }),
    };
  };

  /**
   * The reordering window the extra event opens, and the clause that closes it.
   *
   * `settle(leg i-1)` and `start(leg i)` leave the runner a few lines apart and
   * are pushed fire-and-forget over separate connections, and every ORIGINAL
   * clause of `isRunDowngrade` reads them as equals: the same SETTLED leg count
   * (`running` is not settled), the same finding count, the same status, neither
   * carrying `finishedAt`. Delivered the wrong way round the stale settle
   * therefore landed on top of the start, reverting checkpoint i to `pending`
   * and dropping its `startedAt` — leaving the rail with nothing to pulse and
   * the banner with nothing to name for the whole of that leg, which is the
   * defect TASK-222 exists to remove. Before this task the pair could not occur
   * at all: consecutive settles are minutes apart.
   *
   * `startedLegCount` is what separates them. `startedAt` is stamped once and
   * never cleared, so it only grows within a run: the start snapshot has begun
   * two legs, the settle before it only one, and the older one is refused.
   */
  it('a settle that overtakes the next leg-start is refused, so the leg keeps its start', () => {
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', stamped('pls-6', 'pending', 'pending', 'pending')));
    // Emitted second, delivered first: checkpoint 1 has begun.
    store.applyEvent(event('agent:patrol:leg', stamped('pls-6', 'done', 'running', 'pending')));
    // Emitted first, delivered second: the settle of checkpoint 0, now the older snapshot.
    store.applyEvent(event('agent:patrol:leg', stamped('pls-6', 'done', 'pending', 'pending')));

    const stored = usePatrolStore.getState().runsById['pls-6'];
    expect(stored.legs.map((l) => l.status)).toEqual(['done', 'running', 'pending']);
    expect(stored.legs[1].startedAt).toBe('2026-08-16T01:02:00.000Z');
    expect(selectActiveRuns(usePatrolStore.getState())[0].legs.find((l) => l.status === 'running')?.index).toBe(1);
  });

  it('in-order delivery of that same pair still applies both snapshots', () => {
    // The other half of the clause, and the one a blunt guard would break: a
    // settle arriving BEFORE the next start is the newer snapshot of the two and
    // must go in. Both have begun one leg, and equal is not fewer.
    const store = usePatrolStore.getState();
    store.applyEvent(event('agent:patrol:started', stamped('pls-7', 'pending', 'pending', 'pending')));
    store.applyEvent(event('agent:patrol:leg', stamped('pls-7', 'running', 'pending', 'pending')));
    store.applyEvent(event('agent:patrol:leg', stamped('pls-7', 'done', 'pending', 'pending')));
    store.applyEvent(event('agent:patrol:leg', stamped('pls-7', 'done', 'running', 'pending')));

    const stored = usePatrolStore.getState().runsById['pls-7'];
    expect(stored.legs.map((l) => l.status)).toEqual(['done', 'running', 'pending']);
    expect(stored.legs[0].finishedAt).toBe('2026-08-16T01:01:00.000Z');
    expect(stored.legs[1].startedAt).toBe('2026-08-16T01:02:00.000Z');
    expect(selectActiveRuns(usePatrolStore.getState())[0].legs.find((l) => l.status === 'running')?.index).toBe(1);
  });
});

describe('patrolStore fetch ordering', () => {
  it('a fetchRuns already in flight does not delete the run the operator just started', async () => {
    // The page polls every 30 s. Pressing "Patrol now" in the gap between a poll
    // going out and its answer coming back used to make the live rail and the
    // Abort button disappear while the robot was walking the route.
    let deliver: (runs: PatrolRun[]) => void = () => {};
    api.listRuns.mockReturnValue(new Promise<PatrolRun[]>((resolve) => { deliver = resolve; }));
    const inFlight = usePatrolStore.getState().fetchRuns();

    usePatrolStore.getState().applyEvent(event('agent:patrol:started', run({ runId: 'run-fresh' })));
    deliver([run({ runId: 'run-old', status: 'done', startedAt: '2026-08-16T00:00:00.000Z', finishedAt: '2026-08-16T00:30:00.000Z' })]);
    await inFlight;

    expect(usePatrolStore.getState().activeRunByRobot.g1?.runId).toBe('run-fresh');
    expect(selectActiveRuns(usePatrolStore.getState())).toHaveLength(1);

    // …and the guard is about ordering only: the next poll, issued after the run
    // was adopted, still clears a run the server no longer knows anything about.
    api.listRuns.mockResolvedValue([]);
    await usePatrolStore.getState().fetchRuns();
    expect(usePatrolStore.getState().activeRunByRobot.g1).toBeUndefined();
  });

  it('a poll that lands with an older row than the live events does not walk the run backwards', async () => {
    usePatrolStore.getState().applyEvent(
      event('agent:patrol:finished', run({
        status: 'done',
        finishedAt: '2026-08-16T01:10:00.000Z',
        legs: [{ ...run().legs[0], status: 'done' }, { ...run().legs[1], status: 'done' }],
      }))
    );
    api.listRuns.mockResolvedValue([run()]);
    await usePatrolStore.getState().fetchRuns();

    const s = usePatrolStore.getState();
    expect(s.runsById['run-1'].status).toBe('done');
    expect(s.runs[0].status).toBe('done');
    expect(s.activeRunByRobot.g1).toBeUndefined();

    // fetchRun keeps the findings it reads even when it declines the stale row.
    api.getRun.mockResolvedValue({ ...run(), findings: [finding()] });
    const detail = await usePatrolStore.getState().fetchRun('run-1');
    expect(detail?.status).toBe('done');
    expect(usePatrolStore.getState().findingsByRun['run-1']).toHaveLength(1);
    expect(usePatrolStore.getState().activeRunByRobot.g1).toBeUndefined();
  });
});
