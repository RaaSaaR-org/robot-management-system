/**
 * @file vla-skill-plumbing.test.ts
 * @description TASK-226 step 0, and the controller's side of the `vla_skill`
 *              block: an Agent-Mode-initiated rollout is REGISTERED, so the
 *              safety loop's `abortAll()` reaches it; the `vla` control-owner
 *              lock is taken and given back on every path including a throw;
 *              the prompt handed to the policy is the trained one; and the
 *              block reports `succeeded`/`failed`/`unknown` without ever
 *              inferring success from "did not throw".
 * @feature agentmode
 * @status test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `runVlaSkill` reaches `SkillExecutor` through a dynamic import, so the class
 * is replaced here while the REGISTRY stays real: the whole point of step 0 is
 * that the real registry can find an Agent-Mode rollout, and a mocked registry
 * would assert only that the controller called a spy.
 */
const { executors, FakeExecutor } = vi.hoisted(() => {
  class FakeExecutor {
    aborted = false;
    /** Resolves the in-flight `run()`. */
    finish!: (result: Record<string, unknown>) => void;
    /** Rejects the in-flight `run()`. */
    crash!: (err: Error) => void;
    /** Resolves once `run()` has actually been entered. */
    started: Promise<void>;
    private markStarted!: () => void;
    lastOptions: Record<string, unknown> | null = null;

    constructor() {
      this.started = new Promise((r) => {
        this.markStarted = r;
      });
      executors.push(this);
    }

    abort(): void {
      this.aborted = true;
      // A real `SkillExecutor` notices the flag on its next step and returns
      // `aborted`; the fake settles immediately so the test does not have to
      // model the loop.
      this.finish?.({ status: 'aborted', mode: 'sim', steps: 3, durationMs: 300, error: 'aborted' });
    }

    isAborted(): boolean {
      return this.aborted;
    }

    run(options: Record<string, unknown>): Promise<Record<string, unknown>> {
      this.lastOptions = options;
      this.markStarted();
      return new Promise((resolve, reject) => {
        this.finish = resolve;
        this.crash = reject;
      });
    }
  }
  const executors: FakeExecutor[] = [];
  return { executors, FakeExecutor };
});

vi.mock('../../vla/skill-executor.js', async () => {
  const actual = await vi.importActual<typeof import('../../vla/skill-executor.js')>(
    '../../vla/skill-executor.js',
  );
  return { ...actual, SkillExecutor: FakeExecutor };
});

import { AgentModeController, type SkillVerdictProbe } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { RangeSensor } from '../range.js';
import { skillExecutorRegistry } from '../../vla/skill-executor.js';
import type { Planner, PlannedBlock } from '../planner.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { RobotStateManager } from '../../robot/state.js';

const EMPTY_VIEW: VisionObservation = {
  currentView: 'an empty room',
  entities: [],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

/** A `vla_skill` block exactly as `coerceParams` produces it. */
const APPLE_BLOCK: PlannedBlock = {
  kind: 'vla_skill',
  params: {
    skill: 'g1_apple_pnp',
    label: 'apple pick and place',
    instruction: 'move the apple to the plate',
    maxSteps: 600,
    timeoutMs: 180_000,
  },
  reasoning: 'the apple is on the table in front of me',
};

function makeController(
  blocks: PlannedBlock[],
  opts: { lock?: ControlOwnerLock; skillVerdict?: SkillVerdictProbe; attach?: boolean } = {},
) {
  const lock = opts.lock ?? new ControlOwnerLock();
  const planner = {
    plan: async () => ({ blocks, fallback: false, attempts: 1 }),
  } as unknown as Planner;
  const mirror = {
    emit: () => {},
    push: async () => {},
    logBlock: async () => {},
  } as unknown as ServerMirror;

  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock,
    planner,
    mirror,
    vision: { observe: async () => EMPTY_VIEW } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    ...(opts.skillVerdict ? { skillVerdict: opts.skillVerdict } : {}),
    loco: {
      move: async () => ({ ok: true }),
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    say: async () => false,
    sleep: async () => {},
    now: () => 1e12,
  });

  if (opts.attach !== false) {
    controller.attach({
      triggerEmergencyStop: () => {},
      resetEmergencyStop: () => true,
      isEStopTriggered: () => false,
      getEStopState: () => ({ status: 'armed' }),
      onSafetyEvent: () => () => {},
      subscribe: () => () => {},
      isTeleopActive: () => false,
      isVLAActive: () => false,
      getState: () => ({ batteryLevel: 90 }),
    } as unknown as RobotStateManager);
  }

  return { controller, lock };
}

