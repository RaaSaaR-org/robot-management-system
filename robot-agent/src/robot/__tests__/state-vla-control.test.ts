/**
 * @file state-vla-control.test.ts
 * @description The exclusive-control lock lifecycle around a VLA rollout
 *              (`POST /vla/start` → SkillExecutor closed loop). The lock must be
 *              held for exactly as long as the rollout runs: a rollout that ends
 *              on its own (unreachable VLA server, max steps, timeout) used to
 *              leave the lock held for the life of the process, which killed
 *              Agent Mode with no way to recover it short of a restart.
 * @feature vla
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RobotConfig } from '../types.js';

const TEST_JOINTS = [
  { name: 'shoulder_pan', axis: 'z', limitLower: -1, limitUpper: 1, defaultPosition: 0 },
];

vi.mock('../joint-configs/index.js', () => ({
  getJointConfig: vi.fn().mockReturnValue(TEST_JOINTS),
}));

// The closed loop itself is covered by vla/__tests__/skill-executor.test.ts.
// Here it is a controllable promise so the rollout's end can be scheduled.
const runControl = vi.hoisted(() => ({
  resolve: null as null | ((value: unknown) => void),
  reject: null as null | ((err: unknown) => void),
}));

vi.mock('../../vla/skill-executor.js', () => ({
  SkillExecutor: class {
    run(): Promise<unknown> {
      return new Promise((resolve, reject) => {
        runControl.resolve = resolve;
        runControl.reject = reject;
      });
    }
    abort(): void {
      // A real abort makes the run settle; mimic that.
      runControl.resolve?.({ status: 'aborted', steps: 0 });
    }
    isAborted(): boolean {
      return false;
    }
  },
  skillExecutorRegistry: {
    register: (): void => {},
    unregister: (): void => {},
    abort: (): boolean => false,
    abortAll: (): number => 0,
  },
}));

vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...actual,
    config: { ...actual.config, robotId: 'test-robot' },
  };
});

const { RobotStateManager, ControlBusyError } = await import('../state.js');
const { controlOwnerLock } = await import('../../agent-mode/control-owner.js');

function makeConfig(): RobotConfig {
  return {
    id: 'test-robot-1',
    name: 'TestBot',
    model: 'TestModel',
    robotClass: 'standard',
    robotType: 'so101',
    maxPayloadKg: 10,
    description: 'Test robot',
    initialLocation: { x: 0, y: 0, floor: '1' },
    capabilities: ['navigation'],
  };
}

/** Let the `.then/.catch/.finally` chain on the run promise settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('RobotStateManager — VLA control owns the exclusive lock', () => {
  let mgr: InstanceType<typeof RobotStateManager>;

  beforeEach(() => {
    controlOwnerLock.reset();
    runControl.resolve = null;
    runControl.reject = null;
    mgr = new RobotStateManager(makeConfig());
  });

  afterEach(() => {
    controlOwnerLock.reset();
    vi.restoreAllMocks();
  });

  it('claims the lock for the rollout and releases it when the run finishes on its own', async () => {
    await mgr.startVLAControl('pick the cube');

    expect(controlOwnerLock.get()).toBe('vla');
    expect(mgr.isVLAActive()).toBe(true);

    // Max steps / timeout / vla-server unreachable — nobody calls /vla/stop.
    runControl.resolve?.({ status: 'completed', steps: 1000 });
    await settle();

    expect(mgr.isVLAActive()).toBe(false);
    expect(controlOwnerLock.get()).toBe('idle');
    // Agent Mode is alive again — this is what stayed broken for the life of
    // the process before the fix.
    expect(controlOwnerLock.claim('agent').ok).toBe(true);
  });

  it('releases the lock when the run crashes', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mgr.startVLAControl('pick the cube');

    runControl.reject?.(new Error('vla-server unreachable'));
    await settle();

    expect(controlOwnerLock.get()).toBe('idle');
    spy.mockRestore();
  });

  it('releases the lock immediately on stopVLAControl()', async () => {
    await mgr.startVLAControl('pick the cube');

    await mgr.stopVLAControl();

    expect(controlOwnerLock.get()).toBe('idle');

    // The run settling afterwards must not double-release.
    runControl.resolve?.({ status: 'aborted', steps: 3 });
    await settle();
    expect(controlOwnerLock.get()).toBe('idle');
  });

  it('refuses to start while Agent Mode owns control, and leaves that lock alone', async () => {
    controlOwnerLock.claim('agent');

    await expect(mgr.startVLAControl('pick the cube')).rejects.toBeInstanceOf(ControlBusyError);

    expect(controlOwnerLock.get()).toBe('agent');
    expect(mgr.isVLAActive()).toBe(false);
  });

  it('a second start while a rollout runs throws without disturbing the live lock', async () => {
    await mgr.startVLAControl('pick the cube');

    await expect(mgr.startVLAControl('pick the ball')).rejects.toThrow(/already active/);

    // The live rollout keeps control (the claim/throw order matters here).
    expect(controlOwnerLock.get()).toBe('vla');
    expect(controlOwnerLock.holderCount()).toBe(1);
    expect(mgr.isVLAActive()).toBe(true);
  });

  // Review round 2: `claim('teleop')` preempting `vla` only relabelled the
  // lock — the SkillExecutor closed loop knew nothing about it and kept
  // POSTing actions under the operator's hands, and once the last teleop
  // socket closed the lock read `idle` while the rollout still ran.
  it('teleop preemption stops the rollout, not just the lock label', async () => {
    await mgr.startVLAControl('pick the cube');
    expect(controlOwnerLock.get()).toBe('vla');

    expect(controlOwnerLock.claim('teleop')).toEqual({ ok: true, preempted: 'vla' });

    // The rollout was stopped, and teleop keeps the lock it took.
    expect(mgr.isVLAActive()).toBe(false);
    expect(controlOwnerLock.get()).toBe('teleop');

    // When the human lets go, control returns to idle — NOT to a zombie
    // rollout, and the run settling late must not disturb anything.
    controlOwnerLock.release('teleop');
    expect(controlOwnerLock.get()).toBe('idle');
    runControl.resolve?.({ status: 'aborted', steps: 3 });
    await settle();
    expect(controlOwnerLock.get()).toBe('idle');
    expect(controlOwnerLock.claim('agent').ok).toBe(true);
  });

  it('a late-settling run never releases the lock of the rollout that replaced it', async () => {
    await mgr.startVLAControl('first');
    const firstRunResolve = runControl.resolve!;

    await mgr.stopVLAControl();
    expect(controlOwnerLock.get()).toBe('idle');

    await mgr.startVLAControl('second');
    expect(controlOwnerLock.get()).toBe('vla');

    // The first run's promise settles only now.
    firstRunResolve({ status: 'aborted', steps: 1 });
    await settle();

    expect(controlOwnerLock.get()).toBe('vla');
  });
});
