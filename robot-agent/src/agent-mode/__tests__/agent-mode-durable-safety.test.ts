/**
 * @file agent-mode-durable-safety.test.ts
 * @description Agent Mode's half of TASK-196: it writes every safety transition
 *              through to the durable snapshot, comes back latched and damped
 *              after a restart, and reports what the boot inherited so the panel
 *              can offer one click to clear it.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { G1_FSM_DAMP } from '../block-executor.js';
import { RangeSensor } from '../range.js';
import type { Planner } from '../planner.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient } from '../vision.js';
import type { AgentModeEvent } from '../types.js';
import type { RobotStateManager } from '../../robot/state.js';
import {
  defaultPersistedAgentState,
  type PersistedAgentState,
} from '../../robot/StatePersistence.js';
import type { IncarnationOpenResult } from '../incarnations.js';

interface Harness {
  controller: AgentModeController;
  events: AgentModeEvent[];
  /** Every `setAgentSafetyState` patch, oldest first. */
  patches: Array<Partial<PersistedAgentState>>;
  /** The durable snapshot as the patches have left it. */
  persisted: () => PersistedAgentState;
}

/**
 * @param restored what the state manager read off disk (null = fresh boot)
 * @param opts.partialStateManager omit the TASK-196 methods entirely, the way an
 *        older test double does — the controller must not fall over on that.
 */
function makeHarness(
  restored: PersistedAgentState | null = null,
  opts: { partialStateManager?: boolean; estopResetResult?: boolean } = {}
): Harness {
  const events: AgentModeEvent[] = [];
  const patches: Array<Partial<PersistedAgentState>> = [];
  let snapshot: PersistedAgentState = { ...defaultPersistedAgentState() };

  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock: new ControlOwnerLock(),
    planner: { plan: async () => ({ blocks: [], fallback: false, attempts: 1 }) } as unknown as Planner,
    mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {} } as unknown as ServerMirror,
    vision: { observe: async () => ({ currentView: '', entities: [], personVisible: false, raw: '{}', degraded: false }) } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    loco: {
      move: async () => ({ ok: true }),
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    sleep: async () => {},
    now: () => 1e12,
  });

  const base = {
    triggerEmergencyStop: () => {},
    resetEmergencyStop: () => opts.estopResetResult ?? true,
    isEStopTriggered: () => false,
    isTeleopActive: () => false,
    isVLAActive: () => false,
  };
  const durable = {
    getRestoredAgentState: () => (restored ? { ...restored } : null),
    setAgentSafetyState: (patch: Partial<PersistedAgentState>) => {
      patches.push(patch);
      snapshot = { ...snapshot, ...patch };
    },
  };

  controller.attach(
    (opts.partialStateManager ? base : { ...base, ...durable }) as unknown as RobotStateManager
  );
  controller.subscribe((e) => events.push(e));

  return { controller, events, patches, persisted: () => snapshot };
}

function restoredState(overrides: Partial<PersistedAgentState>): PersistedAgentState {
  return { ...defaultPersistedAgentState(), ...overrides };
}

const openResult = (fromCrash: boolean): IncarnationOpenResult => ({
  bootId: 'b-2',
  startedAt: '2026-08-02T08:00:00.000Z',
  seq: 2,
  seqExact: true,
  fromCrash,
  previous: fromCrash
    ? {
        bootId: 'b-1',
        startedAt: '2026-08-02T07:00:00.000Z',
        endedAt: null,
        exit: null,
        lastPlace: null,
        estopLatched: false,
        damped: false,
      }
    : null,
});

describe('AgentModeController — restoring durable safety state', () => {
  it('comes back latched when the latch was held at shutdown', () => {
    const h = makeHarness(
      restoredState({
        estopLatched: true,
        estopReason: 'Agent Mode E-Stop: STOPP',
        estopAt: '2026-08-02T07:30:00.000Z',
      })
    );

    const state = h.controller.getState();
    expect(state.estopActive).toBe(true);
    expect(state.recovered).toEqual({
      fromCrash: false,
      estopLatched: true,
      at: expect.any(String),
    });
    expect(h.controller.isCrashAcknowledged()).toBe(false);
  });

  it('comes back damped when the base was damped at shutdown', () => {
    const h = makeHarness(restoredState({ damped: true, lastFsmId: G1_FSM_DAMP }));

    const state = h.controller.getState();
    expect(state.damped).toBe(true);
    expect(state.fsmId).toBe(G1_FSM_DAMP);
    // Damped alone is not something to acknowledge — it is not a recovery.
    expect(state.recovered).toBeNull();
  });

  it('refuses commands after coming back latched', async () => {
    const h = makeHarness(restoredState({ estopLatched: true, estopReason: 'STOPP' }));

    const result = await h.controller.submitCommand({ text: 'lauf nach vorne' });

    expect(result.accepted).toBe(false);
    expect(result.outcome).toBe('estop_latched');
  });

  it('reports nothing to acknowledge after a clean boot with no latch', () => {
    const h = makeHarness(restoredState({}));

    expect(h.controller.getState().recovered).toBeNull();
    expect(h.controller.isCrashAcknowledged()).toBe(true);
  });

  it('tolerates a state manager that knows nothing about durable state', () => {
    const h = makeHarness(null, { partialStateManager: true });

    expect(() => h.controller.recordBoot(openResult(true))).not.toThrow();
    expect(h.controller.getState().estopActive).toBe(false);
    expect(h.controller.getState().recovered?.fromCrash).toBe(true);
  });
});

