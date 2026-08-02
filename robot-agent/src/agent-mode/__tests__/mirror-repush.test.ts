/**
 * @file mirror-repush.test.ts
 * @description TASK-200 — a live robot re-asserts its state to the server
 *              mirror on a clock, so a snapshot left behind by a process that
 *              has DIED is superseded within one interval.
 *
 *              Observed defect: a duplicate robot-agent booted, pushed one
 *              `agent:state:changed`, died on EADDRINUSE — and the server's
 *              mirror served its incarnation, uptime and battery as the running
 *              robot's for over an hour, because the mirror only ever moves on
 *              a push and nobody pushed again.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentModeController, MIRROR_REPUSH_INTERVAL_MS } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { RangeSensor } from '../range.js';
import type { Planner } from '../planner.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';

const EMPTY_VIEW: VisionObservation = {
  currentView: 'ein leerer Raum',
  entities: [],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

/** Ticks fast on the REAL clock; the re-push gate runs on the fake one. */
const TICK_MS = 2;

function makeAgent(
  opts: { enabled?: boolean; onEmit?: () => void; startAtMs?: number } = {},
) {
  const clock = { ms: opts.startAtMs ?? 1_700_000_000_000 };
  const pushed: Array<{ type: string; hasState: boolean }> = [];
  /** The raw payloads, for the tests that care about WHAT was asserted. */
  const payloads: Array<{ type: string; state?: Record<string, unknown> }> = [];

  const mirror = {
    emit: (event: { type: string; state?: unknown }) => {
      pushed.push({ type: event.type, hasState: event.state !== undefined });
      payloads.push({
        type: event.type,
        ...(event.state === undefined ? {} : { state: event.state as Record<string, unknown> }),
      });
      opts.onEmit?.();
    },
    push: async () => {},
    logBlock: async () => {},
  } as unknown as ServerMirror;

  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: opts.enabled ?? true,
    lock: new ControlOwnerLock(),
    planner: { plan: async () => ({ blocks: [], fallback: false, attempts: 1 }) } as unknown as Planner,
    mirror,
    vision: { observe: async () => EMPTY_VIEW } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    // No disk: this test is about the clock, not about what the state contains.
    memory: null,
    journal: null,
    identity: null,
    lineage: () => [],
    loco: {
      move: async () => ({ ok: true }),
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    sleep: async () => {},
    idleWatchIntervalMs: TICK_MS,
    now: () => clock.ms,
  });

  return {
    controller,
    pushed,
    /** Only the periodic/state pushes, which is all this file cares about. */
    states: () => pushed.filter((p) => p.type === 'agent:state:changed'),
    /** The same pushes, with their payload attached. */
    statePayloads: () => payloads.filter((p) => p.type === 'agent:state:changed'),
    advance: (ms: number) => {
      clock.ms += ms;
    },
  };
}

/** A few real interval firings, to prove the gate — not the timer — decides. */
const manyTicks = () => new Promise((resolve) => setTimeout(resolve, TICK_MS * 12));

const live: Array<{ controller: AgentModeController }> = [];

afterEach(() => {
  while (live.length) live.pop()?.controller.stopIdleWatcher();
});

function start(agent: ReturnType<typeof makeAgent>) {
  live.push({ controller: agent.controller });
  agent.controller.startIdleWatcher();
  return agent;
}