beforeEach(() => {
  executors.length = 0;
});

/**
 * Wait until the rollout is actually in flight.
 *
 * `submitCommand` returns as soon as the plan is queued — planning and every
 * block run on the background `runPromise` — so the executor does not exist
 * yet when it resolves. Polled on the microtask queue rather than slept on:
 * every dep in this harness is synchronous, so a handful of turns is always
 * enough and the test never spends wall time.
 */
async function runningExecutor(index = 0): Promise<InstanceType<typeof FakeExecutor>> {
  for (let i = 0; i < 200 && executors.length <= index; i++) await Promise.resolve();
  const executor = executors[index];
  if (!executor) throw new Error(`no rollout was started (executors: ${executors.length})`);
  await executor.started;
  return executor;
}

describe('TASK-226 step 0 — an Agent-Mode rollout is reachable by the safety loop', () => {
  it('registers the executor, so skillExecutorRegistry.abortAll() halts it', async () => {
    const { controller } = makeController([APPLE_BLOCK]);

    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();

    // This is the exact call `robot/state.ts:1785` makes on a protective stop.
    // Before this task it returned 0: the rollout was invisible to it, and a
    // detected fall did not stop the arms.
    const aborted = skillExecutorRegistry.abortAll();
    expect(aborted).toBe(1);
    expect(executors[0].aborted).toBe(true);

    await controller.whenIdle();
    const block = controller.getState().plan!.blocks[0];
    expect(block.status).toBe('failed');
    expect(block.error).toContain('did not finish');
  });

  it('unregisters afterwards, so abortAll() cannot reach a finished rollout', async () => {
    const { controller } = makeController([APPLE_BLOCK]);
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    executors[0].finish({ status: 'completed', mode: 'sim', steps: 600, durationMs: 120_000 });
    await controller.whenIdle();

    expect(skillExecutorRegistry.abortAll()).toBe(0);
  });

  it('an E-Stop during the rollout aborts the policy without waiting for the safety poll', async () => {
    const { controller } = makeController([APPLE_BLOCK]);
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();

    await controller.estop('operator pressed stop');

    expect(executors[0].aborted).toBe(true);
    await controller.whenIdle();
  });

  it('a teleop takeover mid-rollout aborts the policy', async () => {
    const lock = new ControlOwnerLock();
    const { controller } = makeController([APPLE_BLOCK], { lock });
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();

    // A human opening `/ws/keyboard-teleop`. `teleop` always wins.
    lock.claim('teleop');

    expect(executors[0].aborted).toBe(true);
    await controller.whenIdle();
  });
});

