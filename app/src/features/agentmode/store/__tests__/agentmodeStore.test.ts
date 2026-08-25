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
  selectEstopSource,
  selectEstopReason,
  selectPlan,
  selectPlanById,
  selectRecovered,
  selectSceneEntities,
  selectSelfSuperseded,
  selectMessages,
  selectStateReachability,
  selectStateUnavailableReason,
  selectStateUnknown,
} from '../agentmodeStore';
import type {
  AgentBlock,
  AgentBlockStatus,
  AgentCommandResponse,
  AgentEstopResponse,
  AgentMemoryDigest,
  AgentModeEvent,
  AgentModeState,
  AgentPlan,
  AgentSelfState,
  MirroredAgentModeState,
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
    getMemory: vi.fn(),
    getMap: vi.fn(),
    writeIdentity: vi.fn(),
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

const makeSelf = (overrides: Partial<AgentSelfState> = {}): AgentSelfState => ({
  name: 'G1-EDU-Bot',
  emoji: null,
  unit: 'Unitree G1 EDU (Dex3-1)',
  robotId: ROBOT_ID,
  operator: null,
  site: null,
  bootstrapRequired: true,
  bootId: 'boot-1',
  incarnation: 47,
  uptimeS: 1500,
  lastShutdown: null,
  place: null,
  poseSource: 'odometry',
  batteryPct: 81,
  controlOwner: 'idle',
  damped: false,
  estopLatched: false,
  plansLast24h: 0,
  failuresLast24h: 0,
  memoryEntries: 3,
  ...overrides,
});

const makeDigest = (overrides: Partial<AgentMemoryDigest> = {}): AgentMemoryDigest => ({
  robotId: ROBOT_ID,
  place: 'AISLE-3',
  memoryBytes: 1024,
  memoryMaxBytes: 8192,
  memoryEntries: 3,
  places: [{ id: 'AISLE-3', entries: 2, bytes: 220 }],
  journalDays: ['2026-07-24', '2026-07-25'],
  retention: { retentionDays: 30, source: 'fallback', legalHold: false },
  updatedAt: TS,
  ...overrides,
});

const makeState = (overrides: Partial<MirroredAgentModeState> = {}): MirroredAgentModeState => ({
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
    expect(s.stateReachability).toBe('known');
    expect(s.stateUnavailableReason).toBeNull();
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

    it('agent:plan:started echoes a command that came from somewhere else', () => {
      // A spoken command never passes through this tab's `sendCommand`, so
      // without the echo the conversation shows the robot answering a question
      // it was never seen to be asked.
      apply(event({ type: 'agent:plan:started', plan: makePlan({ language: 'de' }) }));

      const s = useAgentModeStore.getState();
      expect(s.messages).toHaveLength(2);
      expect(s.messages[0]).toMatchObject({
        role: 'user',
        text: 'walk to the table with the hat',
        planId: 'plan-1',
        spokenLanguage: 'de',
      });
      // … and the acknowledgement the blocks hang off, which only
      // `sendCommand` used to write.
      expect(s.messages[1]).toMatchObject({
        role: 'agent',
        planId: 'plan-1',
        showsPlan: true,
      });
    });

    it('does not echo a typed command back as if someone else had said it', () => {
      // The plan:started event routinely overtakes the HTTP response, so the
      // in-flight `isSending` flag — not `pendingCommand` — is what stops the
      // local command from appearing twice.
      mockedApi.sendCommand.mockReturnValue(new Promise(() => {})); // never settles
      void useAgentModeStore.getState().sendCommand(ROBOT_ID, 'walk to the table with the hat');
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));

      const s = useAgentModeStore.getState();
      expect(s.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    });

    it('marks a plan started elsewhere without claiming it was spoken', () => {
      // No `language` means it was typed — in another tab, over A2A, anywhere.
      // The message is still shown; the microphone marker is not.
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      expect(useAgentModeStore.getState().messages[0].spokenLanguage).toBeUndefined();
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

    it('shows a command folded into the running plan, marked as heard', () => {
      // A spoken interrupt starts no plan of its own: all that arrives is an
      // updated plan whose command grew a "→ …" tail. Without the echo the
      // timeline rewrites itself with nobody on screen having asked for it.
      apply(event({ type: 'agent:plan:started', plan: makePlan({ language: 'de' }) }));
      apply(
        event({
          type: 'agent:plan:updated',
          plan: makePlan({
            command: 'walk to the table with the hat → dreh dich nach links',
            language: 'de',
          }),
        })
      );

      const spoken = useAgentModeStore.getState().messages.filter((m) => m.role === 'user');
      expect(spoken).toHaveLength(2);
      expect(spoken[1]).toMatchObject({
        text: 'dreh dich nach links',
        planId: 'plan-1',
        spokenLanguage: 'de',
      });
    });

    it('does not echo an interrupt this tab typed itself', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      mockedApi.sendCommand.mockReturnValue(new Promise(() => {})); // never settles
      void useAgentModeStore.getState().sendCommand(ROBOT_ID, 'dreh dich nach links');

      apply(
        event({
          type: 'agent:plan:updated',
          plan: makePlan({ command: 'walk to the table with the hat → dreh dich nach links' }),
        })
      );

      const typed = useAgentModeStore
        .getState()
        .messages.filter((m) => m.role === 'user' && m.text === 'dreh dich nach links');
      expect(typed).toHaveLength(1);
    });

    it('says nothing extra when a plan update only rewrites blocks', () => {
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({
          type: 'agent:plan:updated',
          plan: makePlan({ blocks: [makeBlock({ id: 'b1', kind: 'speak' })] }),
        })
      );
      expect(useAgentModeStore.getState().messages.filter((m) => m.role === 'user')).toHaveLength(1);
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

    describe('agent:state:changed and a stale plan', () => {
      // The robot re-asserts its state to the server mirror on a clock and the
      // server fans every one of those pushes out here. The push is
      // fire-and-forget, so a snapshot taken at T can arrive AFTER an event
      // emitted at T+ε. A snapshot must therefore never move the timeline
      // backwards — and the app has to hold that line on its own, because it
      // talks to robot-agents older than the fix that stopped sending the plan.

      it('does not resurrect a plan that has already finished', () => {
        const plan = makePlan();
        apply(event({ type: 'agent:plan:started', plan }));
        apply(
          event({
            type: 'agent:plan:finished',
            plan: { ...plan, status: 'done', cursor: -1, updatedAt: '2026-07-25T10:00:30.000Z' },
          })
        );

        // The heartbeat snapshot, taken a millisecond before the plan ended.
        apply(
          event({
            type: 'agent:state:changed',
            state: makeState({ plan: { ...plan, status: 'running', cursor: 2 } }),
          })
        );

        const s = useAgentModeStore.getState();
        expect(s.plan?.status).toBe('done');
        expect(s.plan?.cursor).toBe(-1);
      });

      it('does not rewind a running plan to an older snapshot of itself', () => {
        const plan = makePlan();
        apply(event({ type: 'agent:plan:started', plan }));
        apply(
          event({
            type: 'agent:plan:updated',
            plan: { ...plan, cursor: 2, updatedAt: '2026-07-25T10:00:20.000Z' },
          })
        );

        apply(
          event({
            type: 'agent:state:changed',
            state: makeState({ plan: { ...plan, cursor: 0, updatedAt: TS } }),
          })
        );

        expect(useAgentModeStore.getState().plan?.cursor).toBe(2);
      });

      it('does not let a previous plan hijack the timeline of the current one', () => {
        // The worst variant: P1's snapshot lands after P2 started. Every later
        // P2 block event is then rejected as belonging to another plan, and the
        // operator watches P1's blocks for the whole execution of P2.
        apply(event({ type: 'agent:plan:started', plan: makePlan() }));
        const p2 = makePlan({
          id: 'plan-2',
          command: 'wave',
          createdAt: '2026-07-25T10:01:00.000Z',
          updatedAt: '2026-07-25T10:01:00.000Z',
        });
        apply(event({ type: 'agent:plan:started', plan: p2 }));

        apply(
          event({
            type: 'agent:state:changed',
            state: makeState({ plan: makePlan({ status: 'running' }) }),
          })
        );

        const s = useAgentModeStore.getState();
        expect(s.plan?.id).toBe('plan-2');
        expect(s.plan?.command).toBe('wave');
      });

      it('still adopts a newer plan this client never saw start', () => {
        // The guard is against going BACKWARDS, not against catching up: a tab
        // that missed `agent:plan:started` must still learn the current plan.
        apply(event({ type: 'agent:plan:started', plan: makePlan() }));

        apply(
          event({
            type: 'agent:state:changed',
            state: makeState({
              plan: makePlan({
                id: 'plan-2',
                command: 'wave',
                createdAt: '2026-07-25T10:01:00.000Z',
                updatedAt: '2026-07-25T10:01:00.000Z',
              }),
            }),
          })
        );

        expect(useAgentModeStore.getState().plan?.id).toBe('plan-2');
      });

      it('adopts a plan when there is nothing on screen to rewind', () => {
        apply(event({ type: 'agent:state:changed', state: makeState({ plan: makePlan() }) }));
        expect(useAgentModeStore.getState().plan?.id).toBe('plan-1');
      });

      it('keeps the plan when a liveness snapshot omits it entirely', () => {
        // What a current robot-agent sends: a state with no `plan` key at all.
        apply(event({ type: 'agent:plan:started', plan: makePlan() }));

        const liveness = makeState();
        delete liveness.plan;
        delete liveness.scene;
        apply(event({ type: 'agent:state:changed', state: liveness }));

        const s = useAgentModeStore.getState();
        expect(s.plan?.id).toBe('plan-1');
        expect(s.enabled).toBe(true);
      });
    });

    it('ignores progress about a plan this console’s own confirmed STOPP ended', async () => {
      // The executor still had events in flight when the stop landed. Applying
      // them would walk a plan the operator was told is aborted back to
      // "running" — a timeline moving under a confirmed stop.
      mockedApi.estop.mockResolvedValue({ ok: true, stopped: true, delivered: true });
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b1', status: 'running' }) })
      );

      await useAgentModeStore.getState().estop(ROBOT_ID, 'Operator pressed STOPP');
      apply(
        event({ type: 'agent:block:finished', block: makeBlock({ id: 'b1', status: 'done' }) })
      );
      apply(event({ type: 'agent:plan:started', plan: makePlan({ id: 'plan-9' }) }));

      const s = useAgentModeStore.getState();
      expect(s.plan?.id).toBe('plan-1');
      expect(s.plan?.status).toBe('aborted');
      expect(statuses()).toEqual(['aborted', 'skipped', 'skipped']);
    });

    describe('a latch this console did not set', () => {
      /**
       * The SafetyMonitor's geofence / protective stop and the fleet E-Stop.
       * The robot-agent pushes `agent:state:changed` the moment the latch trips
       * (`publishLatchChange`), while its executor only notices the abort
       * flag a moment later and then emits the `aborted` block and plan
       * (`agent-mode-controller.ts`). Suppressing on the latch alone threw away
       * the only events that could end the plan — the rail kept its "Running"
       * pill and its pulsing walk chip until the page was reloaded, because
       * nothing repeats a finished plan: the 15 s heartbeat carries no `plan`.
       */
      const latchFromSafety = () =>
        apply(
          event({
            type: 'agent:state:changed',
            state: makeState({
              estopActive: true,
              estopSource: 'safety',
              estopReason: 'Geofence breach',
            }),
          })
        );

      it('still lands the plan’s aborted status behind a safety latch', () => {
        apply(event({ type: 'agent:plan:started', plan: makePlan() }));
        apply(
          event({ type: 'agent:block:started', block: makeBlock({ id: 'b2', status: 'running' }) })
        );

        latchFromSafety();
        expect(useAgentModeStore.getState().estopActive).toBe(true);

        apply(
          event({
            type: 'agent:block:finished',
            block: makeBlock({
              id: 'b2',
              status: 'aborted',
              error: 'Safety stop (geofence): Geofence breach',
            }),
          })
        );
        apply(
          event({
            type: 'agent:plan:finished',
            plan: makePlan({
              status: 'aborted',
              cursor: -1,
              updatedAt: '2026-07-25T10:00:05.000Z',
              blocks: [
                makeBlock({ id: 'b1', kind: 'scan_room', status: 'done' }),
                makeBlock({ id: 'b2', kind: 'turn', status: 'aborted' }),
                makeBlock({ id: 'b3', kind: 'walk', status: 'skipped' }),
              ],
            }),
          })
        );

        const s = useAgentModeStore.getState();
        expect(s.plan?.status).toBe('aborted');
        expect(s.controlOwner).toBe('idle');
        expect(statuses()).toEqual(['done', 'aborted', 'skipped']);
        expect(lastMessage(s)?.text).toBe('Plan aborted after 1 of 3 blocks.');
      });

      it('clears the pending command a safety-aborted plan was waiting on', () => {
        apply(event({ type: 'agent:plan:started', plan: makePlan() }));
        useAgentModeStore.setState({
          pendingCommand: { planId: 'plan-1', text: 'walk to the table', robotId: ROBOT_ID },
        });

        latchFromSafety();
        apply(
          event({
            type: 'agent:plan:finished',
            plan: makePlan({ status: 'aborted', updatedAt: '2026-07-25T10:00:05.000Z' }),
          })
        );

        expect(useAgentModeStore.getState().pendingCommand).toBeNull();
      });
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

    /**
     * The mirror of the test above — and the case it did not cover.
     *
     * `applyReportedLatch` guarded `unconfirmed` and nothing else, while its own
     * *absence* branch guards both `requesting` and `failed`. So a stop whose
     * request never completed — the server proxy timing out (its 5 s budget is
     * shorter than the robot's own stop path), the robot unreachable — was
     * upgraded to `acknowledged` by the agent's next 15 s mirror heartbeat, and
     * `estopError` was wiped along with it. The banner then read "The robot
     * confirmed the stop: it is stopped and damped" about a stop this console
     * never managed to deliver, leaving the chat's "E-Stop request FAILED" line
     * as the only surviving trace.
     *
     * A reported latch is a SOFTWARE claim — this file's own docstring says so.
     * It cannot confirm hardware for a `failed` stop any more than for an
     * `unconfirmed` one. It IS new information (the latch exists now), so the
     * status moves — to `unconfirmed`, which is exactly what is true: latched,
     * not confirmed.
     */
    it('a reported latch does not upgrade a FAILED stop to a confirmed one', async () => {
      mockedApi.estop.mockRejectedValue(new Error('Robot not reachable'));

      await useAgentModeStore.getState().estop(ROBOT_ID);
      expect(selectEstopStatus(useAgentModeStore.getState())).toBe('failed');

      // The 15 s mirror re-push: the agent says it is latched.
      apply(event({ type: 'agent:state:changed', state: makeState({ estopActive: true }) }));

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).not.toBe('acknowledged');
      expect(selectEstopStatus(s)).toBe('unconfirmed');
      // The reason the operator needs must survive the heartbeat.
      expect(selectEstopError(s)).toBe('Robot not reachable');
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

    it('surfaces what the robot’s boot inherited (TASK-196)', () => {
      apply(
        event({
          type: 'agent:state:changed',
          state: makeState({
            estopActive: true,
            recovered: { fromCrash: true, estopLatched: true, at: TS },
          }),
        })
      );

      expect(selectRecovered(useAgentModeStore.getState())).toEqual({
        fromCrash: true,
        estopLatched: true,
        at: TS,
      });
    });

    it('clears the recovery marker when the agent says it was acknowledged', async () => {
      useAgentModeStore.setState({
        estopActive: true,
        recovered: { fromCrash: true, estopLatched: true, at: TS },
      });

      mockedApi.resetEstop.mockResolvedValue(
        makeState({ estopActive: false, recovered: null })
      );
      await useAgentModeStore.getState().resetEstop(ROBOT_ID);

      expect(selectRecovered(useAgentModeStore.getState())).toBeNull();
    });

    it('an older agent that omits `recovered` does not clear the badge', () => {
      // Absent is unknown, never "nothing happened" — hiding the badge because
      // of an old agent hides the one thing the operator has to see.
      useAgentModeStore.setState({
        recovered: { fromCrash: true, estopLatched: false, at: TS },
      });

      apply(event({ type: 'agent:state:changed', state: makeState({ estopActive: false }) }));

      expect(selectRecovered(useAgentModeStore.getState())).not.toBeNull();
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

    describe('which latch (estopSource / estopReason)', () => {
      it('starts with no source and no reason', () => {
        const s = useAgentModeStore.getState();
        expect(selectEstopSource(s)).toBeNull();
        expect(selectEstopReason(s)).toBeNull();
      });

      it('takes the safety-monitor attribution from a pushed state', () => {
        apply(
          event({
            type: 'agent:state:changed',
            state: makeState({
              estopActive: true,
              estopSource: 'safety',
              estopReason: 'Critical system error detected',
            }),
          })
        );
        const s = useAgentModeStore.getState();
        expect(s.estopActive).toBe(true);
        expect(selectEstopStatus(s)).toBe('acknowledged');
        expect(selectEstopSource(s)).toBe('safety');
        expect(selectEstopReason(s)).toBe('Critical system error detected');
      });

      it('takes it from fetchState too', async () => {
        mockedApi.getState.mockResolvedValue(
          makeState({ estopActive: true, estopSource: 'safety', estopReason: 'Fall detected' })
        );
        mockedApi.getScene.mockResolvedValue(null);
        await useAgentModeStore.getState().fetchState(ROBOT_ID);
        const s = useAgentModeStore.getState();
        expect(selectEstopSource(s)).toBe('safety');
        expect(selectEstopReason(s)).toBe('Fall detected');
      });

      it("attributes a latch an older agent reports without a source to Agent Mode", () => {
        apply(event({ type: 'agent:state:changed', state: makeState({ estopActive: true }) }));
        expect(selectEstopSource(useAgentModeStore.getState())).toBe('agent');
        expect(selectEstopReason(useAgentModeStore.getState())).toBeNull();
      });

      it('marks a STOPP pressed here as our own latch', async () => {
        mockedApi.estop.mockResolvedValue({ ok: true, stopped: true, delivered: true });
        await useAgentModeStore.getState().estop(ROBOT_ID);
        expect(selectEstopSource(useAgentModeStore.getState())).toBe('agent');
      });

      it('clears both when the latch clears — from a push and from resetEstop', async () => {
        apply(
          event({
            type: 'agent:state:changed',
            state: makeState({ estopActive: true, estopSource: 'safety', estopReason: 'x' }),
          })
        );
        apply(event({ type: 'agent:state:changed', state: makeState({ estopActive: false }) }));
        let s = useAgentModeStore.getState();
        expect(s.estopActive).toBe(false);
        expect(selectEstopSource(s)).toBeNull();
        expect(selectEstopReason(s)).toBeNull();

        useAgentModeStore.setState({
          estopActive: true,
          estopStatus: 'acknowledged',
          estopSource: 'safety',
          estopReason: 'x',
        });
        mockedApi.resetEstop.mockResolvedValue(makeState({ estopActive: false }));
        await useAgentModeStore.getState().resetEstop(ROBOT_ID);
        s = useAgentModeStore.getState();
        expect(s.estopActive).toBe(false);
        expect(selectEstopSource(s)).toBeNull();
        expect(selectEstopReason(s)).toBeNull();
      });

      it('keeps the safety attribution when a refused reset leaves the latch set', async () => {
        useAgentModeStore.setState({
          estopActive: true,
          estopStatus: 'acknowledged',
          estopSource: 'safety',
          estopReason: 'x',
        });
        mockedApi.resetEstop.mockResolvedValue(
          makeState({ estopActive: true, estopSource: 'safety', estopReason: 'x' })
        );
        await useAgentModeStore.getState().resetEstop(ROBOT_ID);
        const s = useAgentModeStore.getState();
        expect(s.estopActive).toBe(true);
        expect(selectEstopSource(s)).toBe('safety');
      });
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
      expect(s.pendingCommand).toMatchObject({
        planId: 'plan-7',
        text: 'walk to the table with the hat',
        robotId: ROBOT_ID,
      });
      // The browser-frame t0 of the rail's planning counter (TASK-202). Stamped
      // here rather than read off the plan, whose `createdAt` is the ROBOT's
      // clock — measuring against that would fold skew into the number.
      const sentAt = s.pendingCommand?.sentAt;
      expect(sentAt).toBeTruthy();
      expect(Number.isNaN(Date.parse(sentAt as string))).toBe(false);
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

  // ==========================================================================
  // UNKNOWN — the robot exists and could not be asked (502)
  //
  // The endpoint used to answer 404 for both "no such robot" and "could not
  // reach it", and the store folded both into `null` → `enabled:false,
  // estopActive:false`. That renders as "Agent Mode off, E-Stop clear" about a
  // robot nobody can see: a false-safe display on a safety surface, and the
  // worst direction to fail in. 404 stays the empty case; 502 must not.
  // ==========================================================================
  describe('state UNKNOWN', () => {
    /** The server's 502 for a robot it has but could not ask. */
    const unavailable = () =>
      apiError(
        502,
        'Agent Mode state UNKNOWN: the robot agent could not be reached or did not ' +
          'answer with a state.',
        'AGENT_STATE_UNAVAILABLE'
      );

    it('flags the state as unknown instead of reporting "off, E-Stop clear"', async () => {
      mockedApi.getState.mockRejectedValue(unavailable());
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectStateReachability(s)).toBe('unreachable');
      expect(selectStateUnknown(s)).toBe(true);
      expect(selectStateUnavailableReason(s)).toContain('could not be reached');
      expect(s.isLoading).toBe(false);
      // Not an error banner: an unreachable robot is an ordinary condition, and
      // a dismissible red alarm on every page open is one nobody reads.
      expect(s.error).toBeNull();
    });

    it('does not overwrite what was last known with confident defaults', async () => {
      // Neither direction is honest on its own: keeping the values would claim
      // they are current, clearing them would claim "off / no plan". The values
      // stay, the flag says they are memories, and the UI reads the flag.
      apply(
        event({
          type: 'agent:state:changed',
          state: makeState({ enabled: true, controlOwner: 'agent', plan: makePlan() }),
        })
      );
      mockedApi.getState.mockRejectedValue(unavailable());
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectStateUnknown(s)).toBe(true);
      expect(s.enabled).toBe(true);
      expect(s.plan?.id).toBe('plan-1');
    });

    it('leaves a local E-Stop latch exactly as it was', async () => {
      useAgentModeStore.setState({ estopActive: true, estopStatus: 'acknowledged' });
      mockedApi.getState.mockRejectedValue(unavailable());
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).toBe('acknowledged');
      expect(selectStateUnknown(s)).toBe(true);
    });

    it('keeps 404 as the empty case, which is a complete answer', async () => {
      mockedApi.getState.mockRejectedValue(apiError(404, 'No agent mode state for robot'));
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectStateUnknown(s)).toBe(false);
      expect(s.error).toBeNull();
    });

    it('does not claim unknown for a plain server failure', async () => {
      // A 500 is the server breaking, not the robot going quiet — that already
      // raises a real error the operator can read.
      mockedApi.getState.mockRejectedValue(apiError(500, 'Failed to get agent mode state'));
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectStateUnknown(s)).toBe(false);
      expect(s.error).toBe('Failed to get agent mode state');
    });

    it('clears the moment the robot answers again', async () => {
      useAgentModeStore.setState({
        stateReachability: 'unreachable',
        stateUnavailableReason: 'gone',
      });
      mockedApi.getState.mockResolvedValue(makeState({ enabled: true }));
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectStateUnknown(s)).toBe(false);
      expect(selectStateUnavailableReason(s)).toBeNull();
      expect(s.enabled).toBe(true);
    });

    it('a pushed agent:state:changed ends the unknown', () => {
      useAgentModeStore.setState({ stateReachability: 'unreachable' });

      apply(event({ type: 'agent:state:changed', state: makeState({ enabled: true }) }));

      expect(selectStateUnknown(useAgentModeStore.getState())).toBe(false);
    });

    it('block progress alone does not end it — it says nothing about the latch', () => {
      // A block event proves the robot is alive, not that this console knows
      // its mode or its E-Stop position. Only a full state does.
      apply(event({ type: 'agent:plan:started', plan: makePlan() }));
      useAgentModeStore.setState({ stateReachability: 'unreachable' });

      apply(
        event({ type: 'agent:block:started', block: makeBlock({ id: 'b1', status: 'running' }) })
      );

      expect(selectStateUnknown(useAgentModeStore.getState())).toBe(true);
    });

    it('a toggle that cannot reach the robot marks the mode unknown', async () => {
      useAgentModeStore.setState({ enabled: false });
      mockedApi.toggle.mockRejectedValue(unavailable());

      await useAgentModeStore.getState().toggle(ROBOT_ID, true);

      const s = useAgentModeStore.getState();
      // The optimistic flip is rolled back, but "back to off" is not a fact
      // either — the switch must stop claiming a position.
      expect(selectStateUnknown(s)).toBe(true);
      expect(s.error).toContain('could not be reached');
    });

    it('a toggle the robot refuses is the robot talking, not silence', async () => {
      mockedApi.toggle.mockRejectedValue(apiError(400, 'enabled must be a boolean'));

      await useAgentModeStore.getState().toggle(ROBOT_ID, true);

      expect(selectStateUnknown(useAgentModeStore.getState())).toBe(false);
    });

    it('a successful toggle re-establishes what is known', async () => {
      useAgentModeStore.setState({ stateReachability: 'unreachable' });
      mockedApi.toggle.mockResolvedValue(makeState({ enabled: true }));

      await useAgentModeStore.getState().toggle(ROBOT_ID, true);

      expect(selectStateUnknown(useAgentModeStore.getState())).toBe(false);
    });

    it('an E-Stop the agent answers ends the unknown and gives a real latch', async () => {
      useAgentModeStore.setState({ stateReachability: 'unreachable' });
      mockedApi.estop.mockResolvedValue({ ok: true, stopped: false, delivered: true });

      await useAgentModeStore.getState().estop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectStateUnknown(s)).toBe(false);
      expect(selectEstopStatus(s)).toBe('acknowledged');
    });

    it('an E-Stop that never reaches the robot leaves everything unknown', async () => {
      mockedApi.estop.mockRejectedValue(unavailable());

      await useAgentModeStore.getState().estop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      // The local latch still engages, the stop is reported as unconfirmed …
      expect(selectEstopActive(s)).toBe(true);
      expect(selectEstopStatus(s)).toBe('failed');
      // … and the robot's own position stays unknown.
      expect(selectStateUnknown(s)).toBe(true);
    });

    it('a reset that cannot reach the robot keeps the latch and says so', async () => {
      useAgentModeStore.setState({ estopActive: true, estopStatus: 'acknowledged' });
      mockedApi.resetEstop.mockRejectedValue(unavailable());

      await useAgentModeStore.getState().resetEstop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectEstopActive(s)).toBe(true);
      expect(selectStateUnknown(s)).toBe(true);
    });

    it('a successful reset ends the unknown', async () => {
      useAgentModeStore.setState({ estopActive: true, stateReachability: 'unreachable' });
      mockedApi.resetEstop.mockResolvedValue(makeState({ estopActive: false }));

      await useAgentModeStore.getState().resetEstop(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectStateUnknown(s)).toBe(false);
      expect(selectEstopActive(s)).toBe(false);
    });

    it('switching robot starts from the empty state, not from the old unknown', () => {
      useAgentModeStore.setState({
        stateReachability: 'unreachable',
        stateUnavailableReason: 'gone',
      });

      useAgentModeStore.getState().selectRobot('other-robot');

      const s = useAgentModeStore.getState();
      expect(selectStateUnknown(s)).toBe(false);
      expect(selectStateUnavailableReason(s)).toBeNull();
    });

    it('drops a 502 that lands after a robot switch', async () => {
      let fail: (error: unknown) => void = () => {};
      mockedApi.getState.mockReturnValue(
        new Promise<AgentModeState>((_resolve, reject) => {
          fail = reject;
        })
      );
      mockedApi.getScene.mockResolvedValue(null);

      const inFlight = useAgentModeStore.getState().fetchState(ROBOT_ID);
      useAgentModeStore.getState().selectRobot('other-robot');

      fail(unavailable());
      await inFlight;

      // The robot that went quiet is not the one on screen any more.
      expect(selectStateUnknown(useAgentModeStore.getState())).toBe(false);
    });

    it('takes a scene that did answer while the state read did not', async () => {
      mockedApi.getState.mockRejectedValue(unavailable());
      mockedApi.getScene.mockResolvedValue(makeScene());

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(selectStateUnknown(s)).toBe(true);
      expect(s.scene?.currentView).toBe('A table ahead.');
    });

    it('an unanswered scene read does not erase the scene we had', async () => {
      apply(event({ type: 'agent:scene:updated', scene: makeScene() }));
      mockedApi.getState.mockRejectedValue(unavailable());
      mockedApi.getScene.mockResolvedValue(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(useAgentModeStore.getState().scene?.currentView).toBe('A table ahead.');
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
      // no "E-Stop confirmed" in its conversation. Its own plan IS written into
      // the conversation as the command plus its acknowledgement (it was
      // started elsewhere, see `startedHere`), so the assertion is about the
      // stop, not about the conversation being empty.
      expect(s.estopActive).toBe(false);
      expect(s.plan?.status).toBe('running');
      expect(statuses()).toEqual(['pending', 'pending', 'pending']);
      expect(s.messages.map((m) => m.role)).toEqual(['user', 'agent']);
      expect(s.messages.some((m) => m.text.includes('E-Stop'))).toBe(false);
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

  // ==========================================================================
  // SELF: FRESHNESS & PROVENANCE
  //
  // The page reads state from the SERVER's mirror, which only moves when the
  // robot pushes. It has been seen reporting a different incarnation, battery
  // and uptime than the robot itself, so "where did this come from and when"
  // has to be recorded next to the snapshot — a cached number on a safety
  // surface must be distinguishable from a live one.
  // ==========================================================================
  describe('self freshness', () => {
    beforeEach(() => {
      useAgentModeStore.getState().selectRobot(ROBOT_ID);
    });

    // TASK-200. THE regression: `observedAt` used to be `Date.now()`, so every
    // poll reset the age to zero and a snapshot from a process that died an
    // hour ago rendered as "just now" — the staleness warning built for exactly
    // this could never fire.
    /** How old the store thinks the current self snapshot is, in ms. */
    const selfAgeMs = (): number => {
      const at = useAgentModeStore.getState().selfUpdatedAt;
      expect(at).not.toBeNull();
      return Date.now() - Date.parse(at as string);
    };

    it('dates a mirror read by the age the SERVER reports, not by the moment it fetched', async () => {
      // In the server's own frame the snapshot was ingested 68 minutes before
      // it answered. That AGE is the fact; the instant is in a clock this tab
      // does not share.
      mockedApi.getState.mockResolvedValueOnce(
        makeState({
          self: makeSelf(),
          stateMirroredAt: '2026-08-02T05:55:00.000Z',
          serverNow: '2026-08-02T07:03:00.000Z',
        })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.self?.incarnation).toBe(47);
      expect(s.selfLive).toBe(false);
      expect(s.selfAgeUnknown).toBe(false);
      expect(selfAgeMs()).toBeGreaterThanOrEqual(68 * 60_000);
      expect(selfAgeMs()).toBeLessThan(68 * 60_000 + 10_000);
    });

    // A reviewer's find: the age used to be `Date.now() - mirroredAt`, a
    // subtraction across two machines' clocks. A server two minutes AHEAD
    // re-hid a stale snapshot as "just now"; one 90 s behind painted every
    // fresh read as amber "cached" — the always-warning badge nobody reads.
    it('is unmoved by a server clock that disagrees with this browser’s', async () => {
      const skewMs = 2 * 60_000; // server ahead
      const serverNowMs = Date.now() + skewMs;
      mockedApi.getState.mockResolvedValueOnce(
        makeState({
          self: makeSelf(),
          // 30 s old, measured entirely in the server's frame.
          stateMirroredAt: new Date(serverNowMs - 30_000).toISOString(),
          serverNow: new Date(serverNowMs).toISOString(),
        })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(selfAgeMs()).toBeGreaterThanOrEqual(29_000);
      expect(selfAgeMs()).toBeLessThan(35_000);
    });

    it('and by one that runs behind — a fresh read stays fresh', async () => {
      const serverNowMs = Date.now() - 90_000; // server behind
      mockedApi.getState.mockResolvedValueOnce(
        makeState({
          self: makeSelf(),
          stateMirroredAt: new Date(serverNowMs - 2_000).toISOString(),
          serverNow: new Date(serverNowMs).toISOString(),
        })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(selfAgeMs()).toBeLessThan(10_000);
    });

    // A reviewer's find: `mirroredAt` moves on ANY ingested event, so a block
    // event re-dated a `self` it never touched — and only ever in the direction
    // of looking younger.
    it('dates the self by the last SNAPSHOT, not by the last event of any kind', async () => {
      mockedApi.getState.mockResolvedValueOnce(
        makeState({
          self: makeSelf(),
          // The agent was alive 2 s ago (a block event)…
          mirroredAt: '2026-08-02T07:02:58.000Z',
          // …but what it last SAID about itself is half an hour old.
          stateMirroredAt: '2026-08-02T06:33:00.000Z',
          serverNow: '2026-08-02T07:03:00.000Z',
        })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(useAgentModeStore.getState().selfAgeUnknown).toBe(false);
      expect(selfAgeMs()).toBeGreaterThanOrEqual(30 * 60_000);
    });

    it('calls the age UNKNOWN when the server reports none, never "just now"', async () => {
      mockedApi.getState.mockResolvedValueOnce(makeState({ self: makeSelf() }));
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      const s = useAgentModeStore.getState();
      expect(s.self?.incarnation).toBe(47);
      expect(s.selfUpdatedAt).toBeNull();
      // The distinguishing bit: a snapshot DID arrive, its age is not knowable.
      expect(s.selfAgeUnknown).toBe(true);
    });

    it('an explicit null stateMirroredAt is the same unknown age as an absent one', async () => {
      mockedApi.getState.mockResolvedValueOnce(
        makeState({ self: makeSelf(), stateMirroredAt: null, serverNow: '2026-08-02T07:03:00.000Z' })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(useAgentModeStore.getState().selfUpdatedAt).toBeNull();
      expect(useAgentModeStore.getState().selfAgeUnknown).toBe(true);
    });

    it('will not date the self by proof-of-life alone', async () => {
      // A server that reports only `mirroredAt` cannot say how old the SELF is,
      // and `mirroredAt` is always the younger of the two. Guessing with it
      // would understate the age — the one direction this must never fail in.
      mockedApi.getState.mockResolvedValueOnce(
        makeState({ self: makeSelf(), mirroredAt: '2026-08-02T07:02:59.000Z' })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(useAgentModeStore.getState().selfAgeUnknown).toBe(true);
    });

    it('falls back to the server’s raw instant when it reports no frame', async () => {
      // A pre-`serverNow` server. Its instant is all there is, and it still
      // beats stamping the fetch time.
      const takenAt = new Date(Date.now() - 5 * 60_000).toISOString();
      mockedApi.getState.mockResolvedValueOnce(
        makeState({ self: makeSelf(), stateMirroredAt: takenAt })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(useAgentModeStore.getState().selfUpdatedAt).toBe(takenAt);
      expect(useAgentModeStore.getState().selfAgeUnknown).toBe(false);
    });

    // ------------------------------------------------------------------
    // A snapshot from a DIFFERENT process
    // ------------------------------------------------------------------

    /** The robot answers us directly once, so `selfLiveBootId` is set. */
    const liveAnswerFrom = (bootId: string) =>
      apply(event({ type: 'agent:state:changed', state: makeState({ self: makeSelf({ bootId }) }) }));

    const mirrorRead = async (bootId: string, ageMs: number) => {
      const serverNow = '2026-08-02T07:03:00.000Z';
      mockedApi.getState.mockResolvedValueOnce(
        makeState({
          self: makeSelf({ bootId }),
          stateMirroredAt: new Date(Date.parse(serverNow) - ageMs).toISOString(),
          serverNow,
        })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);
      await useAgentModeStore.getState().fetchState(ROBOT_ID);
    };

    it('names an OLD mirror from another bootId as a different process', async () => {
      // The observed defect: a duplicate agent booted, pushed one state event,
      // died on EADDRINUSE, and its identity sat in the mirror for 68 minutes.
      liveAnswerFrom('b-50a41c128583');
      await mirrorRead('b-56cb257f5ffc', 68 * 60_000);

      expect(selectSelfSuperseded(useAgentModeStore.getState())).toBe(true);
    });

    // A reviewer's find: `selectRobot` no-ops for an unchanged robot id, so
    // `selfLiveBootId` survives leaving /agent and coming back. If the agent
    // restarted in between (watch mode does that on every saved file), the
    // FRESH mirror read that follows carries the new boot — and used to be
    // flagged, pointing the warning at the live process while treating the dead
    // one as the reference.
    it('does not flag a FRESH mirror from another bootId — that is the restart', async () => {
      liveAnswerFrom('b-before-the-restart');
      // Leaving the page and coming back re-derives the same robot id, so the
      // store is NOT reset.
      useAgentModeStore.getState().selectRobot(ROBOT_ID);
      await mirrorRead('b-after-the-restart', 3_000);

      const s = useAgentModeStore.getState();
      expect(s.self?.bootId).toBe('b-after-the-restart');
      expect(selectSelfSuperseded(s)).toBe(false);
      // …and it is not being sold as stale either.
      expect(selfAgeMs()).toBeLessThan(10_000);
    });

    it('treats an undatable mirror from another bootId as superseded', async () => {
      // No age at all: the bootId is then the only evidence there is, and the
      // quiet reading is the dangerous one.
      liveAnswerFrom('b-A');
      mockedApi.getState.mockResolvedValueOnce(makeState({ self: makeSelf({ bootId: 'b-B' }) }));
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(selectSelfSuperseded(useAgentModeStore.getState())).toBe(true);
    });

    it('clears the flag as soon as the robot answers for itself', async () => {
      liveAnswerFrom('b-A');
      await mirrorRead('b-B', 68 * 60_000);
      expect(selectSelfSuperseded(useAgentModeStore.getState())).toBe(true);

      liveAnswerFrom('b-B');

      expect(selectSelfSuperseded(useAgentModeStore.getState())).toBe(false);
    });


    it('keeps stamping a LIVE answer with now, mirroredAt or not', async () => {
      // The toggle/estop-reset/identity responses are proxied straight through
      // to the robot, so "when I received it" IS when the robot said it.
      const before = Date.now();
      mockedApi.toggle.mockResolvedValueOnce(makeState({ self: makeSelf() }));

      await useAgentModeStore.getState().toggle(ROBOT_ID, true);

      const s = useAgentModeStore.getState();
      expect(s.selfLive).toBe(true);
      expect(s.selfAgeUnknown).toBe(false);
      expect(Date.parse(s.selfUpdatedAt as string)).toBeGreaterThanOrEqual(before);
    });

    it('marks a pushed snapshot as live and keeps the event timestamp', () => {
      apply(event({ type: 'agent:state:changed', state: makeState({ self: makeSelf() }) }));

      const s = useAgentModeStore.getState();
      expect(s.selfLive).toBe(true);
      // The robot's own moment, not the moment this tab happened to render.
      expect(s.selfUpdatedAt).toBe(TS);
    });

    it('leaves the stamp alone when an agent reports no self at all', () => {
      apply(event({ type: 'agent:state:changed', state: makeState({ self: makeSelf() }) }));
      apply(
        event({
          type: 'agent:state:changed',
          state: makeState(),
          timestamp: '2026-07-25T11:00:00.000Z',
        })
      );

      // An older agent that omits `self` says nothing about the self we hold —
      // and nothing about how old it is either.
      expect(useAgentModeStore.getState().selfUpdatedAt).toBe(TS);
    });

    // TASK-200. The observed defect: a duplicate robot-agent booted, pushed one
    // state event, died on EADDRINUSE — and the console showed ITS incarnation
    // as the running robot's. A different bootId is not a degree of staleness.
    it('knows a mirrored snapshot from a different process than last answered', async () => {
      mockedApi.toggle.mockResolvedValueOnce(makeState({ self: makeSelf({ bootId: 'b-live' }) }));
      await useAgentModeStore.getState().toggle(ROBOT_ID, true);
      expect(selectSelfSuperseded(useAgentModeStore.getState())).toBe(false);

      mockedApi.getState.mockResolvedValueOnce(
        makeState({ self: makeSelf({ bootId: 'b-dead', incarnation: 200 }) })
      );
      mockedApi.getScene.mockResolvedValueOnce(null);
      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(selectSelfSuperseded(useAgentModeStore.getState())).toBe(true);
    });

    it('does not cry "different process" over a mirror read of the same boot', async () => {
      mockedApi.toggle.mockResolvedValueOnce(makeState({ self: makeSelf({ bootId: 'b-live' }) }));
      await useAgentModeStore.getState().toggle(ROBOT_ID, true);

      mockedApi.getState.mockResolvedValueOnce(makeState({ self: makeSelf({ bootId: 'b-live' }) }));
      mockedApi.getScene.mockResolvedValueOnce(null);
      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(selectSelfSuperseded(useAgentModeStore.getState())).toBe(false);
    });

    it('says nothing about processes before the robot has answered us once', async () => {
      // With no live answer on record there is nothing to compare against, and
      // an unproven accusation on a safety surface is its own kind of noise.
      // Driven through the mirror path, because that is where the claim is
      // decided — reading the flag back out of a hand-written state proves
      // nothing about how it got set.
      mockedApi.getState.mockResolvedValueOnce(makeState({ self: makeSelf({ bootId: 'b-dead' }) }));
      mockedApi.getScene.mockResolvedValueOnce(null);

      await useAgentModeStore.getState().fetchState(ROBOT_ID);

      expect(useAgentModeStore.getState().selfLive).toBe(false);
      expect(selectSelfSuperseded(useAgentModeStore.getState())).toBe(false);
    });
  });

  // ==========================================================================
  // DURABLE MEMORY (TASK-197) — counts only, and "unknown" is never "empty"
  // ==========================================================================
  describe('memory digest', () => {
    beforeEach(() => {
      useAgentModeStore.getState().selectRobot(ROBOT_ID);
    });

    it('stores the digest an agent:memory:updated event carries', () => {
      apply(event({ type: 'agent:memory:updated', memory: makeDigest() }));

      expect(useAgentModeStore.getState().memory?.memoryEntries).toBe(3);
    });

    it('keeps the digest it has when the fetch cannot answer', async () => {
      apply(event({ type: 'agent:memory:updated', memory: makeDigest() }));
      mockedApi.getMemory.mockRejectedValueOnce(apiError(404, 'no memory workspace'));

      await useAgentModeStore.getState().fetchMemory(ROBOT_ID);

      const s = useAgentModeStore.getState();
      // Unreadable is not empty, and it is not an error the operator can act
      // on either — the panel must not flip to "remembers nothing".
      expect(s.memory?.memoryEntries).toBe(3);
      expect(s.error).toBeNull();
    });

    it('drops a digest that arrives after a robot switch', async () => {
      let resolve: (digest: AgentMemoryDigest) => void = () => {};
      mockedApi.getMemory.mockReturnValueOnce(
        new Promise<AgentMemoryDigest>((r) => {
          resolve = r;
        })
      );

      const inFlight = useAgentModeStore.getState().fetchMemory(ROBOT_ID);
      useAgentModeStore.getState().selectRobot('other-robot');
      resolve(makeDigest());
      await inFlight;

      expect(useAgentModeStore.getState().memory).toBeNull();
    });
  });

  // ==========================================================================
  // ROBOT MAP (TASK-206/207) — the grid, peers and keep-outs the map tab draws
  // ==========================================================================
  describe('fetchRobotMap', () => {
    const MAP = {
      ok: true as const,
      frame: 'odom' as const,
      frameId: { kind: 'sim' as const, id: 'room' },
      grid: null,
      pose: null,
      place: null,
      registered: false,
      registrationReason: null,
      keepouts: [],
      peers: [],
      peersDropped: 0,
      peersEnabled: true,
    };

    beforeEach(() => {
      useAgentModeStore.getState().selectRobot(ROBOT_ID);
    });

    it('stores a map with its read time', async () => {
      mockedApi.getMap.mockResolvedValueOnce(MAP);
      await useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
      const s = useAgentModeStore.getState();
      expect(s.robotMap).toEqual(MAP);
      expect(s.robotMapStatus).toBe('ok');
      expect(s.robotMapError).toBeNull();
      expect(s.robotMapFetchedAt).not.toBeNull();
    });

    it('records a 404 as "disabled" — the robot\u2019s answer — and clears the map', async () => {
      mockedApi.getMap.mockResolvedValueOnce(MAP);
      await useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
      mockedApi.getMap.mockRejectedValueOnce(apiError(404, 'occupancy map is disabled on this agent (AGENT_MAP_ENABLED)'));
      await useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
      const s = useAgentModeStore.getState();
      expect(s.robotMap).toBeNull();
      expect(s.robotMapStatus).toBe('disabled');
      expect(s.robotMapError).toContain('AGENT_MAP_ENABLED');
      expect(s.error).toBeNull(); // no banner: nothing is wrong, the robot just has no map
    });

    it('records any other failure as "unavailable" and KEEPS the last map', async () => {
      mockedApi.getMap.mockResolvedValueOnce(MAP);
      await useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
      mockedApi.getMap.mockRejectedValueOnce(apiError(502, 'ECONNREFUSED'));
      await useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
      const s = useAgentModeStore.getState();
      expect(s.robotMap).toEqual(MAP);
      expect(s.robotMapStatus).toBe('unavailable');
      expect(s.robotMapError).toBe('ECONNREFUSED');
    });

    it('drops a map that arrives after a robot switch', async () => {
      let resolve: (m: typeof MAP) => void = () => {};
      mockedApi.getMap.mockReturnValueOnce(new Promise<typeof MAP>((r) => (resolve = r)));
      const inFlight = useAgentModeStore.getState().fetchRobotMap(ROBOT_ID);
      useAgentModeStore.getState().selectRobot('other-robot');
      resolve(MAP);
      await inFlight;
      expect(useAgentModeStore.getState().robotMap).toBeNull();
      expect(useAgentModeStore.getState().robotMapStatus).toBe('idle');
    });
  });

  // ==========================================================================
  // IDENTITY (TASK-198) — the naming ritual's non-conversational door
  // ==========================================================================
  describe('submitIdentity', () => {
    beforeEach(() => {
      useAgentModeStore.getState().selectRobot(ROBOT_ID);
    });

    it('adopts the self the robot reports back, not what was typed', async () => {
      mockedApi.writeIdentity.mockResolvedValueOnce({
        ok: true,
        self: makeSelf({ name: 'Nova', bootstrapRequired: false, operator: 'Sam' }),
      });

      const ok = await useAgentModeStore.getState().submitIdentity(ROBOT_ID, { Name: 'Nova' });

      const s = useAgentModeStore.getState();
      expect(ok).toBe(true);
      expect(s.self?.name).toBe('Nova');
      expect(s.self?.operator).toBe('Sam');
      expect(s.selfLive).toBe(true);
      expect(s.isSavingIdentity).toBe(false);
    });

    it('reports a refusal instead of pretending the robot was renamed', async () => {
      useAgentModeStore.setState({ self: makeSelf() });
      mockedApi.writeIdentity.mockRejectedValueOnce(apiError(400, 'Name must be a string.'));

      const ok = await useAgentModeStore.getState().submitIdentity(ROBOT_ID, { Name: 'Nova' });

      const s = useAgentModeStore.getState();
      expect(ok).toBe(false);
      expect(s.error).toBe('Name must be a string.');
      expect(s.self?.name).toBe('G1-EDU-Bot');
      expect(s.isSavingIdentity).toBe(false);
    });
  });
});
