/**
 * @file tourStore.test.ts
 * @description Store reducers/actions for host mode (TASK-213): live
 *              `agent:tour:*` events fold into runs, a turn appends to the
 *              transcript of the run in flight, and a late/out-of-order event
 *              can neither resurrect a finished tour nor shorten a transcript.
 * @feature tour
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTourStore, selectActiveRuns, selectRunById } from '../tourStore';
import { currentLeg } from '../../utils/tourFormat';
import { tourApi } from '../../api/tourApi';
import type { AgentModeEvent, TourLeg, TourRun, TourTurn } from '../../types/tour.types';

vi.mock('../../api/tourApi', () => ({
  tourApi: {
    listRoutes: vi.fn(),
    getRoute: vi.fn(),
    createRoute: vi.fn(),
    updateRoute: vi.fn(),
    deleteRoute: vi.fn(),
    startRoute: vi.fn(),
    abortRoute: vi.fn(),
    listRuns: vi.fn(),
    getRun: vi.fn(),
    listPlaces: vi.fn(),
    listSkills: vi.fn(),
  },
}));

const api = vi.mocked(tourApi);

const turn = (over: Partial<TourTurn> = {}): TourTurn => ({
  at: '2026-08-17T10:02:00.000Z',
  stopId: 'stop-a',
  question: 'Wie viel hat der Roboter gekostet?',
  answer: 'Das weiß ich nicht.',
  answered: 'declined',
  language: 'de',
  ...over,
});

const run = (over: Partial<TourRun> = {}): TourRun => ({
  runId: 'run-1',
  routeId: 'route-1',
  routeName: 'ZeMA visitor tour',
  robotId: 'g1',
  origin: 'visitor',
  status: 'running',
  startedAt: '2026-08-17T10:00:00.000Z',
  legs: [
    { index: 0, stopId: 'stop-a', placeId: 'STAGING', name: 'Reception', status: 'running' },
    { index: 1, stopId: 'stop-b', placeId: 'AISLE-1', name: 'Workstation', status: 'pending' },
  ],
  turns: [],
  language: 'de',
  disclosureSpoken: true,
  ...over,
});

const event = (type: AgentModeEvent['type'], tour?: TourRun, t?: TourTurn): AgentModeEvent => ({
  type,
  robotId: 'g1',
  tour,
  turn: t,
  timestamp: '2026-08-17T10:00:00.000Z',
});

beforeEach(() => {
  useTourStore.getState().reset();
  vi.clearAllMocks();
});

describe('tourStore.applyEvent', () => {
  it('a started tour becomes the robot’s active run and heads the list', () => {
    useTourStore.getState().applyEvent(event('agent:tour:started', run()));
    const s = useTourStore.getState();
    expect(s.activeRunByRobot.g1?.runId).toBe('run-1');
    expect(s.runs.map((r) => r.runId)).toEqual(['run-1']);
    expect(selectActiveRuns(s)).toHaveLength(1);
  });

  it('a leg event replaces the run in place instead of duplicating it', () => {
    useTourStore.getState().applyEvent(event('agent:tour:started', run()));
    useTourStore.getState().applyEvent(
      event('agent:tour:leg', run({ legs: [{ ...run().legs[0], status: 'done' }, run().legs[1]] }))
    );
    const s = useTourStore.getState();
    expect(s.runs).toHaveLength(1);
    expect(s.runsById['run-1'].legs[0].status).toBe('done');
  });

  it('a declined offer is a finished tour, not an active one', () => {
    // The most common outcome of a good greeting: it must leave the banner.
    useTourStore.getState().applyEvent(event('agent:tour:started', run()));
    useTourStore
      .getState()
      .applyEvent(event('agent:tour:finished', run({ status: 'declined', reason: 'the visitor said no', finishedAt: '2026-08-17T10:00:20.000Z' })));
    const s = useTourStore.getState();
    expect(s.activeRunByRobot.g1).toBeUndefined();
    expect(selectActiveRuns(s)).toHaveLength(0);
    expect(s.runsById['run-1'].status).toBe('declined');
  });

  it('a turn appends to the transcript of the run in flight', () => {
    useTourStore.getState().applyEvent(event('agent:tour:started', run()));
    useTourStore.getState().applyEvent(event('agent:tour:turn', run(), turn()));
    const s = useTourStore.getState();
    expect(s.runsById['run-1'].turns).toHaveLength(1);
    expect(s.runsById['run-1'].turns[0].answered).toBe('declined');
    // The same turn re-sent with the next snapshot must not double it.
    useTourStore.getState().applyEvent(event('agent:tour:turn', run({ turns: [turn()] }), turn()));
    expect(useTourStore.getState().runsById['run-1'].turns).toHaveLength(1);
    // …and the banner/list see the same object, not a stale copy.
    expect(selectActiveRuns(useTourStore.getState())[0].turns).toHaveLength(1);
    expect(useTourStore.getState().runs[0].turns).toHaveLength(1);
  });

  it('a turn with no run snapshot still lands on the active run', () => {
    useTourStore.getState().applyEvent(event('agent:tour:started', run()));
    useTourStore.getState().applyEvent(event('agent:tour:turn', undefined, turn({ answered: 'grounded' })));
    expect(useTourStore.getState().runsById['run-1'].turns).toHaveLength(1);
  });

  it('a late leg event never resurrects a tour that already finished', () => {
    // Every event carries the whole run, the robot pushes them fire-and-forget
    // and the server broadcasts them raw, so the leg that preceded `finished`
    // can land after it.
    const finished = run({
      status: 'done',
      finishedAt: '2026-08-17T10:08:00.000Z',
      legs: run().legs.map((l) => ({ ...l, status: 'done' as const })),
      turns: [turn()],
    });
    useTourStore.getState().applyEvent(event('agent:tour:started', run()));
    useTourStore.getState().applyEvent(event('agent:tour:finished', finished));
    useTourStore.getState().applyEvent(event('agent:tour:leg', run()));

    const s = useTourStore.getState();
    expect(s.runsById['run-1'].status).toBe('done');
    expect(s.runsById['run-1'].finishedAt).toBe('2026-08-17T10:08:00.000Z');
    expect(s.runsById['run-1'].legs[1].status).toBe('done');
    expect(s.activeRunByRobot.g1).toBeUndefined();
    expect(selectActiveRuns(s)).toHaveLength(0);
  });

  it('a late snapshot never shortens the transcript, but its own turn is still kept', () => {
    // The transcript only grows during a run — a snapshot with fewer turns is
    // by definition older, and applying it deleted questions off the screen.
    useTourStore.getState().applyEvent(event('agent:tour:started', run()));
    useTourStore.getState().applyEvent(event('agent:tour:turn', run({ turns: [turn()] }), turn()));
    const second = turn({ at: '2026-08-17T10:04:00.000Z', question: 'Wie schnell läuft er?', answered: 'grounded' });
    useTourStore.getState().applyEvent(event('agent:tour:turn', run({ turns: [] }), second));

    const stored = useTourStore.getState().runsById['run-1'];
    expect(stored.turns.map((t) => t.question)).toEqual([turn().question, second.question]);
  });

  it('ignores events that are not about a tour', () => {
    useTourStore.getState().applyEvent({ type: 'agent:scene:updated', robotId: 'g1', timestamp: 'now' });
    expect(useTourStore.getState().runs).toHaveLength(0);
  });
});

describe('tourStore leg-start events (TASK-222)', () => {
  // The robot now emits `agent:tour:leg` when a leg STARTS as well as when it
  // settles (`TourRunner.drive` in robot-agent/src/agent-mode/host.ts). Before
  // that every snapshot the store folded in read "0..i done, i+1..n pending" —
  // no leg was ever `running`, so the banner could not name the stop and the
  // stepper never highlighted it. These pin the guard's arithmetic against the
  // new event: the extra emit must land, and its late twin must not.

  /** A three-stop route as one status per stop, under a run id of its own. */
  const at = (runId: string, ...statuses: TourLeg['status'][]): TourRun =>
    run({
      runId,
      legs: statuses.map((status, index) => ({
        index,
        stopId: `stop-${index}`,
        placeId: `PLACE-${index}`,
        name: `Stop ${index}`,
        status,
      })),
    });

  it('a leg-start event puts a running leg into the active run', () => {
    const store = useTourStore.getState();
    store.applyEvent(event('agent:tour:started', at('ls-1', 'pending', 'pending', 'pending')));
    // Between legs there is no stop to name — this is the fallback state.
    expect(currentLeg(selectActiveRuns(useTourStore.getState())[0])).toBeNull();

    store.applyEvent(event('agent:tour:leg', at('ls-1', 'running', 'pending', 'pending')));
    const active = selectActiveRuns(useTourStore.getState())[0];
    expect(active.legs[0].status).toBe('running');
    expect(currentLeg(active)?.index).toBe(0);
  });

  it('the start of the NEXT stop is accepted even though it settles nothing new', () => {
    // The whole fix rests on this: the guard rejects a snapshot reporting FEWER
    // settled legs, and a leg-start carries exactly as many as the settle just
    // before it (`running` is not settled). Equal is not fewer.
    const store = useTourStore.getState();
    store.applyEvent(event('agent:tour:started', at('ls-2', 'pending', 'pending', 'pending')));
    store.applyEvent(event('agent:tour:leg', at('ls-2', 'running', 'pending', 'pending')));
    store.applyEvent(event('agent:tour:leg', at('ls-2', 'done', 'pending', 'pending')));
    store.applyEvent(event('agent:tour:leg', at('ls-2', 'done', 'running', 'pending')));

    const stored = useTourStore.getState().runsById['ls-2'];
    expect(stored.legs.map((l) => l.status)).toEqual(['done', 'running', 'pending']);
    expect(currentLeg(stored)?.index).toBe(1);
  });

  it('a late leg-start never walks the run back to a stop the robot has left', () => {
    // The reverse ordering, and the one that matters: stop 2's start arriving
    // after stop 2 settled reports one settled leg fewer, so it is a downgrade.
    const store = useTourStore.getState();
    store.applyEvent(event('agent:tour:started', at('ls-3', 'pending', 'pending', 'pending')));
    store.applyEvent(event('agent:tour:leg', at('ls-3', 'done', 'running', 'pending')));
    store.applyEvent(event('agent:tour:leg', at('ls-3', 'done', 'done', 'pending')));
    store.applyEvent(event('agent:tour:leg', at('ls-3', 'done', 'running', 'pending')));

    const stored = useTourStore.getState().runsById['ls-3'];
    expect(stored.legs.map((l) => l.status)).toEqual(['done', 'done', 'pending']);
    expect(currentLeg(stored)).toBeNull();
  });

  it('a leg-start that predates a question does not delete the question', () => {
    // Tour's own clause: the transcript only grows, so a snapshot with fewer
    // turns is older. A visitor asking mid-leg is exactly when that leg's start
    // event is still in flight — and the turn's own snapshot already carries the
    // running leg, so rejecting the leg-start costs the banner nothing.
    const store = useTourStore.getState();
    store.applyEvent(event('agent:tour:started', at('ls-4', 'pending', 'pending', 'pending')));
    const midLeg = { ...at('ls-4', 'running', 'pending', 'pending'), turns: [turn()] };
    store.applyEvent(event('agent:tour:turn', midLeg, turn()));
    store.applyEvent(event('agent:tour:leg', at('ls-4', 'running', 'pending', 'pending')));

    const stored = useTourStore.getState().runsById['ls-4'];
    expect(stored.turns).toHaveLength(1);
    expect(stored.legs[0].status).toBe('running');
  });

  it('a leg-start arriving after the tour finished does not resurrect it', () => {
    const store = useTourStore.getState();
    store.applyEvent(event('agent:tour:started', at('ls-5', 'pending', 'pending', 'pending')));
    store.applyEvent(
      event('agent:tour:finished', {
        ...at('ls-5', 'done', 'done', 'done'),
        status: 'done',
        finishedAt: '2026-08-17T10:08:00.000Z',
      })
    );
    store.applyEvent(event('agent:tour:leg', at('ls-5', 'done', 'done', 'running')));

    const s = useTourStore.getState();
    expect(s.runsById['ls-5'].status).toBe('done');
    expect(s.runsById['ls-5'].legs[2].status).toBe('done');
    expect(s.activeRunByRobot.g1).toBeUndefined();
  });

  it('the banner’s selector sees pending → running, not only running → done', () => {
    // `selectActiveRuns` memoises on one character per leg status. `p` and `r`
    // differ, so the leg-start invalidates the cache and the banner re-renders
    // with the stop named; a read that changes nothing still returns the cache.
    const store = useTourStore.getState();
    store.applyEvent(event('agent:tour:started', at('ls-6', 'pending', 'pending', 'pending')));
    const before = selectActiveRuns(useTourStore.getState());
    expect(before).toBe(selectActiveRuns(useTourStore.getState()));

    store.applyEvent(event('agent:tour:leg', at('ls-6', 'running', 'pending', 'pending')));
    const after = selectActiveRuns(useTourStore.getState());
    expect(after).not.toBe(before);
    expect(after[0].legs[0].status).toBe('running');
    expect(selectActiveRuns(useTourStore.getState())).toBe(after);
  });

  /**
   * The same three-stop snapshot as `at`, stamped the way `TourRunner.drive`
   * stamps a leg: `startedAt` the moment it goes `running`, `finishedAt` when it
   * settles. `at` leaves both off, which is enough for the clauses that only
   * count statuses — but the clause the pair of tests below pins reads the STAMP,
   * so they need legs shaped the way the wire really carries them.
   */
  const stamped = (runId: string, ...statuses: TourLeg['status'][]): TourRun => {
    const base = at(runId, ...statuses);
    return {
      ...base,
      legs: base.legs.map((l) => {
        if (l.status === 'pending') return l;
        const started: TourLeg = { ...l, startedAt: `2026-08-17T10:0${l.index * 2}:00.000Z` };
        if (l.status === 'running') return started;
        return { ...started, finishedAt: `2026-08-17T10:0${l.index * 2 + 1}:00.000Z` };
      }),
    };
  };

  /**
   * The reordering window the extra event opens, and the clause that closes it.
   *
   * `settle(leg i-1)` and `start(leg i)` leave the runner a few lines apart and
   * are pushed fire-and-forget over separate connections, and every ORIGINAL
   * clause of `isProgressDowngrade` reads them as equals: the same SETTLED leg
   * count (`running` is not settled), the same status, neither carrying
   * `finishedAt`. Delivered the wrong way round the stale settle therefore
   * landed on top of the start, reverting leg i to `pending` and dropping its
   * `startedAt` — which put the banner back on its generic `· walking` fallback
   * for the whole of leg i, the exact defect TASK-222 exists to remove. Before
   * this task the pair could not occur at all: consecutive settles are minutes
   * apart.
   *
   * `startedLegCount` is what separates them. `startedAt` is stamped once and
   * never cleared, so it only grows within a run: the start snapshot has begun
   * two legs, the settle before it only one, and the older one is refused.
   */
  it('a settle that overtakes the next leg-start is refused, so the leg keeps its start', () => {
    const store = useTourStore.getState();
    store.applyEvent(event('agent:tour:started', stamped('ls-7', 'pending', 'pending', 'pending')));
    // Emitted second, delivered first: stop 1 has begun.
    store.applyEvent(event('agent:tour:leg', stamped('ls-7', 'done', 'running', 'pending')));
    // Emitted first, delivered second: the settle of stop 0, now the older snapshot.
    store.applyEvent(event('agent:tour:leg', stamped('ls-7', 'done', 'pending', 'pending')));

    const stored = useTourStore.getState().runsById['ls-7'];
    expect(stored.legs.map((l) => l.status)).toEqual(['done', 'running', 'pending']);
    expect(stored.legs[1].startedAt).toBe('2026-08-17T10:02:00.000Z');
    // …and the consequence the visitor's escort actually sees: the banner can
    // still name the stop the robot is standing at, rather than falling back.
    const active = selectActiveRuns(useTourStore.getState())[0];
    expect(currentLeg(active)?.index).toBe(1);
    expect(currentLeg(active)?.name).toBe('Stop 1');
  });

  it('in-order delivery of that same pair still applies both snapshots', () => {
    // The other half of the clause, and the one a blunt guard would break: a
    // settle arriving BEFORE the next start is the newer snapshot of the two and
    // must go in. Both have begun one leg, and equal is not fewer.
    const store = useTourStore.getState();
    store.applyEvent(event('agent:tour:started', stamped('ls-8', 'pending', 'pending', 'pending')));
    store.applyEvent(event('agent:tour:leg', stamped('ls-8', 'running', 'pending', 'pending')));
    store.applyEvent(event('agent:tour:leg', stamped('ls-8', 'done', 'pending', 'pending')));
    store.applyEvent(event('agent:tour:leg', stamped('ls-8', 'done', 'running', 'pending')));

    const stored = useTourStore.getState().runsById['ls-8'];
    expect(stored.legs.map((l) => l.status)).toEqual(['done', 'running', 'pending']);
    expect(stored.legs[0].finishedAt).toBe('2026-08-17T10:01:00.000Z');
    expect(stored.legs[1].startedAt).toBe('2026-08-17T10:02:00.000Z');
    expect(currentLeg(selectActiveRuns(useTourStore.getState())[0])?.index).toBe(1);
  });
});

