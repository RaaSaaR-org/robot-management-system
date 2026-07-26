/**
 * @file agent-mode-controller.test.ts
 * @description Plan lifecycle: an E-Stop mid-plan leaves the plan `aborted`
 *              with every pending block `skipped`; human teleop preempts a
 *              running plan; Agent Mode refuses to start while VLA owns control.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { G1_FSM_DAMP } from '../block-executor.js';
import type { Planner, PlannedBlock } from '../planner.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { AgentModeEvent } from '../types.js';
import type { RobotStateManager } from '../../robot/state.js';

const EMPTY_VIEW: VisionObservation = {
  currentView: 'ein leerer Raum',
  entities: [],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Harness {
  controller: AgentModeController;
  lock: ControlOwnerLock;
  events: AgentModeEvent[];
  loggedBlocks: Array<{ command: string; kind: string; status: string }>;
  fsms: number[];
  actions: string[];
  estopCalls: Array<{ by: string; reason: string }>;
  /** How often the SafetyMonitor's own latch was asked to clear. */
  estopResets: number;
}

type LocoStub = { ok: boolean; error?: string };

function makeController(
  blocks: PlannedBlock[],
  opts: {
    say?: (text: string) => Promise<boolean>;
    lock?: ControlOwnerLock;
    observation?: VisionObservation;
    plan?: Planner['plan'];
    /** Override `/loco/move` — used to make a motion block fail. */
    move?: () => Promise<LocoStub>;
    /** Override `/loco/action` results — used to make StopMove fail. */
    action?: (name: string) => Promise<LocoStub>;
    /** Override `/loco/fsm` results — used to make Damp fail. */
    fsm?: (id: number) => Promise<LocoStub>;
    /** What `robotStateManager.resetEmergencyStop()` answers. */
    estopResetResult?: boolean;
    /** What `robotStateManager.isEStopTriggered()` answers. */
    safetyLatched?: () => boolean;
    /** Runs inside `ServerMirror.emit` — used to crash the plan from outside. */
    onMirrorEmit?: (event: AgentModeEvent) => void;
    idleWatchIntervalMs?: number;
  } = {}
): Harness {
  const lock = opts.lock ?? new ControlOwnerLock();
  const events: AgentModeEvent[] = [];
  const loggedBlocks: Harness['loggedBlocks'] = [];
  const fsms: number[] = [];
  const actions: string[] = [];
  const estopCalls: Harness['estopCalls'] = [];
  const resets = { count: 0 };

  const planner = {
    plan: opts.plan ?? (async () => ({ blocks, fallback: false, attempts: 1 })),
  } as unknown as Planner;

  const mirror = {
    emit: (event: AgentModeEvent) => opts.onMirrorEmit?.(event),
    push: async () => {},
    logBlock: async (command: string, block: { kind: string; status: string }) => {
      loggedBlocks.push({ command, kind: block.kind, status: block.status });
    },
  } as unknown as ServerMirror;

  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock,
    planner,
    mirror,
    vision: { observe: async () => opts.observation ?? EMPTY_VIEW } as unknown as VisionClient,
    loco: {
      move: opts.move ?? (async () => ({ ok: true })),
      action: async (name) => {
        actions.push(name);
        return opts.action ? opts.action(name) : { ok: true };
      },
      fsm: async (id) => {
        fsms.push(id);
        return opts.fsm ? opts.fsm(id) : { ok: true };
      },
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    ...(opts.say ? { say: opts.say } : {}),
    ...(opts.idleWatchIntervalMs === undefined
      ? {}
      : { idleWatchIntervalMs: opts.idleWatchIntervalMs }),
    sleep: async () => {},
    now: () => 1e12,
  });

  controller.attach({
    triggerEmergencyStop: (by: string, reason: string) => estopCalls.push({ by, reason }),
    resetEmergencyStop: () => {
      resets.count++;
      return opts.estopResetResult ?? true;
    },
    isEStopTriggered: () => opts.safetyLatched?.() ?? false,
    isTeleopActive: () => false,
    isVLAActive: () => false,
  } as unknown as RobotStateManager);

  controller.subscribe((e) => events.push(e));

  return {
    controller,
    lock,
    events,
    loggedBlocks,
    fsms,
    actions,
    estopCalls,
    get estopResets() {
      return resets.count;
    },
  };
}

