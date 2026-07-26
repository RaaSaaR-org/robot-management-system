/**
 * @file agentmodeStore.test.ts
 * @description Tests for the Agent Mode store — the WebSocket reducer, the
 *              E-Stop latch and the current/upcoming block selectors.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useAgentModeStore,
  selectCurrentBlock,
  selectUpcomingBlocks,
  selectEstopActive,
  selectEstopStatus,
  selectEstopError,
  selectPlan,
  selectPlanById,
  selectSceneEntities,
  selectMessages,
} from '../agentmodeStore';
import type {
  AgentBlock,
  AgentBlockStatus,
  AgentCommandResponse,
  AgentEstopResponse,
  AgentModeEvent,
  AgentModeState,
  AgentPlan,
  SceneMemory,
} from '../../types/agentmode.types';

// Mock the api boundary the store imports
vi.mock('../../api/agentmodeApi', () => ({
  agentmodeApi: {
    getState: vi.fn(),
    getScene: vi.fn(),
    sendCommand: vi.fn(),
    toggle: vi.fn(),
    estop: vi.fn(),
    resetEstop: vi.fn(),
  },
}));

import { agentmodeApi } from '../../api/agentmodeApi';

const mockedApi = vi.mocked(agentmodeApi);

const ROBOT_ID = 'demo-g1-001';
const TS = '2026-07-25T10:00:00.000Z';

// -- Factories ---------------------------------------------------------------

const makeBlock = (overrides: Partial<AgentBlock> = {}): AgentBlock => ({
  id: 'b1',
  kind: 'walk',
  params: { distanceM: 1, direction: 'forward' },
  status: 'pending',
  ...overrides,
});

const makePlan = (overrides: Partial<AgentPlan> = {}): AgentPlan => ({
  id: 'plan-1',
  robotId: ROBOT_ID,
  command: 'walk to the table with the hat',
  blocks: [
    makeBlock({ id: 'b1', kind: 'scan_room', params: { steps: 8 } }),
    makeBlock({ id: 'b2', kind: 'turn', params: { angleDeg: -34 } }),
    makeBlock({ id: 'b3', kind: 'walk', params: { distanceM: 2, direction: 'forward' } }),
  ],
  cursor: -1,
  status: 'running',
  createdAt: TS,
  updatedAt: TS,
  ...overrides,
});

const makeScene = (overrides: Partial<SceneMemory> = {}): SceneMemory => ({
  robotId: ROBOT_ID,
  currentView: 'A table ahead.',
  personVisible: false,
  updatedAt: TS,
  entities: [
    { label: 'table', bearingDeg: -34, distanceEstM: 3.4, confidence: 0.9, lastSeen: TS },
  ],
  ...overrides,
});

/**
 * The plan the navigator produces when it splices generated blocks into a
 * single `goto` — the shape the robot-agent puts on the block event's `plan`
 * field. It never sends an `agent:plan:updated` for this.
 */
const makeSplicedPlan = (overrides: Partial<AgentPlan> = {}): AgentPlan =>
  makePlan({
    ...overrides,
    blocks: [
      makeBlock({ id: 'g1', kind: 'goto', params: { target: 'table' }, status: 'running' }),
      makeBlock({ id: 'g1-nav-1', kind: 'look', params: {} }),
      makeBlock({ id: 'g1-nav-2', kind: 'turn', params: { angleDeg: -34 } }),
      makeBlock({ id: 'g1-nav-3', kind: 'walk', params: { distanceM: 1.2 } }),
    ],
  });

/** The plan as the planner first emitted it: one `goto`, nothing else. */
const makeGotoPlan = (): AgentPlan =>
  makePlan({
    blocks: [makeBlock({ id: 'g1', kind: 'goto', params: { target: 'table' } })],
  });

/** The api client rejects with a plain object, never an `Error`. */
const apiError = (statusCode: number, message: string, code = 'ERR') => ({
  code,
  message,
  statusCode,
});

const makeState = (overrides: Partial<AgentModeState> = {}): AgentModeState => ({
  robotId: ROBOT_ID,
  enabled: true,
  controlOwner: 'idle',
  plan: null,
  scene: null,
  estopActive: false,
  ...overrides,
});

const event = (e: Partial<AgentModeEvent> & Pick<AgentModeEvent, 'type'>): AgentModeEvent => ({
  robotId: ROBOT_ID,
  timestamp: TS,
  ...e,
});

const apply = (e: AgentModeEvent) => useAgentModeStore.getState().applyEvent(e);

const statuses = (): AgentBlockStatus[] =>
  (useAgentModeStore.getState().plan?.blocks ?? []).map((b) => b.status);

/** Newest chat message (Array.prototype.at is outside the app's target lib). */
const lastMessage = (state: ReturnType<typeof useAgentModeStore.getState>) => {
  const messages = selectMessages(state);
  return messages.length > 0 ? messages[messages.length - 1] : undefined;
};

beforeEach(() => {
  useAgentModeStore.getState().reset();
  useAgentModeStore.setState({ robotId: ROBOT_ID });
  vi.clearAllMocks();
});