describe('tourStore actions', () => {
  it('fetchRuns sorts newest first and seeds active/last per robot', async () => {
    api.listRuns.mockResolvedValue([
      run({ runId: 'old', status: 'done', startedAt: '2026-08-16T10:00:00.000Z' }),
      run({ runId: 'new', startedAt: '2026-08-17T10:00:00.000Z' }),
    ]);
    await useTourStore.getState().fetchRuns();
    const s = useTourStore.getState();
    expect(s.runs.map((r) => r.runId)).toEqual(['new', 'old']);
    expect(s.activeRunByRobot.g1?.runId).toBe('new');
    expect(s.runsStatus).toBe('ok');
  });

  it('an unfiltered fetchRuns drops active runs the server no longer lists', async () => {
    useTourStore.getState().applyEvent(event('agent:tour:started', run({ runId: 'ghost' })));
    api.listRuns.mockResolvedValue([run({ runId: 'other', robotId: 'h1', status: 'done' })]);
    await useTourStore.getState().fetchRuns();
    expect(useTourStore.getState().activeRunByRobot.g1).toBeUndefined();
  });

  it('fetchRun is authoritative — a swept transcript replaces the one events left behind', async () => {
    // The server is the source of record and the sweep legitimately REMOVES
    // turns, so the detail fetch must not be held back by the live-event guard.
    useTourStore.getState().applyEvent(event('agent:tour:turn', run({ turns: [turn()] }), turn()));
    api.getRun.mockResolvedValue(run({ status: 'done', finishedAt: '2026-08-17T10:08:00.000Z', turns: [] }));
    await useTourStore.getState().fetchRun('run-1');
    const s = useTourStore.getState();
    expect(selectRunById('run-1')(s)?.turns).toEqual([]);
    expect(s.runDetailStatus['run-1']).toBe('ok');
    expect(s.activeRunByRobot.g1).toBeUndefined();
  });

  it('a poll answer computed before the finish cannot re-raise the banner', async () => {
    // The list request and the socket race on separate connections. The answer
    // here was computed before "End tour" committed, so it still says running:
    // taking it put the live banner back over a dead Stop button.
    useTourStore.getState().applyEvent(event('agent:tour:started', run()));
    useTourStore.getState().applyEvent(event('agent:tour:finished', run({ status: 'done', finishedAt: '2026-08-17T10:08:00.000Z' })));
    api.listRuns.mockResolvedValue([run({ status: 'running' })]);
    await useTourStore.getState().fetchRuns();
    const s = useTourStore.getState();
    expect(selectRunById('run-1')(s)?.status).toBe('done');
    expect(s.activeRunByRobot.g1).toBeUndefined();
  });

  it('a run adopted while the poll was in flight survives the prune', async () => {
    // `fetchRuns` treats an unfiltered answer as authoritative about what ended.
    // A run that STARTED after the request went out is simply younger than the
    // answer; dropping it took the banner and the End-tour button away from a
    // tour the robot was actually walking.
    api.listRuns.mockImplementation(async () => {
      useTourStore.getState().applyEvent(event('agent:tour:started', run({ runId: 'run-2' })));
      return [];
    });
    await useTourStore.getState().fetchRuns();
    expect(useTourStore.getState().activeRunByRobot.g1?.runId).toBe('run-2');
  });

  it('a stale detail response cannot pin a finished run at “running”', async () => {
    useTourStore.getState().applyEvent(event('agent:tour:finished', run({ status: 'done', finishedAt: '2026-08-17T10:08:00.000Z', turns: [turn()] })));
    // Read before the finish committed — older on progress, and it also predates
    // nothing on the transcript, so only the progress half must be held back.
    api.getRun.mockResolvedValue(run({ status: 'running', turns: [turn()] }));
    await useTourStore.getState().fetchRun('run-1');
    const s = useTourStore.getState();
    expect(selectRunById('run-1')(s)?.status).toBe('done');
    expect(selectRunById('run-1')(s)?.finishedAt).toBe('2026-08-17T10:08:00.000Z');
    expect(s.activeRunByRobot.g1).toBeUndefined();
  });

  it('a refused start is a result, not an error', async () => {
    api.startRoute.mockResolvedValue({ accepted: false, reason: 'person_too_close', message: 'Please give me a little room and I will lead the way.' });
    const res = await useTourStore.getState().startRun('route-1', 'g1');
    expect(res?.accepted).toBe(false);
    expect(useTourStore.getState().lastStartResult?.reason).toBe('person_too_close');
    expect(useTourStore.getState().error).toBeNull();
    expect(api.startRoute).toHaveBeenCalledWith('route-1', 'g1');
  });

  it('an abort the robot refuses lands in `error` — the operator must not think the tour ended', async () => {
    api.abortRoute.mockResolvedValue({ ok: false });
    expect(await useTourStore.getState().abortRun('route-1', 'g1')).toBe(false);
    expect(useTourStore.getState().error).toMatch(/did not end the tour/i);
  });

  it('a failed request lands in `error` and does not throw', async () => {
    api.listRoutes.mockRejectedValue(new Error('boom'));
    await useTourStore.getState().fetchRoutes();
    expect(useTourStore.getState().routesStatus).toBe('error');
    expect(useTourStore.getState().routesError).toContain('boom');
  });

  it('a skill library that cannot be read leaves the editor usable', async () => {
    api.listSkills.mockRejectedValue(new Error('offline'));
    expect(await useTourStore.getState().fetchSkills()).toEqual([]);
    expect(useTourStore.getState().skillsStatus).toBe('error');
    expect(useTourStore.getState().error).toBeNull();
  });
});