const speakBlock = (text: string): PlannedBlock => ({ kind: 'speak', params: { text } });

describe('AgentModeController — happy path', () => {
  it('runs the planned blocks in order and finishes `done`', async () => {
    const h = makeController([speakBlock('eins'), speakBlock('zwei')]);

    const result = await h.controller.submitCommand({ text: 'sag was' });
    await h.controller.whenIdle();

    expect(result.accepted).toBe(true);
    expect(result.planId).toBeTruthy();

    const plan = h.controller.getState().plan!;
    expect(plan.status).toBe('done');
    expect(plan.blocks.map((b) => b.status)).toEqual(['done', 'done']);
    expect(plan.cursor).toBe(-1);
    // The lock is handed back so teleop/VLA can take over.
    expect(h.lock.get()).toBe('idle');
  });

  it('emits the contract event sequence', async () => {
    const h = makeController([speakBlock('hallo')]);

    await h.controller.submitCommand({ text: 'sag hallo' });
    await h.controller.whenIdle();

    expect(h.events.map((e) => e.type)).toEqual([
      'agent:plan:started',
      'agent:plan:updated',
      'agent:block:started',
      'agent:block:finished',
      'agent:plan:finished',
    ]);
  });

  it('writes one compliance record per finished block', async () => {
    const h = makeController([speakBlock('eins'), speakBlock('zwei')]);

    await h.controller.submitCommand({ text: 'sag was' });
    await h.controller.whenIdle();

    expect(h.loggedBlocks).toEqual([
      { command: 'sag was', kind: 'speak', status: 'done' },
      { command: 'sag was', kind: 'speak', status: 'done' },
    ]);
  });

  it('marks the remaining blocks `skipped` when one fails', async () => {
    const h = makeController([
      { kind: 'posture', params: { pose: 'nonsense' } },
      speakBlock('nie erreicht'),
    ]);

    await h.controller.submitCommand({ text: 'mach was' });
    await h.controller.whenIdle();

    const plan = h.controller.getState().plan!;
    expect(plan.status).toBe('failed');
    expect(plan.blocks.map((b) => b.status)).toEqual(['failed', 'skipped']);
  });
});