describe('AgentModeController — the incarnation lineage', () => {
  it('reports an unclean shutdown and emits a state change for it', () => {
    const h = makeHarness();
    h.controller.recordBoot(openResult(true));

    expect(h.controller.getState().recovered).toEqual({
      fromCrash: true,
      estopLatched: false,
      at: '2026-08-02T08:00:00.000Z',
    });
    expect(h.events.some((e) => e.type === 'agent:state:changed')).toBe(true);
    expect(h.controller.isCrashAcknowledged()).toBe(false);
  });

  it('says nothing after a clean shutdown', () => {
    const h = makeHarness();
    h.controller.recordBoot(openResult(false));

    expect(h.controller.getState().recovered).toBeNull();
    expect(h.events).toHaveLength(0);
  });

  it('records the boot id in the durable snapshot', () => {
    const h = makeHarness();
    h.controller.recordBoot(openResult(false));

    expect(h.persisted().bootId).toBe('b-2');
  });

  it('hands the shutdown hook the state to close the lineage with', async () => {
    const h = makeHarness();
    await h.controller.estop('operator');

    expect(h.controller.incarnationSnapshot()).toEqual({ estopLatched: true, damped: true });
  });
});

describe('AgentModeController — writing transitions through', () => {
  it('persists the latch, its reason and the damped base on an E-Stop', async () => {
    const h = makeHarness();

    await h.controller.estop('stop word "STOPP" received');

    const snapshot = h.persisted();
    expect(snapshot.estopLatched).toBe(true);
    expect(snapshot.estopReason).toBe('stop word "STOPP" received');
    expect(snapshot.estopAt).not.toBeNull();
    expect(snapshot.damped).toBe(true);
    expect(snapshot.lastFsmId).toBe(G1_FSM_DAMP);
  });

  it('latches durably BEFORE the hardware round-trip', async () => {
    const h = makeHarness();

    await h.controller.estop('operator');

    // The very first write must already carry the latch: a process that dies
    // between the latch and the sidecar's answer still comes back latched.
    expect(h.patches[0]?.estopLatched).toBe(true);
  });

  it('clears the latch — but NOT the damped base — on a reset', async () => {
    const h = makeHarness();
    await h.controller.estop('operator');

    h.controller.resetEstop();

    const snapshot = h.persisted();
    expect(snapshot.estopLatched).toBe(false);
    expect(snapshot.estopReason).toBeNull();
    expect(snapshot.estopAt).toBeNull();
    // Re-arming the base is `posture stand`, never a side effect of a reset.
    expect(snapshot.damped).toBe(true);
    expect(snapshot.lastFsmId).toBe(G1_FSM_DAMP);
  });

  it('keeps the latch persisted when the SafetyMonitor refuses the reset', async () => {
    const h = makeHarness(null, { estopResetResult: false });
    await h.controller.estop('operator');
    const before = h.persisted();

    h.controller.resetEstop();

    expect(h.persisted().estopLatched).toBe(true);
    expect(h.persisted().estopReason).toBe(before.estopReason);
    expect(h.controller.getState().estopActive).toBe(true);
  });

  it('treats the reset as the operator acknowledging what the boot inherited', () => {
    const h = makeHarness(restoredState({ estopLatched: true, estopReason: 'STOPP' }));
    h.controller.recordBoot(openResult(true));
    expect(h.controller.getState().recovered).not.toBeNull();

    h.controller.resetEstop();

    expect(h.controller.getState().recovered).toBeNull();
    expect(h.controller.isCrashAcknowledged()).toBe(true);
  });

  it('never persists `place` — TASK-195 owns it', async () => {
    const h = makeHarness();
    await h.controller.estop('operator');
    h.controller.resetEstop();

    expect(h.patches.every((p) => !('place' in p))).toBe(true);
  });
});

describe('AgentModeController — the restored latch is the same latch', () => {
  it('survives a full stop → persist → restart → refuse cycle', async () => {
    // Boot 1: an operator stops the robot.
    const first = makeHarness();
    await first.controller.estop('operator pressed STOPP');
    const onDisk = first.persisted();

    // Boot 2: a brand-new controller reads exactly that snapshot back.
    const second = makeHarness(onDisk);
    second.controller.recordBoot(openResult(true));

    const state = second.controller.getState();
    expect(state.estopActive).toBe(true);
    expect(state.damped).toBe(true);
    expect(state.recovered).toEqual({
      fromCrash: true,
      estopLatched: true,
      at: expect.any(String),
    });

    const refused = await second.controller.submitCommand({ text: 'lauf los' });
    expect(refused.accepted).toBe(false);

    // …until a human clears it.
    second.controller.resetEstop();
    expect(second.controller.getState().estopActive).toBe(false);
    expect(second.controller.getState().recovered).toBeNull();
  });
});