describe('agentmodeStore', () => {
  it('starts with initial state', () => {
    useAgentModeStore.getState().reset();
    const s = useAgentModeStore.getState();
    expect(s.robotId).toBeNull();
    expect(s.enabled).toBe(false);
    expect(s.controlOwner).toBe('idle');
    expect(s.estopActive).toBe(false);
    expect(s.estopStatus).toBe('idle');
    expect(s.estopError).toBeNull();
    expect(s.damped).toBe(false);
    expect(s.fsmId).toBeNull();
    expect(s.plan).toBeNull();
    expect(s.planHistory).toEqual([]);
    expect(s.scene).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.pendingCommand).toBeNull();
    expect(s.connectionStatus).toBe('disconnected');
    expect(s.error).toBeNull();
  });

  // -- applyEvent ------------------------------------------------------------

  describe('applyEvent', () => {
    it('agent:plan:started installs the plan and takes control', () => {
      const plan = makePlan();

      apply(event({ type: 'agent:plan:started', plan }));

      const s = useAgentModeStore.getState();
      expect(s.plan?.id).toBe('plan-1');
      expect(s.controlOwner).toBe('agent');
      expect(statuses()).toEqual(['pending', 'pending', 'pending']);
    });

    it('agent:plan:started pushes a superseded plan into the history', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan({ id: 'plan-1' }) }));
      apply(event({ type: 'agent:plan:started', plan: makePlan({ id: 'plan-2' }) }));

      const s = useAgentModeStore.getState();
      expect(s.plan?.id).toBe('plan-2');
      expect(s.planHistory.map((p) => p.id)).toEqual(['plan-1']);
      expect(selectPlanById('plan-1')(s)?.id).toBe('plan-1');
      expect(selectPlanById('plan-2')(s)?.id).toBe('plan-2');
      expect(selectPlanById('nope')(s)).toBeNull();
    });

    it('agent:plan:updated replaces the matching plan', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      const rewritten = makePlan({
        blocks: [makeBlock({ id: 'b1', kind: 'speak', params: { text: 'ok' } })],
        updatedAt: '2026-07-25T10:00:05.000Z',
      });
      apply(event({ type: 'agent:plan:updated', plan: rewritten }));

      const s = useAgentModeStore.getState();
      expect(s.plan?.blocks).toHaveLength(1);
      expect(s.plan?.blocks[0].kind).toBe('speak');
    });

    it('agent:block:started marks the block running and moves the cursor', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      apply(
        event({
          type: 'agent:block:started',
          block: makeBlock({ id: 'b2', status: 'running', startedAt: TS }),
        })
      );

      const s = useAgentModeStore.getState();
      expect(s.plan?.cursor).toBe(1);
      expect(s.plan?.status).toBe('running');
      expect(s.plan?.blocks[1].status).toBe('running');
      expect(s.plan?.blocks[1].startedAt).toBe(TS);
    });

    it('agent:block:finished records the result and clears the cursor', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b1', status: 'running' }) })
      );

      apply(
        event({
          type: 'agent:block:finished',
          block: makeBlock({
            id: 'b1',
            status: 'done',
            finishedAt: TS,
            result: 'Found 4 entities.',
          }),
        })
      );

      const s = useAgentModeStore.getState();
      expect(s.plan?.blocks[0].status).toBe('done');
      expect(s.plan?.blocks[0].result).toBe('Found 4 entities.');
      expect(s.plan?.cursor).toBe(-1);
    });

    it('agent:block:* for an unknown block id and no plan in the envelope is ignored', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      apply(event({ type: 'agent:block:started', block: makeBlock({ id: 'nope' }) }));

      expect(statuses()).toEqual(['pending', 'pending', 'pending']);
      expect(useAgentModeStore.getState().plan?.cursor).toBe(-1);
    });

    it('agent:block:started adopts the spliced plan the event carries', () => {
      // The navigator splices its look/turn/walk blocks into the live `goto`
      // and the agent never emits `agent:plan:updated` for it — the new plan
      // only ever arrives on the block event itself.
      apply(event({ type: 'agent:plan:started', plan: makeGotoPlan() }));
      expect(useAgentModeStore.getState().plan?.blocks).toHaveLength(1);

      apply(
        event({
          type: 'agent:block:started',
          plan: makeSplicedPlan(),
          block: makeBlock({ id: 'g1-nav-1', kind: 'look', params: {}, status: 'running' }),
        })
      );

      const s = useAgentModeStore.getState();
      expect(s.plan?.blocks.map((b) => b.id)).toEqual(['g1', 'g1-nav-1', 'g1-nav-2', 'g1-nav-3']);
      expect(s.plan?.blocks[1].status).toBe('running');
      expect(s.plan?.cursor).toBe(1);
      // The `goto` stays `running` around its generated blocks — the cursor is
      // what says which one the robot is actually executing.
      expect(selectCurrentBlock(s)?.id).toBe('g1-nav-1');
      expect(selectUpcomingBlocks(s).map((b) => b.id)).toEqual(['g1-nav-2', 'g1-nav-3']);
    });

    it('agent:block:finished records a generated block result from the event plan', () => {
      apply(event({ type: 'agent:plan:started', plan: makeGotoPlan() }));

      apply(
        event({
          type: 'agent:block:finished',
          plan: makeSplicedPlan(),
          block: makeBlock({
            id: 'g1-nav-3',
            kind: 'walk',
            params: { distanceM: 1.2 },
            status: 'done',
            result: 'Advanced 1.2 m; 0.4 m remaining by odometry.',
          }),
        })
      );

      const s = useAgentModeStore.getState();
      expect(s.plan?.blocks).toHaveLength(4);
      expect(s.plan?.blocks[3].status).toBe('done');
      expect(s.plan?.blocks[3].result).toBe('Advanced 1.2 m; 0.4 m remaining by odometry.');
    });

    it('a block event adopts the plan when the client joined mid-run', () => {
      apply(
        event({
          type: 'agent:block:started',
          plan: makeSplicedPlan(),
          block: makeBlock({ id: 'g1-nav-2', kind: 'turn', status: 'running' }),
        })
      );

      const s = useAgentModeStore.getState();
      expect(s.plan?.id).toBe('plan-1');
      expect(s.plan?.cursor).toBe(2);
    });

    it('a block event for a different plan is ignored', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      apply(
        event({
          type: 'agent:block:started',
          plan: makeSplicedPlan({ id: 'plan-other' }),
          block: makeBlock({ id: 'g1-nav-1', status: 'running' }),
        })
      );

      const s = useAgentModeStore.getState();
      expect(s.plan?.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    });

    it('agent:plan:finished stores the terminal plan and appends a summary', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      const finished = makePlan({
        status: 'done',
        cursor: -1,
        blocks: makePlan().blocks.map((b) => ({ ...b, status: 'done' as AgentBlockStatus })),
      });
      apply(event({ type: 'agent:plan:finished', plan: finished }));

      const s = useAgentModeStore.getState();
      expect(s.plan?.status).toBe('done');
      expect(s.controlOwner).toBe('idle');
      const last = lastMessage(s);
      expect(last?.role).toBe('agent');
      expect(last?.text).toContain('3/3');
    });

    it('agent:scene:updated replaces the scene memory', () => {
      apply(event({ type: 'agent:scene:updated', scene: makeScene() }));

      const s = useAgentModeStore.getState();
      expect(s.scene?.currentView).toBe('A table ahead.');
      expect(selectSceneEntities(s).map((e) => e.label)).toEqual(['table']);
    });

    it('agent:state:changed applies mode, owner and E-Stop latch', () => {
      apply(
        event({
          type: 'agent:state:changed',
          state: makeState({ enabled: true, controlOwner: 'teleop', estopActive: true }),
        })
      );

      const s = useAgentModeStore.getState();
      expect(s.enabled).toBe(true);
      expect(s.controlOwner).toBe('teleop');
      expect(selectEstopActive(s)).toBe(true);
    });

    it('ignores events for a different robot', () => {
      apply(event({ type: 'agent:plan:started', robotId: 'other-robot', plan: makePlan() }));
      expect(selectPlan(useAgentModeStore.getState())).toBeNull();
    });

    it('ignores plan/block progress once the agent acknowledged an E-Stop', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      useAgentModeStore.setState({ estopActive: true, estopStatus: 'acknowledged' });

      apply(event({ type: 'agent:block:started', block: makeBlock({ id: 'b1' }) }));
      apply(event({ type: 'agent:plan:started', plan: makePlan({ id: 'plan-9' }) }));

      const s = useAgentModeStore.getState();
      expect(s.plan?.id).toBe('plan-1');
      expect(statuses()).toEqual(['pending', 'pending', 'pending']);
    });
  });

  // -- E-Stop ----------------------------------------------------------------

  describe('estop', () => {
    it('reports "requested" and leaves the plan alone until the agent answers', async () => {
      // The POST has not even left the browser yet — claiming the plan was
      // aborted here presents an unverified stop as a completed one.
      let release: (value: AgentEstopResponse) => void = () => {};
      mockedApi.estop.mockReturnValue(
        new Promise<AgentEstopResponse>((resolve) => {
          release = resolve;
        })
      );
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b1', status: 'running' }) })
      );

      const inFlight = useAgentModeStore.getState().estop(ROBOT_ID, 'Operator pressed STOPP');

      const pending = useAgentModeStore.getState();
      expect(selectEstopActive(pending)).toBe(true);
      expect(selectEstopStatus(pending)).toBe('requesting');
      expect(pending.plan?.status).toBe('running');
      expect(statuses()).toEqual(['running', 'pending', 'pending']);
      expect(lastMessage(pending)?.text).toContain('requested');
      expect(lastMessage(pending)?.text).not.toContain('aborted');

      release({ ok: true, stopped: true, delivered: true });
      await inFlight;

      expect(selectEstopStatus(useAgentModeStore.getState())).toBe('acknowledged');
    });

    it('marks pending blocks skipped, the running block aborted and the plan aborted', async () => {
      // `delivered: true` — the hardware confirmed, so the clean messaging holds.
      mockedApi.estop.mockResolvedValue({ ok: true, stopped: true, delivered: true });
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:finished', block: makeBlock({ id: 'b1', status: 'done' }) })
      );
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b2', status: 'running' }) })
      );
      useAgentModeStore.setState({
        pendingCommand: { planId: 'plan-1', text: 'walk to the table', robotId: ROBOT_ID },
      });

      await useAgentModeStore.getState().estop(ROBOT_ID, 'Operator pressed STOPP');

      const s = useAgentModeStore.getState();
      // Completed blocks are frozen; the running one aborts, the rest skip.
      expect(statuses()).toEqual(['done', 'aborted', 'skipped']);
      expect(s.plan?.status).toBe('aborted');
      expect(s.plan?.cursor).toBe(-1);
      expect(s.estopActive).toBe(true);
      expect(s.controlOwner).toBe('idle');
      expect(s.pendingCommand).toBeNull();
      expect(selectEstopStatus(s)).toBe('acknowledged');
      expect(mockedApi.estop).toHaveBeenCalledWith(ROBOT_ID, 'Operator pressed STOPP');
      expect(lastMessage(s)?.text).toContain('E-Stop confirmed');
    });

    it('reports a stop the hardware did not confirm as unconfirmed, never as clean', async () => {
      // `delivered: false` — the latch and the plan abort are software-side
      // only; StopMove/Damp were not acked. The robot may still be moving and
      // the console must say exactly that instead of "stopped and damped".
      mockedApi.estop.mockResolvedValue({
        ok: true,
        stopped: true,
        delivered: false,
        deliveryError: 'Damp rejected by sidecar',
      });
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b1', status: 'running' }) })
      );

      await useAgentModeStore.getState().estop(ROBOT_ID, 'Operator pressed STOPP');

      const s = useAgentModeStore.getState();
      // The software latch is real — commands stay refused …
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).toBe('unconfirmed');
      expect(selectEstopError(s)).toBe('Damp rejected by sidecar');
      // … the software abort is real too …
      expect(statuses()).toEqual(['aborted', 'skipped', 'skipped']);
      // … but the console must not present it as a clean stop.
      expect(lastMessage(s)?.text).toContain('NOT CONFIRMED');
      expect(lastMessage(s)?.text).toContain('Damp rejected by sidecar');
      expect(lastMessage(s)?.text).not.toContain('stopped and damped');
    });

    it('delivered:false without a deliveryError still warns', async () => {
      mockedApi.estop.mockResolvedValue({ ok: true, stopped: false, delivered: false });

      await useAgentModeStore.getState().estop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectEstopStatus(s)).toBe('unconfirmed');
      expect(selectEstopError(s)).toBeNull();
      expect(lastMessage(s)?.text).toContain('NOT CONFIRMED');
      expect(lastMessage(s)?.text).toContain('may still be moving');
    });

    it('a reported latch does not upgrade an unconfirmed stop to a clean one', async () => {
      // The agent broadcasts `estopActive: true` right after latching — the
      // software claim we already hold. It says nothing about delivery and
      // must not wash the warning out into "stopped and damped".
      mockedApi.estop.mockResolvedValue({
        ok: true,
        stopped: false,
        delivered: false,
        deliveryError: 'StopMove timeout',
      });
      await useAgentModeStore.getState().estop(ROBOT_ID);

      apply(event({ type: 'agent:state:changed', state: makeState({ estopActive: true }) }));

      const s = useAgentModeStore.getState();
      expect(selectEstopStatus(s)).toBe('unconfirmed');
      expect(selectEstopError(s)).toBe('StopMove timeout');
    });

    it('keeps applying block events while the stop is hardware-unconfirmed', async () => {
      // Events that still arrive are the evidence the robot keeps moving —
      // exactly what an unconfirmed stop must never hide.
      mockedApi.estop.mockResolvedValue({ ok: true, stopped: false, delivered: false });
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      await useAgentModeStore.getState().estop(ROBOT_ID);
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b3', status: 'running' }) })
      );

      expect(useAgentModeStore.getState().plan?.blocks[2].status).toBe('running');
    });

    it('resetEstop keeps an unconfirmed stop unconfirmed while the agent stays latched', async () => {
      useAgentModeStore.setState({
        estopActive: true,
        estopStatus: 'unconfirmed',
        estopError: 'Damp rejected by sidecar',
      });
      mockedApi.resetEstop.mockResolvedValue(makeState({ estopActive: true }));

      await useAgentModeStore.getState().resetEstop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).toBe('unconfirmed');
    });

    it('does not abort the plan when the agent reports it stopped nothing', async () => {
      // `stopped` is the agent's own answer to "did I abort a live plan?".
      // Rewriting the plan without it would invent an abort that never happened.
      mockedApi.estop.mockResolvedValue({ ok: true, stopped: false });
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b1', status: 'running' }) })
      );

      await useAgentModeStore.getState().estop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.plan?.status).toBe('running');
      expect(statuses()).toEqual(['running', 'pending', 'pending']);
      expect(selectEstopStatus(s)).toBe('acknowledged');
      expect(lastMessage(s)?.text).toContain('no plan was running');
    });

    it('leaves a plan that already finished alone', async () => {
      // Pressing STOPP after the run completed must latch, but must not tell the
      // operator "E-Stop — aborted after N of N blocks" about a normal finish.
      mockedApi.estop.mockResolvedValue({ ok: true, stopped: false });
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({
          type: 'agent:plan:finished',
          plan: makePlan({
            status: 'done',
            cursor: -1,
            blocks: makePlan().blocks.map((b) => ({ ...b, status: 'done' as const })),
          }),
        })
      );

      await useAgentModeStore.getState().estop(ROBOT_ID, 'Operator pressed STOPP');

      const s = useAgentModeStore.getState();
      expect(s.plan?.status).toBe('done');
      expect(statuses()).toEqual(['done', 'done', 'done']);
      // The latch still engages — that is what stops the robot.
      expect(s.estopActive).toBe(true);
    });

    it('reports a failed stop as unconfirmed and never claims the plan aborted', async () => {
      mockedApi.estop.mockRejectedValue(new Error('agent unreachable'));
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b1', status: 'running' }) })
      );

      await useAgentModeStore.getState().estop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      // The local latch still engages — this console refuses commands …
      expect(selectEstopActive(s)).toBe(true);
      // … but nothing about the robot is known, so nothing is claimed.
      expect(selectEstopStatus(s)).toBe('failed');
      expect(selectEstopError(s)).toBe('agent unreachable');
      expect(s.plan?.status).toBe('running');
      expect(statuses()).toEqual(['running', 'pending', 'pending']);
      expect(lastMessage(s)?.text).toContain('FAILED');
      expect(lastMessage(s)?.text).toContain('NOT confirmed');
    });

    it('surfaces the api client error message instead of "unknown error"', async () => {
      // The client rejects with a plain object, not an Error — the message the
      // server sent is the one piece of information the operator needs.
      mockedApi.estop.mockRejectedValue(
        apiError(502, 'Robot agent unreachable', 'BAD_GATEWAY')
      );
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      await useAgentModeStore.getState().estop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectEstopError(s)).toBe('Robot agent unreachable');
      expect(lastMessage(s)?.text).toContain('Robot agent unreachable');
    });

    it('keeps applying block events while the stop is unconfirmed', async () => {
      // The agent pushes events outbound to a fixed SERVER_URL, so a broken
      // server→agent leg does not stop them. They are the evidence that the
      // robot is still moving and must never be hidden.
      mockedApi.estop.mockRejectedValue(new Error('agent unreachable'));
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      await useAgentModeStore.getState().estop(ROBOT_ID);
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b3', status: 'running' }) })
      );

      const s = useAgentModeStore.getState();
      expect(s.plan?.blocks[2].status).toBe('running');
      expect(s.plan?.cursor).toBe(2);
    });

    it('an agent that reports no latch does not silently clear an unconfirmed one', async () => {
      mockedApi.estop.mockRejectedValue(new Error('agent unreachable'));
      await useAgentModeStore.getState().estop(ROBOT_ID);

      apply(
        event({ type: 'agent:state:changed', state: makeState({ estopActive: false }) })
      );

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).toBe('failed');
    });

    it('tracks the damped base an E-Stop leaves behind, across the reset', async () => {
      // Clearing the latch does not re-arm the base: the agent still reports
      // `damped`, and the UI has to keep saying so.
      apply(
        event({
          type: 'agent:state:changed',
          state: makeState({ estopActive: true, damped: true, fsmId: 1 }),
        })
      );
      expect(useAgentModeStore.getState().damped).toBe(true);
      expect(useAgentModeStore.getState().fsmId).toBe(1);

      mockedApi.resetEstop.mockResolvedValue(
        makeState({ estopActive: false, damped: true, fsmId: 1 })
      );
      await useAgentModeStore.getState().resetEstop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(false);
      expect(s.damped).toBe(true);
      expect(s.fsmId).toBe(1);
    });

    it('an older agent that omits damped/fsmId does not reset what is known', () => {
      // Both fields are optional on the wire — absent means unknown, and an
      // unknown must not be turned into "not damped".
      apply(
        event({
          type: 'agent:state:changed',
          state: makeState({ damped: true, fsmId: 1 }),
        })
      );

      apply(event({ type: 'agent:state:changed', state: makeState({ estopActive: false }) }));

      const s = useAgentModeStore.getState();
      expect(s.damped).toBe(true);
      expect(s.fsmId).toBe(1);
    });

    it('a latch the agent reports counts as acknowledged', () => {
      apply(
        event({ type: 'agent:state:changed', state: makeState({ estopActive: true }) })
      );

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).toBe('acknowledged');
    });

    it('refuses new commands while latched', async () => {
      useAgentModeStore.setState({ estopActive: true });

      await useAgentModeStore.getState().sendCommand(ROBOT_ID, 'lauf nach vorne');

      expect(mockedApi.sendCommand).not.toHaveBeenCalled();
      expect(useAgentModeStore.getState().error).toContain('E-Stop');
    });

    it('resetEstop clears the latch from the returned state', async () => {
      useAgentModeStore.setState({
        estopActive: true,
        estopStatus: 'failed',
        estopError: 'agent unreachable',
      });
      mockedApi.resetEstop.mockResolvedValue(makeState({ estopActive: false }));

      await useAgentModeStore.getState().resetEstop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.estopActive).toBe(false);
      expect(selectEstopStatus(s)).toBe('idle');
      expect(selectEstopError(s)).toBeNull();
    });

    it('resetEstop keeps the latch when the call fails', async () => {
      useAgentModeStore.setState({ estopActive: true });
      mockedApi.resetEstop.mockRejectedValue(new Error('still latched'));

      await useAgentModeStore.getState().resetEstop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.estopActive).toBe(true);
      expect(s.error).toBe('still latched');
    });
  });

  // -- Commands --------------------------------------------------------------

  describe('sendCommand', () => {
    it('records the utterance, the acknowledgement and the pending plan', async () => {
      mockedApi.sendCommand.mockResolvedValue({
        accepted: true,
        planId: 'plan-7',
        message: 'Understood — planning.',
      });

      await useAgentModeStore.getState().sendCommand(ROBOT_ID, '  walk to the table with the hat  ');

      const s = useAgentModeStore.getState();
      expect(mockedApi.sendCommand).toHaveBeenCalledWith(ROBOT_ID, 'walk to the table with the hat');
      expect(s.messages).toHaveLength(2);
      expect(s.messages[0]).toMatchObject({
        role: 'user',
        text: 'walk to the table with the hat',
        planId: 'plan-7',
      });
      expect(s.messages[1]).toMatchObject({ role: 'agent', planId: 'plan-7' });
      expect(s.pendingCommand).toEqual({
        planId: 'plan-7',
        text: 'walk to the table with the hat',
        robotId: ROBOT_ID,
      });
      expect(s.isSending).toBe(false);
    });

    it('surfaces a rejected command without a pending plan', async () => {
      mockedApi.sendCommand.mockResolvedValue({ accepted: false, message: 'Agent Mode is off.' });

      await useAgentModeStore.getState().sendCommand(ROBOT_ID, 'wink mal');

      const s = useAgentModeStore.getState();
      expect(s.pendingCommand).toBeNull();
      expect(lastMessage(s)).toMatchObject({ role: 'agent', isError: true });
    });

    it('ignores an empty command', async () => {
      await useAgentModeStore.getState().sendCommand(ROBOT_ID, '   ');
      expect(mockedApi.sendCommand).not.toHaveBeenCalled();
      expect(useAgentModeStore.getState().messages).toEqual([]);
    });

    it('reports a transport failure as an error bubble', async () => {
      mockedApi.sendCommand.mockRejectedValue(new Error('network down'));

      await useAgentModeStore.getState().sendCommand(ROBOT_ID, 'lauf');

      const s = useAgentModeStore.getState();
      expect(s.error).toBe('network down');
      expect(lastMessage(s)).toMatchObject({ isError: true, text: 'network down' });
    });
  });

  // -- State / toggle --------------------------------------------------------

  describe('fetchState', () => {
    it('loads mode, owner, plan and scene', async () => {
      const plan = makePlan();
      mockedApi.getState.mockResolvedValue(
        makeState({ enabled: true, controlOwner: 'agent', plan })
      );
      mockedApi.getScene.mockResolvedValue(makeScene());

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.enabled).toBe(true);
      expect(s.controlOwner).toBe('agent');
      expect(s.plan?.id).toBe('plan-1');
      expect(s.scene?.entities).toHaveLength(1);
      expect(s.isLoading).toBe(false);
    });

    it('sets the error on failure', async () => {
      mockedApi.getState.mockRejectedValue(new Error('no agent'));
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.error).toBe('no agent');
      expect(s.isLoading).toBe(false);
    });

    it('treats a 404 as the empty state, not as an error', async () => {
      // Fresh server process, robot-agent without AGENT_MODE_ENABLED: nothing
      // has ever emitted `agent:state:changed`, so the server answers 404. That
      // is a cold start, not a failure — an operator opening /agent for the
      // first time must not be shown an error banner.
      mockedApi.getState.mockRejectedValue(apiError(404, 'No agent mode state for robot'));
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.error).toBeNull();
      expect(s.enabled).toBe(false);
      expect(s.plan).toBeNull();
      expect(s.scene).toBeNull();
      expect(s.estopActive).toBe(false);
      expect(s.isLoading).toBe(false);
      expect(s.robotId).toBe(ROBOT_ID);
    });

    it('reports the server message for a non-404 api error', async () => {
      // The client rejects with a plain object; without unwrapping it the
      // operator only ever reads "An unknown error occurred".
      mockedApi.getState.mockRejectedValue(apiError(500, 'Failed to get agent mode state'));
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(useAgentModeStore.getState().error).toBe('Failed to get agent mode state');
    });

    it('adopts an E-Stop the agent already holds as acknowledged', async () => {
      mockedApi.getState.mockResolvedValue(makeState({ estopActive: true }));
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).toBe('acknowledged');
    });

    it('loads the base arming state so a damped robot is visible on open', async () => {
      mockedApi.getState.mockResolvedValue(
        makeState({ estopActive: true, damped: true, fsmId: 1 })
      );
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.damped).toBe(true);
      expect(s.fsmId).toBe(1);
    });
  });

  describe('toggle', () => {
    it('flips optimistically and keeps the confirmed value', async () => {
      mockedApi.toggle.mockResolvedValue(makeState({ enabled: true, controlOwner: 'idle' }));

      await useAgentModeStore.getState().toggle(ROBOT_ID, true);

      expect(useAgentModeStore.getState().enabled).toBe(true);
    });

    it('rolls back on failure', async () => {
      useAgentModeStore.setState({ enabled: false });
      mockedApi.toggle.mockRejectedValue(new Error('toggle failed'));

      await useAgentModeStore.getState().toggle(ROBOT_ID, true);

      const s = useAgentModeStore.getState();
      expect(s.enabled).toBe(false);
      expect(s.error).toBe('toggle failed');
    });
  });

  // -- Stale responses after a robot switch ----------------------------------

  describe('stale responses after a robot switch', () => {
    // The store is a singleton that `selectRobot` wipes. A slow response for
    // robot A that lands after the user switched to robot B must be dropped:
    // applying it would rewrite B's view with A's data, after which B's own
    // WebSocket events are discarded by the `applyEvent` robot filter.
    const OTHER_ROBOT = 'other-robot';

    it('fetchState drops a stale response', async () => {
      let release: (value: AgentModeState) => void = () => {};
      mockedApi.getState.mockReturnValue(
        new Promise<AgentModeState>((resolve) => {
          release = resolve;
        })
      );
      mockedApi.getScene.mockResolvedValue(null);

      const inFlight = useAgentModeStore.getState().fetchState(ROBOT_ID);
      useAgentModeStore.getState().selectRobot(OTHER_ROBOT);

      release(
        makeState({ enabled: true, controlOwner: 'agent', plan: makePlan(), estopActive: true })
      );
      await inFlight;

      const s = useAgentModeStore.getState();
      expect(s.robotId).toBe(OTHER_ROBOT);
      expect(s.plan).toBeNull();
      expect(s.enabled).toBe(false);
      expect(s.estopActive).toBe(false);

      // The new robot's events must keep flowing after the stale landing.
      apply(
        event({
          type: 'agent:plan:started',
          robotId: OTHER_ROBOT,
          plan: makePlan({ id: 'plan-b', robotId: OTHER_ROBOT }),
        })
      );
      expect(useAgentModeStore.getState().plan?.id).toBe('plan-b');
    });

    it('fetchState drops a stale failure', async () => {
      let fail: (error: unknown) => void = () => {};
      mockedApi.getState.mockReturnValue(
        new Promise<AgentModeState>((_resolve, reject) => {
          fail = reject;
        })
      );
      mockedApi.getScene.mockResolvedValue(null);

      const inFlight = useAgentModeStore.getState().fetchState(ROBOT_ID);
      useAgentModeStore.getState().selectRobot(OTHER_ROBOT);

      fail(new Error('no agent'));
      await inFlight;

      // A late failure for the old robot must not paint an error over the new one.
      expect(useAgentModeStore.getState().error).toBeNull();
    });

    it('toggle drops a stale confirmation', async () => {
      let release: (value: AgentModeState) => void = () => {};
      mockedApi.toggle.mockReturnValue(
        new Promise<AgentModeState>((resolve) => {
          release = resolve;
        })
      );

      const inFlight = useAgentModeStore.getState().toggle(ROBOT_ID, true);
      useAgentModeStore.getState().selectRobot(OTHER_ROBOT);

      // The old robot answers with its mode on and its E-Stop latched.
      release(makeState({ enabled: true, estopActive: true }));
      await inFlight;

      const s = useAgentModeStore.getState();
      expect(s.enabled).toBe(false);
      expect(s.estopActive).toBe(false);
    });

    it('estop drops a stale confirmation instead of aborting the new robot plan', async () => {
      let release: (value: AgentEstopResponse) => void = () => {};
      mockedApi.estop.mockReturnValue(
        new Promise<AgentEstopResponse>((resolve) => {
          release = resolve;
        })
      );
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      const inFlight = useAgentModeStore.getState().estop(ROBOT_ID, 'Operator pressed STOPP');
      useAgentModeStore.getState().selectRobot(OTHER_ROBOT);
      // The new robot is mid-run when the old robot's confirmation lands.
      apply(
        event({
          type: 'agent:plan:started',
          robotId: OTHER_ROBOT,
          plan: makePlan({ id: 'plan-b', robotId: OTHER_ROBOT }),
        })
      );

      release({ ok: true, stopped: true, delivered: true });
      await inFlight;

      const s = useAgentModeStore.getState();
      // The new robot was never asked to stop — no latch, no aborted plan,
      // no "E-Stop confirmed" in its conversation.
      expect(s.estopActive).toBe(false);
      expect(s.plan?.status).toBe('running');
      expect(statuses()).toEqual(['pending', 'pending', 'pending']);
      expect(s.messages).toEqual([]);
    });

    it('resetEstop drops a stale confirmation instead of clearing the new robot latch', async () => {
      useAgentModeStore.setState({ estopActive: true, estopStatus: 'acknowledged' });
      let release: (value: AgentModeState) => void = () => {};
      mockedApi.resetEstop.mockReturnValue(
        new Promise<AgentModeState>((resolve) => {
          release = resolve;
        })
      );

      const inFlight = useAgentModeStore.getState().resetEstop(ROBOT_ID);
      useAgentModeStore.getState().selectRobot(OTHER_ROBOT);
      // The new robot's console latches while the old robot's reset is in flight.
      apply(
        event({
          type: 'agent:state:changed',
          robotId: OTHER_ROBOT,
          state: makeState({ robotId: OTHER_ROBOT, estopActive: true }),
        })
      );

      release(makeState({ estopActive: false }));
      await inFlight;

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).toBe('acknowledged');
    });

    it('sendCommand drops a stale acknowledgement', async () => {
      let release: (value: AgentCommandResponse) => void = () => {};
      mockedApi.sendCommand.mockReturnValue(
        new Promise<AgentCommandResponse>((resolve) => {
          release = resolve;
        })
      );

      const inFlight = useAgentModeStore.getState().sendCommand(ROBOT_ID, 'walk to the table');
      useAgentModeStore.getState().selectRobot(OTHER_ROBOT);

      release({ accepted: true, planId: 'plan-7', message: 'Understood — planning.' });
      await inFlight;

      const s = useAgentModeStore.getState();
      // No stray bubble in the new robot's fresh conversation …
      expect(s.messages).toEqual([]);
      // … and no pending command that would show "Planning…" forever — the
      // old robot's plan events are dropped by the applyEvent robot filter.
      expect(s.pendingCommand).toBeNull();
    });
  });

  // -- Selectors -------------------------------------------------------------

  describe('selectors', () => {
    it('selectCurrentBlock prefers the running block', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b2', status: 'running' }) })
      );

      const s = useAgentModeStore.getState();
      expect(selectCurrentBlock(s)?.id).toBe('b2');
      expect(selectUpcomingBlocks(s).map((b) => b.id)).toEqual(['b3']);
    });

    it('selectCurrentBlock prefers the cursor when a wrapping goto also runs', () => {
      // Both the `goto` and the generated block it spawned report `running`;
      // the chip must show the generated one, not the container.
      apply(
        event({
          type: 'agent:plan:started',
          plan: makeSplicedPlan({ cursor: 2 }),
        })
      );
      apply(
        event({
          type: 'agent:block:started',
          block: makeBlock({ id: 'g1-nav-2', kind: 'turn', status: 'running' }),
        })
      );

      const s = useAgentModeStore.getState();
      expect(selectCurrentBlock(s)?.id).toBe('g1-nav-2');
    });

    it('selectCurrentBlock falls back to the cursor when nothing reports running', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan({ cursor: 2 }) }));

      const s = useAgentModeStore.getState();
      expect(selectCurrentBlock(s)?.id).toBe('b3');
      expect(selectUpcomingBlocks(s)).toEqual([]);
    });

    it('selectUpcomingBlocks lists every pending block when nothing runs', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      const s = useAgentModeStore.getState();
      expect(selectCurrentBlock(s)).toBeNull();
      expect(selectUpcomingBlocks(s).map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    });

    it('selectUpcomingBlocks drops blocks that already ran', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:finished', block: makeBlock({ id: 'b1', status: 'done' }) })
      );
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b2', status: 'running' }) })
      );

      const s = useAgentModeStore.getState();
      expect(selectUpcomingBlocks(s).map((b) => b.id)).toEqual(['b3']);
    });

    it('no plan means no current or upcoming blocks', () => {
      const s = useAgentModeStore.getState();
      expect(selectCurrentBlock(s)).toBeNull();
      expect(selectUpcomingBlocks(s)).toEqual([]);
      expect(selectSceneEntities(s)).toEqual([]);
    });
  });

  // -- Utility ---------------------------------------------------------------

  describe('clearError / selectRobot / reset', () => {
    it('clearError nulls the error only', () => {
      useAgentModeStore.setState({ error: 'boom', enabled: true });
      useAgentModeStore.getState().clearError();
      const s = useAgentModeStore.getState();
      expect(s.error).toBeNull();
      expect(s.enabled).toBe(true);
    });

    it('selectRobot wipes per-robot state when the robot changes', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      useAgentModeStore.setState({ error: 'boom' });

      useAgentModeStore.getState().selectRobot('other-robot');

      const s = useAgentModeStore.getState();
      expect(s.robotId).toBe('other-robot');
      expect(s.plan).toBeNull();
      expect(s.error).toBeNull();
      expect(s.messages).toEqual([]);
    });

    it('selectRobot is a no-op for the same robot', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      useAgentModeStore.getState().selectRobot(ROBOT_ID);

      expect(useAgentModeStore.getState().plan?.id).toBe('plan-1');
    });

    it('reset restores the initial state', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(event({ type: 'agent:scene:updated', scene: makeScene() }));

      useAgentModeStore.getState().reset();

      const s = useAgentModeStore.getState();
      expect(s.plan).toBeNull();
      expect(s.scene).toBeNull();
      expect(s.planHistory).toEqual([]);
      expect(s.robotId).toBeNull();
    });
  });
});