describe('AgentModeController — E-Stop', () => {
  it('aborts the plan mid-flight and skips every pending block', async () => {
    const gate = deferred<boolean>();
    let sayCalls = 0;
    const h = makeController(
      [speakBlock('eins'), speakBlock('zwei'), speakBlock('drei')],
      {
        say: async () => {
          sayCalls++;
          // Only the first block hangs; the rest would run instantly.
          return sayCalls === 1 ? gate.promise : true;
        },
      }
    );

    await h.controller.submitCommand({ text: 'sag drei Sachen' });
    // Let the planner resolve and block 1 get into flight.
    await vi.waitFor(() => expect(sayCalls).toBe(1));

    const estop = await h.controller.estop('operator pressed STOPP');
    gate.resolve(true);
    await h.controller.whenIdle();

    expect(estop).toEqual({ ok: true, stopped: true, delivered: true });

    const state = h.controller.getState();
    expect(state.estopActive).toBe(true);
    expect(state.plan!.status).toBe('aborted');
    expect(state.plan!.blocks.map((b) => b.status)).toEqual(['aborted', 'skipped', 'skipped']);
    // Only the first block ever ran.
    expect(sayCalls).toBe(1);
  });

  it('does not rewrite a plan that already finished', async () => {
    // Pressing STOPP after a run completed must still latch and damp, but it
    // must not relabel the finished plan as "aborted after 6 of 6 blocks" —
    // that claims an abort that never happened.
    const h = makeController([speakBlock('fertig')]);

    await h.controller.submitCommand({ text: 'sag was' });
    await h.controller.whenIdle();
    expect(h.controller.getState().plan!.status).toBe('done');

    const estop = await h.controller.estop('operator pressed STOPP');

    expect(estop).toEqual({ ok: true, stopped: false, delivered: true });
    const state = h.controller.getState();
    expect(state.plan!.status).toBe('done');
    expect(state.plan!.blocks.map((b) => b.status)).toEqual(['done']);
    // The robot is still latched and damped — that part is unconditional.
    expect(state.estopActive).toBe(true);
    expect(h.actions).toContain('stop');
    expect(h.fsms).toContain(G1_FSM_DAMP);
  });

  it('stops and damps the base, and delegates to the existing safety path', async () => {
    const h = makeController([speakBlock('eins')]);

    await h.controller.estop('operator pressed STOPP');

    expect(h.actions).toEqual(['stop']);
    expect(h.fsms).toEqual([G1_FSM_DAMP]);
    expect(h.estopCalls).toEqual([
      { by: 'local', reason: 'Agent Mode E-Stop: operator pressed STOPP' },
    ]);
  });

  it('treats a stop word as an E-Stop without going near the planner', async () => {
    const plan = vi.fn(async () => ({ blocks: [speakBlock('nie')], fallback: false, attempts: 1 }));
    const h = makeController([], { plan });

    const result = await h.controller.submitCommand({ text: 'STOPP!' });

    expect(result.accepted).toBe(true);
    expect(result.planId).toBeUndefined();
    expect(plan).not.toHaveBeenCalled();
    expect(h.controller.getState().estopActive).toBe(true);
    expect(h.fsms).toEqual([G1_FSM_DAMP]);
  });

  // `halt` is the shipped default stop word AND the most common German modal
  // particle. Matching it inside a sentence turned "geh halt zum Tisch" into a
  // latched E-Stop (StopMove + Damp) with the planner never called.
  describe('stop words match the whole utterance only', () => {
    const bare = ['stopp', 'STOPP!', ' Stopp. ', 'stop', 'halt', 'HALT!'];
    const sentences = [
      'Geh halt zum Tisch',
      'Dreh dich halt nach rechts',
      'Halt die Tasse fest',
      'Sag Stopp wenn du fertig bist',
      'stop looking at the table',
      'halt an und schau',
    ];

    it.each(bare)('treats %j as a stop word', (text) => {
      const h = makeController([]);
      expect(h.controller.isStopWord(text)).toBe(true);
    });

    it.each(sentences)('does NOT treat %j as a stop word', (text) => {
      const h = makeController([]);
      expect(h.controller.isStopWord(text)).toBe(false);
    });

    it('plans an ordinary command that merely contains "halt"', async () => {
      const plan = vi.fn(async () => ({
        blocks: [speakBlock('unterwegs')],
        fallback: false,
        attempts: 1,
      }));
      const h = makeController([], { plan });

      const result = await h.controller.submitCommand({ text: 'Geh halt zum Tisch' });
      await h.controller.whenIdle();

      expect(result.accepted).toBe(true);
      expect(result.planId).toBeTruthy();
      expect(plan).toHaveBeenCalledTimes(1);
      // No E-Stop: nothing was damped and the latch is clear.
      expect(h.controller.getState().estopActive).toBe(false);
      expect(h.fsms).toEqual([]);
      expect(h.actions).toEqual([]);
    });
  });

  it('refuses new commands while the E-Stop is latched, and accepts after a reset', async () => {
    const h = makeController([speakBlock('eins')]);
    await h.controller.estop('manual');

    const refused = await h.controller.submitCommand({ text: 'lauf los' });
    expect(refused.accepted).toBe(false);
    expect(refused.message).toMatch(/E-Stop is latched/);

    h.controller.resetEstop();
    const accepted = await h.controller.submitCommand({ text: 'lauf los' });
    await h.controller.whenIdle();
    expect(accepted.accepted).toBe(true);
  });

  it('reports stopped:false when nothing was running', async () => {
    const h = makeController([speakBlock('eins')]);
    expect(await h.controller.estop('preemptive')).toEqual({ ok: true, stopped: false, delivered: true });
  });

  // Review round 2: `estop()` hardcoded `ok: true` with no delivery claim, so a
  // StopMove/Damp the sidecar never acked was invisible in every E-Stop API
  // response — the UI rendered a completed stop about a base still executing up
  // to a minute of commanded velocity.
  describe('delivery honesty', () => {
    it('reports delivered:false naming StopMove when the sidecar rejects the stop', async () => {
      const h = makeController([], {
        action: async () => ({ ok: false, error: 'sidecar /loco/action unreachable' }),
      });
      const result = await h.controller.estop('operator pressed STOPP');
      expect(result.ok).toBe(true);
      expect(result.delivered).toBe(false);
      expect(result.deliveryError).toMatch(/StopMove: sidecar \/loco\/action unreachable/);
      // The latch is set regardless — a delivery failure never unlatches.
      expect(h.controller.getState().estopActive).toBe(true);
    });

    it('reports delivered:false naming Damp when the FSM call fails', async () => {
      const h = makeController([], {
        fsm: async () => ({ ok: false, error: 'rpc code 3104' }),
      });
      const result = await h.controller.estop('operator pressed STOPP');
      expect(result.delivered).toBe(false);
      expect(result.deliveryError).toMatch(/Damp: rpc code 3104/);
    });
  });

  // Review round 2: an E-Stop landing during the planner's LLM round-trip
  // finalized the (block-less) plan and emitted `finished` — then the resolving
  // planner grafted fresh `pending` blocks onto the dead plan and emitted
  // `agent:plan:updated` AFTER `finished`, so the mirror and the UI forever
  // showed an aborted plan whose blocks never left `pending`.
  it('leaves a plan finalized by an E-Stop untouched when the planner resolves late', async () => {
    const gate = deferred<{ blocks: PlannedBlock[]; fallback: boolean; attempts: number }>();
    const h = makeController([], { plan: () => gate.promise });

    await h.controller.submitCommand({ text: 'geh zum Tisch' });
    await h.controller.estop('operator pressed STOPP');
    const finishedIdx = h.events.findIndex((e) => e.type === 'agent:plan:finished');
    expect(finishedIdx).toBeGreaterThanOrEqual(0);

    gate.resolve({
      blocks: [{ kind: 'walk', params: { distanceM: 1, direction: 'forward' } }],
      fallback: false,
      attempts: 1,
    });
    await h.controller.whenIdle();

    const plan = h.controller.getState().plan!;
    expect(plan.status).toBe('aborted');
    // The late planner output was never grafted onto the dead plan…
    expect(plan.blocks).toEqual([]);
    // …and nothing about this plan was emitted after its `finished`.
    const after = h.events.slice(finishedIdx + 1).filter((e) => e.type.startsWith('agent:plan:'));
    expect(after).toEqual([]);
  });

  // Finding 1: clearing the latch while the E-Stopped block was still awaiting
  // used to let that block run to completion, re-label the plan `done` and emit
  // a SECOND agent:plan:finished — an emergency stop recorded as a success.
  describe('a plan an E-Stop terminated stays terminated', () => {
    it('is not resurrected by a latch reset that lands mid-block', async () => {
      const gate = deferred<boolean>();
      let sayCalls = 0;
      const h = makeController([speakBlock('eins'), speakBlock('zwei')], {
        say: async () => {
          sayCalls++;
          return sayCalls === 1 ? gate.promise : true;
        },
      });

      await h.controller.submitCommand({ text: 'sag was' });
      await vi.waitFor(() => expect(sayCalls).toBe(1));

      await h.controller.estop('operator pressed STOPP');
      // The operator clears the latch while block 1 is STILL in flight.
      h.controller.resetEstop();
      gate.resolve(true);
      await h.controller.whenIdle();

      const plan = h.controller.getState().plan!;
      expect(plan.status).toBe('aborted');
      expect(plan.blocks.map((b) => b.status)).toEqual(['aborted', 'skipped']);
      // The tail never ran…
      expect(sayCalls).toBe(1);
      // …and the E-Stop was reported exactly once, as `aborted`.
      const finished = h.events.filter((e) => e.type === 'agent:plan:finished');
      expect(finished).toHaveLength(1);
      expect(finished[0].plan!.status).toBe('aborted');
    });

    it('refuses a new command while the stopped plan is still winding down', async () => {
      const gate = deferred<boolean>();
      let sayCalls = 0;
      const h = makeController([speakBlock('eins'), speakBlock('zwei')], {
        say: async () => {
          sayCalls++;
          return sayCalls === 1 ? gate.promise : true;
        },
      });

      await h.controller.submitCommand({ text: 'sag was' });
      await vi.waitFor(() => expect(sayCalls).toBe(1));
      await h.controller.estop('operator pressed STOPP');
      h.controller.resetEstop();

      const refused = await h.controller.submitCommand({ text: 'jetzt was anderes' });
      expect(refused.accepted).toBe(false);
      expect(refused.message).toMatch(/winding down/i);

      gate.resolve(true);
      await h.controller.whenIdle();
    });
  });

  // Finding 9: the SafetyMonitor stayed `triggered` forever while Agent Mode
  // was free to drive again — with the humanoid fall/tilt protective stop
  // disarmed and /safety still reporting an emergency stop.
  describe('the SafetyMonitor latch clears with ours', () => {
    it('resets the SafetyMonitor E-stop on reset', async () => {
      const h = makeController([speakBlock('eins')]);

      await h.controller.estop('operator pressed STOPP');
      expect(h.estopCalls).toHaveLength(1);
      expect(h.estopResets).toBe(0);

      const state = h.controller.resetEstop();

      expect(h.estopResets).toBe(1);
      expect(state.estopActive).toBe(false);
    });

    it('keeps its own latch when the SafetyMonitor refuses to clear', async () => {
      const h = makeController([speakBlock('eins')], { estopResetResult: false });
      await h.controller.estop('operator pressed STOPP');

      const state = h.controller.resetEstop();

      expect(h.estopResets).toBe(1);
      expect(state.estopActive).toBe(true);
      const refused = await h.controller.submitCommand({ text: 'lauf los' });
      expect(refused.accepted).toBe(false);
      expect(refused.message).toMatch(/E-Stop is latched/);
    });
  });

  // A SafetyMonitor latch that never routed through this controller — its own
  // fall/tilt protective stop, CommandExecutor.emergencyStop, the fleet/A2A
  // E-Stop — left `estopActive` false, so Agent Mode planned and drove a robot
  // the rest of the system reported as emergency-stopped.
  describe('the SafetyMonitor latch blocks Agent Mode too', () => {
    it('refuses a command while only the safety monitor is latched', async () => {
      let latched = false;
      const plan = vi.fn(async () => ({
        blocks: [speakBlock('nie')],
        fallback: false,
        attempts: 1,
      }));
      const h = makeController([], { plan, safetyLatched: () => latched });

      latched = true;
      const refused = await h.controller.submitCommand({ text: 'geh 2 Meter vorwaerts' });

      expect(refused.accepted).toBe(false);
      // Our own latch is NOT set — the message must say where to clear it.
      expect(h.controller.getState().estopActive).toBe(false);
      expect(refused.message).toMatch(/safety monitor/i);
      expect(refused.message).toMatch(/safety\/estop\/reset/);
      expect(plan).not.toHaveBeenCalled();
      expect(h.controller.isRunning()).toBe(false);

      // …and the command goes through once that latch is cleared.
      latched = false;
      const accepted = await h.controller.submitCommand({ text: 'geh 2 Meter vorwaerts' });
      await h.controller.whenIdle();
      expect(accepted.accepted).toBe(true);
    });

    it('names our own latch when that is the one that is set', async () => {
      const h = makeController([speakBlock('eins')]);
      await h.controller.estop('operator pressed STOPP');

      const refused = await h.controller.submitCommand({ text: 'lauf los' });

      expect(refused.message).toMatch(/E-Stop is latched/);
      expect(refused.message).not.toMatch(/safety monitor/i);
    });

    it('does not let the idle greeter wave an arm on an e-stopped robot', async () => {
      let latched = true;
      const h = makeController([], {
        observation: {
          currentView: 'eine Person steht vor mir',
          entities: [],
          personVisible: true,
          raw: '{}',
          degraded: false,
        },
        safetyLatched: () => latched,
        say: async () => true,
        idleWatchIntervalMs: 1,
      });

      h.controller.startIdleWatcher();
      // Several ticks pass with the safety latch set: no greet plan, no wave.
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(h.controller.getState().plan).toBeNull();
      expect(h.actions).toEqual([]);

      // Clearing the latch proves the watcher was ticking all along.
      latched = false;
      await vi.waitFor(() => expect(h.actions).toContain('wave'));
      h.controller.stopIdleWatcher();
      await h.controller.whenIdle();
      expect(h.controller.getState().plan!.command).toBe('(idle) a person appeared');
    });
  });

  // Finding 0: the E-Stop leaves the base in damp (FSM 1), where every
  // locomotion command is ACKed and ignored. Nothing used to record that, so a
  // "reset" looked like a full recovery while the robot lay on the floor.
  describe('the damped base stays visible after a reset', () => {
    it('carries the FSM and a damped flag in the state', async () => {
      const h = makeController([{ kind: 'posture', params: { pose: 'stand' } }]);
      expect(h.controller.getState()).toMatchObject({ fsmId: null, damped: false });

      await h.controller.estop('operator pressed STOPP');
      expect(h.controller.getState()).toMatchObject({ fsmId: G1_FSM_DAMP, damped: true });

      h.controller.resetEstop();
      // The latch is clear, but the base is NOT re-armed — a UI click must
      // never make a collapsed G1 stand up.
      expect(h.controller.getState()).toMatchObject({ estopActive: false, damped: true });

      await h.controller.submitCommand({ text: 'stell dich hin' });
      await h.controller.whenIdle();
      expect(h.controller.getState()).toMatchObject({ fsmId: 500, damped: false });
    });

    it('tells the planner to stand the robot up before it plans motion', async () => {
      const summaries: string[] = [];
      const plan = vi.fn(async (input: { sceneSummary: string }) => {
        summaries.push(input.sceneSummary);
        return { blocks: [speakBlock('ok')], fallback: false, attempts: 1 };
      }) as unknown as Planner['plan'];
      const h = makeController([], { plan });

      await h.controller.estop('operator pressed STOPP');
      h.controller.resetEstop();
      await h.controller.submitCommand({ text: 'geh 2 Meter vorwaerts' });
      await h.controller.whenIdle();

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatch(/DAMPED/);
      expect(summaries[0]).toMatch(/posture block with pose "stand"/);
    });
  });
});