describe('TASK-226 step 2 — the vla control-owner lock', () => {
  it('holds `vla` for exactly the rollout and hands `agent` back afterwards', async () => {
    const lock = new ControlOwnerLock();
    const { controller } = makeController([APPLE_BLOCK], { lock });

    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    // Agent Mode lent its own lock to the policy: an operator reading
    // `GET /agent-mode` now sees that a VLA rollout is driving, which is what
    // is actually happening.
    expect(lock.get()).toBe('vla');

    executors[0].finish({ status: 'completed', mode: 'sim', steps: 600, durationMs: 120_000 });
    await controller.whenIdle();
    // Back to idle by way of `agent`: the plan's own release is what frees it.
    expect(lock.get()).toBe('idle');
  });

  it('releases the lock when the rollout THROWS', async () => {
    const lock = new ControlOwnerLock();
    const { controller } = makeController([APPLE_BLOCK], { lock });

    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    executors[0].crash(new Error('vla-server exploded'));
    await controller.whenIdle();

    expect(lock.get()).toBe('idle');
    // And the plan says what happened rather than hanging on a held lock.
    expect(controller.getState().plan!.status).toBe('failed');
  });

  it('a preempted lend does not steal the lock back from the human', async () => {
    const lock = new ControlOwnerLock();
    const { controller } = makeController([APPLE_BLOCK], { lock });

    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    lock.claim('teleop');
    await controller.whenIdle();

    // The rollout's `finally` ran, and did NOT hand control back to a plan that
    // a human took over.
    expect(lock.get()).toBe('teleop');
  });

  it('fails the block with the lock’s own words when control is busy', async () => {
    const lock = new ControlOwnerLock();
    lock.claim('teleop');
    const { controller } = makeController([APPLE_BLOCK], { lock });

    const result = await controller.submitCommand({ text: 'pick up the apple' });
    // The plan cannot even start while teleop holds control — which is the
    // outer half of the same rule. Nothing was dispatched to a policy.
    expect(result.accepted).toBe(false);
    expect(executors).toHaveLength(0);
  });
});

describe('TASK-226 step 3 — prompt provenance', () => {
  it('sends the TRAINED task string, never `Execute skill <name>`', async () => {
    const { controller } = makeController([APPLE_BLOCK]);
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();

    const options = executors[0].lastOptions!;
    expect(options.taskPrompt).toBe('move the apple to the plate');
    expect(String(options.taskPrompt)).not.toContain('Execute skill');
    // And the checkpoint's own horizon, not the 200 steps `demo` hard-coded.
    expect(options.maxSteps).toBe(600);
    expect(options.timeoutMs).toBe(180_000);

    executors[0].finish({ status: 'completed', mode: 'sim', steps: 600, durationMs: 1000 });
    await controller.whenIdle();
  });
});

describe('TASK-226 step 4 — the three-way outcome', () => {
  it('reports `unknown`, not success, when the rollout merely ran', async () => {
    const { controller } = makeController([APPLE_BLOCK]);
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    // `completed` from SkillExecutor means "ran maxSteps without throwing".
    executors[0].finish({ status: 'completed', mode: 'sim', steps: 600, durationMs: 120_000 });
    await controller.whenIdle();

    const block = controller.getState().plan!.blocks[0];
    expect(block.params.outcome).toBe('unknown');
    expect(block.params.verdictSource).toBe('rollout');
    expect(block.result).toContain('Outcome unknown');
    // The plan is not failed by an honest "nobody checked".
    expect(block.status).toBe('done');
    expect(controller.getState().plan!.status).toBe('done');
  });

  it('reports `failed` when the rollout did not finish', async () => {
    const { controller } = makeController([APPLE_BLOCK]);
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    executors[0].finish({
      status: 'failed',
      mode: 'sim',
      steps: 4,
      durationMs: 900,
      error: 'vla-server /config unreachable',
    });
    await controller.whenIdle();

    const block = controller.getState().plan!.blocks[0];
    expect(block.params.outcome).toBe('failed');
    expect(block.status).toBe('failed');
    expect(block.error).toContain('vla-server /config unreachable');
  });

  it('reports `succeeded` ONLY from an external check on the world', async () => {
    const skillVerdict: SkillVerdictProbe = () => ({
      outcome: 'succeeded',
      source: 'sim-world-state',
      confidence: 1,
    });
    const { controller } = makeController([APPLE_BLOCK], { skillVerdict });
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    executors[0].finish({ status: 'completed', mode: 'sim', steps: 240, durationMs: 48_000 });
    await controller.whenIdle();

    const block = controller.getState().plan!.blocks[0];
    expect(block.params.outcome).toBe('succeeded');
    expect(block.params.verdictSource).toBe('sim-world-state');
    expect(block.result).toContain('succeeded (sim-world-state)');
  });

  it('an external check may also say the rollout FAILED after it ran cleanly', async () => {
    const skillVerdict: SkillVerdictProbe = () => ({
      outcome: 'failed',
      source: 'success-classifier',
      reason: 'the apple is still on the table',
    });
    const { controller } = makeController([APPLE_BLOCK], { skillVerdict });
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    executors[0].finish({ status: 'completed', mode: 'sim', steps: 600, durationMs: 120_000 });
    await controller.whenIdle();

    const block = controller.getState().plan!.blocks[0];
    expect(block.params.outcome).toBe('failed');
    expect(block.status).toBe('failed');
    expect(block.error).toContain('the apple is still on the table');
  });

  it('a probe that throws leaves the outcome `unknown`, not `succeeded`', async () => {
    const skillVerdict: SkillVerdictProbe = () => {
      throw new Error('classifier is down');
    };
    const { controller } = makeController([APPLE_BLOCK], { skillVerdict });
    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    executors[0].finish({ status: 'completed', mode: 'sim', steps: 600, durationMs: 120_000 });
    await controller.whenIdle();

    expect(controller.getState().plan!.blocks[0].params.outcome).toBe('unknown');
  });

  it('refuses honestly when there is no robot to run a skill on', async () => {
    const { controller } = makeController([APPLE_BLOCK], { attach: false });
    await controller.submitCommand({ text: 'pick up the apple' });
    await controller.whenIdle();

    const block = controller.getState().plan!.blocks[0];
    expect(block.status).toBe('failed');
    expect(block.error).toContain('no robot to run a skill on');
    expect(executors).toHaveLength(0);
  });
});