describe('server-mirror re-push', () => {
  it('re-asserts the state once the interval has passed, and not on every tick', async () => {
    const agent = start(makeAgent());

    // The first eligible tick pushes immediately: until we have pushed once in
    // THIS process, a duplicate's snapshot may be sitting in the mirror.
    await vi.waitFor(() => expect(agent.states()).toHaveLength(1));

    // Many more ticks pass with the clock standing still — a 3 s heartbeat
    // would be pure noise, and the push carries a whole state.
    await manyTicks();
    expect(agent.states()).toHaveLength(1);

    agent.advance(MIRROR_REPUSH_INTERVAL_MS);
    await vi.waitFor(() => expect(agent.states()).toHaveLength(2));
    expect(agent.states()[1]).toEqual({ type: 'agent:state:changed', hasState: true });
  });

  it('does not push a second before the interval is up', async () => {
    const agent = start(makeAgent());
    await vi.waitFor(() => expect(agent.states()).toHaveLength(1));

    agent.advance(MIRROR_REPUSH_INTERVAL_MS - 1);
    await manyTicks();

    expect(agent.states()).toHaveLength(1);
  });

  it('re-asserts even with Agent Mode OFF', async () => {
    // A mode-off robot's mirror entry is exactly as capable of being a dead
    // process's leftover. The gate that stops the watcher LOOKING must not also
    // stop it correcting the record.
    const agent = start(makeAgent({ enabled: false }));

    await vi.waitFor(() => expect(agent.states()).toHaveLength(1));
    agent.advance(MIRROR_REPUSH_INTERVAL_MS);
    await vi.waitFor(() => expect(agent.states()).toHaveLength(2));
  });

  it('re-asserts while an E-Stop is latched', async () => {
    // The state the mirror is most often asked about, and the one the
    // eligibility gate skips.
    const agent = start(makeAgent());
    await vi.waitFor(() => expect(agent.states()).toHaveLength(1));

    await agent.controller.estop('operator pressed STOPP');
    const afterLatch = agent.states().length;

    agent.advance(MIRROR_REPUSH_INTERVAL_MS);
    await vi.waitFor(() => expect(agent.states().length).toBeGreaterThan(afterLatch));
    expect(agent.controller.getState().estopActive).toBe(true);
  });

  it('counts a real state change as the re-assertion it is', async () => {
    // Otherwise an active robot pushes twice for the same fact.
    const agent = start(makeAgent());
    await vi.waitFor(() => expect(agent.states()).toHaveLength(1));

    agent.advance(MIRROR_REPUSH_INTERVAL_MS - 1);
    agent.controller.announceBootState(); // a genuine push, at the same instant
    const after = agent.states().length;

    agent.advance(1); // the old deadline passes…
    await manyTicks();

    expect(agent.states()).toHaveLength(after);
  });

  it('re-asserts WITHOUT the plan or the scene, even while a plan exists', async () => {
    // The push is fire-and-forget and the server fans it out to every app
    // client, so a heartbeat snapshot taken at T can be ingested AFTER an event
    // emitted at T+ε. Carrying the plan is what let a `running` heartbeat
    // overtake `agent:plan:finished` and leave the timeline executing forever.
    const agent = start(makeAgent());
    await vi.waitFor(() => expect(agent.states()).toHaveLength(1));

    await agent.controller.submitCommand({ text: 'walk to the table' });
    await vi.waitFor(() => expect(agent.controller.isRunning()).toBe(false));
    expect(agent.controller.getState().plan).not.toBeNull();

    const before = agent.statePayloads().length;
    agent.advance(MIRROR_REPUSH_INTERVAL_MS);
    await vi.waitFor(() => expect(agent.statePayloads().length).toBeGreaterThan(before));

    const state = agent.statePayloads().at(-1)?.state ?? {};
    // Absent, not null: `null` is a claim ("there is no plan"), absence is the
    // silence a heartbeat is entitled to.
    expect('plan' in state).toBe(false);
    expect('scene' in state).toBe(false);
    // Everything the re-assertion DOES exist to date still rides along.
    expect(state).toMatchObject({ robotId: 'robot-1', enabled: true, estopActive: false });
    expect(state.controlOwner).toBeDefined();
  });

  it('carries the plan and the scene on a real state change', async () => {
    const agent = start(makeAgent());
    await vi.waitFor(() => expect(agent.states()).toHaveLength(1));

    agent.advance(MIRROR_REPUSH_INTERVAL_MS);
    agent.controller.announceBootState();

    const state = agent.statePayloads().at(-1)?.state ?? {};
    expect('plan' in state).toBe(true);
    expect('scene' in state).toBe(true);
  });

  it('is fire-and-forget: a failing mirror never throws into the tick', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const agent = start(
      makeAgent({
        onEmit: () => {
          calls += 1;
          throw new Error('server down');
        },
      }),
    );

    await vi.waitFor(() => expect(calls).toBe(1));

    // The watcher is still ticking and still trying — a dead server must not
    // silently stop the robot from correcting the mirror once it comes back.
    agent.advance(MIRROR_REPUSH_INTERVAL_MS);
    await vi.waitFor(() => expect(calls).toBe(2));
    expect(agent.controller.isRunning()).toBe(false);
    warn.mockRestore();
  });
});