describe('AgentModeController — arbitration', () => {
  it('refuses to start while a VLA rollout owns control', async () => {
    const lock = new ControlOwnerLock();
    lock.claim('vla');
    const h = makeController([speakBlock('eins')], { lock });

    const result = await h.controller.submitCommand({ text: 'lauf los' });

    expect(result.accepted).toBe(false);
    expect(result.message).toMatch(/VLA skill rollout/);
    expect(h.controller.isRunning()).toBe(false);
  });

  it('is preempted by human teleop, and the plan ends `aborted`', async () => {
    const gate = deferred<boolean>();
    let sayCalls = 0;
    const h = makeController([speakBlock('eins'), speakBlock('zwei')], {
      say: async () => {
        sayCalls++;
        return sayCalls === 1 ? gate.promise : true;
      },
    });

    await h.controller.submitCommand({ text: 'sag was' });
    await vi.waitFor(() => expect(sayCalls).toBe(1));

    // A human connects to teleop — the lock is taken by force.
    expect(h.lock.claim('teleop')).toEqual({ ok: true, preempted: 'agent' });
    gate.resolve(true);
    await h.controller.whenIdle();

    const plan = h.controller.getState().plan!;
    expect(plan.status).toBe('aborted');
    // Block 0 genuinely completed before the abort landed — it stays `done`
    // rather than being retroactively rewritten. The takeover note lands on
    // the block that never ran.
    expect(plan.blocks[0].status).toBe('done');
    expect(plan.blocks[1].status).toBe('skipped');
    expect(plan.blocks[1].error).toMatch(/teleoperation took over/i);
    expect(h.lock.get()).toBe('teleop');
  });

  // Review round 2: `resetEstop()` cleared `abortRequested` unconditionally.
  // A teleop takeover aborts via `abortPlan()`, which does NOT finalize the
  // plan (the wind-down does), so a latch reset landing while the preempted
  // block was still in flight erased the abort — and the plan resumed driving
  // its remaining motion blocks while a human held the teleop lock.
  it('a latch reset does not forgive a teleop-takeover abort', async () => {
    const gate = deferred<boolean>();
    let sayCalls = 0;
    const h = makeController([speakBlock('eins'), speakBlock('zwei')], {
      say: async () => {
        sayCalls++;
        return sayCalls === 1 ? gate.promise : true;
      },
    });

    await h.controller.submitCommand({ text: 'sag was' });
    await vi.waitFor(() => expect(sayCalls).toBe(1));

    expect(h.lock.claim('teleop')).toEqual({ ok: true, preempted: 'agent' });
    // No E-Stop is latched; a reset lands while block 1 is still in flight.
    h.controller.resetEstop();
    gate.resolve(true);
    await h.controller.whenIdle();

    const plan = h.controller.getState().plan!;
    expect(plan.status).toBe('aborted');
    expect(plan.blocks[1].status).toBe('skipped');
    // The tail never ran.
    expect(sayCalls).toBe(1);
    expect(h.lock.get()).toBe('teleop');
  });

  it('takes the lock for the duration of a plan', async () => {
    const gate = deferred<boolean>();
    let sayCalls = 0;
    const h = makeController([speakBlock('eins')], {
      say: async () => {
        sayCalls++;
        return gate.promise;
      },
    });

    await h.controller.submitCommand({ text: 'sag was' });
    await vi.waitFor(() => expect(sayCalls).toBe(1));
    expect(h.lock.get()).toBe('agent');

    gate.resolve(true);
    await h.controller.whenIdle();
    expect(h.lock.get()).toBe('idle');
  });
});