describe('TASK-226 step 5 — the failure reaches the planner', () => {
  it('hands the failed block and its message to the NEXT planner call, once', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const lock = new ControlOwnerLock();
    const planner = {
      plan: async (input: Record<string, unknown>) => {
        seen.push(input);
        // The first command is the skill; every later one is a `speak`, so the
        // test drives the planner rather than the executor.
        return seen.length === 1
          ? { blocks: [APPLE_BLOCK], fallback: false, attempts: 1 }
          : { blocks: [{ kind: 'speak', params: { text: 'ok' } }], fallback: false, attempts: 1 };
      },
    } as unknown as Planner;

    const controller = new AgentModeController({
      robotId: 'robot-1',
      enabled: true,
      lock,
      planner,
      mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {} } as unknown as ServerMirror,
      vision: { observe: async () => EMPTY_VIEW } as unknown as VisionClient,
      range: new RangeSensor({ enabled: false }),
      loco: {
        move: async () => ({ ok: true }),
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => null,
      },
      say: async () => false,
      sleep: async () => {},
      now: () => 1e12,
    });
    controller.attach({
      triggerEmergencyStop: () => {},
      resetEmergencyStop: () => true,
      isEStopTriggered: () => false,
      getEStopState: () => ({ status: 'armed' }),
      onSafetyEvent: () => () => {},
      subscribe: () => () => {},
      isTeleopActive: () => false,
      isVLAActive: () => false,
      getState: () => ({ batteryLevel: 90 }),
    } as unknown as RobotStateManager);

    await controller.submitCommand({ text: 'pick up the apple' });
    await runningExecutor();
    executors[0].finish({
      status: 'failed',
      mode: 'sim',
      steps: 2,
      durationMs: 400,
      error: 'vla-server /config unreachable',
    });
    await controller.whenIdle();

    // The plan that just failed carried no failure INTO the planner.
    expect(seen[0].lastFailure).toBeUndefined();

    await controller.submitCommand({ text: 'try again' });
    await controller.whenIdle();
    expect(seen[1].lastFailure).toEqual({
      kind: 'vla_skill',
      message: expect.stringContaining('vla-server /config unreachable'),
    });

    // Consumed, not kept: a third command is planned with a clean slate.
    await controller.submitCommand({ text: 'say hello' });
    await controller.whenIdle();
    expect(seen[2].lastFailure).toBeUndefined();
  });
});