describe('AgentModeController — mode switch', () => {
  it('refuses commands while the mode is off', async () => {
    const h = makeController([speakBlock('eins')]);
    h.controller.setEnabled(false);

    const result = await h.controller.submitCommand({ text: 'lauf los' });

    expect(result.accepted).toBe(false);
    expect(result.message).toMatch(/Agent Mode is off/);
  });

  it('folds an interrupting command into the not-yet-started tail', async () => {
    const gate = deferred<boolean>();
    let sayCalls = 0;
    const plan = vi
      .fn()
      .mockResolvedValueOnce({
        blocks: [speakBlock('eins'), speakBlock('zwei')],
        fallback: false,
        attempts: 1,
      })
      .mockResolvedValueOnce({ blocks: [speakBlock('stattdessen')], fallback: false, attempts: 1 });

    const h = makeController([], {
      plan,
      say: async () => {
        sayCalls++;
        return sayCalls === 1 ? gate.promise : true;
      },
    });

    const first = await h.controller.submitCommand({ text: 'sag eins und zwei' });
    await vi.waitFor(() => expect(sayCalls).toBe(1));

    const second = await h.controller.submitCommand({ text: 'nein, sag was anderes' });
    expect(second.accepted).toBe(true);
    expect(second.planId).toBe(first.planId);

    gate.resolve(true);
    await h.controller.whenIdle();

    const finished = h.controller.getState().plan!;
    expect(plan).toHaveBeenCalledTimes(2);
    // Block 1 already ran and is frozen; the pending tail was replaced.
    expect(finished.blocks.map((b) => b.params.text)).toEqual(['eins', 'stattdessen']);
    expect(finished.status).toBe('done');
  });

  // Review round 2: the pending slot holds ONE interrupt, and a second one
  // silently discarded the first — an acknowledged order the operator waits on
  // forever. The replacement is legitimate (the newest instruction wins); the
  // silence was not.
  it('says that a second interrupt replaces the first, unstarted one', async () => {
    const gate = deferred<boolean>();
    let sayCalls = 0;
    const h = makeController([speakBlock('eins'), speakBlock('zwei')], {
      say: async () => {
        sayCalls++;
        return sayCalls === 1 ? gate.promise : true;
      },
    });

    await h.controller.submitCommand({ text: 'sag was' });
    await vi.waitFor(() => expect(sayCalls).toBe(1));

    const first = await h.controller.submitCommand({ text: 'bring mir Wasser' });
    expect(first.accepted).toBe(true);
    expect(first.message).not.toMatch(/replaces/i);

    const second = await h.controller.submitCommand({ text: 'doch lieber Kaffee' });
    expect(second.accepted).toBe(true);
    expect(second.message).toMatch(/replaces your earlier instruction "bring mir Wasser"/i);

    gate.resolve(true);
    await h.controller.whenIdle();
  });

  // Finding 13: an interrupt that submitCommand had already acknowledged
  // ("I will fold that into the running plan after the current block") vanished
  // without a trace whenever the block running at that moment failed — never
  // planned, never executed, never reported.
  it('says so when an accepted interrupt is dropped because the plan failed', async () => {
    const gate = deferred<void>();
    const plan = vi.fn(async () => ({
      blocks: [speakBlock('eins'), { kind: 'walk' as const, params: { distanceM: 2 } }],
      fallback: false,
      attempts: 1,
    }));
    const h = makeController([], {
      plan,
      move: async () => {
        await gate.promise;
        return { ok: false, error: 'sidecar unavailable (503)' };
      },
    });

    const first = await h.controller.submitCommand({ text: 'geh zum Tisch' });
    await vi.waitFor(() =>
      expect(h.controller.getState().plan!.blocks[1]?.status).toBe('running')
    );

    const second = await h.controller.submitCommand({ text: 'nein, dreh dich um' });
    expect(second.accepted).toBe(true);
    expect(second.planId).toBe(first.planId);

    gate.resolve();
    await h.controller.whenIdle();

    const finished = h.controller.getState().plan!;
    expect(finished.status).toBe('failed');
    // The interrupt was never planned…
    expect(plan).toHaveBeenCalledTimes(1);
    // …and the operator is told so, out loud, instead of waiting forever.
    const last = finished.blocks[finished.blocks.length - 1];
    expect(last.kind).toBe('speak');
    expect(last.status).toBe('done');
    expect(String(last.params.text)).toContain('nein, dreh dich um');
    expect(h.loggedBlocks.at(-1)).toMatchObject({ kind: 'speak', status: 'done' });
  });

  it('reports the dropped interrupt when the plan CRASHES, not just when it fails', async () => {
    const gate = deferred<boolean>();
    let sayCalls = 0;
    let crashed = false;
    const plan = vi.fn(async () => ({
      blocks: [speakBlock('eins'), speakBlock('zwei')],
      fallback: false,
      attempts: 1,
    }));
    const h = makeController([], {
      plan,
      say: async () => {
        sayCalls++;
        return sayCalls === 1 ? gate.promise : true;
      },
      // An unexpected throw from outside the block handlers — the mirror push
      // path — takes runPlan into its catch branch exactly once.
      onMirrorEmit: (event) => {
        if (event.type === 'agent:block:finished' && !crashed) {
          crashed = true;
          throw new Error('mirror exploded');
        }
      },
    });

    await h.controller.submitCommand({ text: 'sag eins und zwei' });
    await vi.waitFor(() => expect(sayCalls).toBe(1));

    const second = await h.controller.submitCommand({ text: 'nein, dreh dich um' });
    expect(second.accepted).toBe(true);

    gate.resolve(true);
    await h.controller.whenIdle();

    const finished = h.controller.getState().plan!;
    expect(finished.status).toBe('failed');
    expect(plan).toHaveBeenCalledTimes(1);
    const last = finished.blocks[finished.blocks.length - 1];
    expect(last.kind).toBe('speak');
    expect(last.status).toBe('done');
    expect(String(last.params.text)).toContain('nein, dreh dich um');
  });
});
