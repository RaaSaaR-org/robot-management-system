/**
 * @file state-latch-restore-gating.test.ts
 * @description TASK-201: restoring a persisted E-Stop latch is split in two.
 *              The in-memory half runs in the `RobotStateManager` CONSTRUCTOR —
 *              a latched robot refuses commands from the first instant — while
 *              the half that reaches the shared sidecar and the shared state
 *              file waits until this process owns its port.
 * @feature robot
 * @status test
 *
 * The failure this pins down: the constructor runs at `index.ts:159`, long
 * before `server.listen()` calls back, so a second agent (a stray `npm run
 * dev`, or the tsx-watch overlap this box has seen three of within 50 ms) read
 * the same state file, re-latched — and POSTed `/loco/action {"name":"stop"}`
 * to the sidecar of a robot the OTHER process was driving, then rewrote its
 * state file, before losing the port and exiting without a trace.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RobotConfig } from '../types.js';

const TEST_ROBOT_ID = 'latch-restore-gating-test-robot';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(HERE, `../../../data/state-${TEST_ROBOT_ID}.json`);

// Everything that transitively pulls `config.js` is imported DYNAMICALLY below,
// after this mock exists.
vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...actual,
    config: { ...actual.config, robotId: TEST_ROBOT_ID },
  };
});

const { RobotStateManager } = await import('../state.js');
const { hardwareClient } = await import('../../hardware/HardwareClient.js');
const { createAgentRuntime } = await import('../../agent-runtime.js');
const { AgentModeController } = await import('../../agent-mode/agent-mode-controller.js');
const { ControlOwnerLock } = await import('../../agent-mode/control-owner.js');
const { RangeSensor } = await import('../../agent-mode/range.js');
const { G1_FSM_DAMP } = await import('../../agent-mode/block-executor.js');
const {
  PERSISTED_STATE_VERSION,
  defaultPersistedAgentState,
} = await import('../StatePersistence.js');

type PersistedAgentState = import('../StatePersistence.js').PersistedAgentState;
type PersistedState = import('../StatePersistence.js').PersistedState;
type AgentRuntimeSteps = import('../../agent-runtime.js').AgentRuntimeSteps;
type IncarnationOpenResult = import('../../agent-mode/incarnations.js').IncarnationOpenResult;
type Planner = import('../../agent-mode/planner.js').Planner;
type ServerMirror = import('../../agent-mode/server-mirror.js').ServerMirror;
type VisionClient = import('../../agent-mode/vision.js').VisionClient;

/** Long enough to flush `StatePersistence`'s 500 ms debounce, several times over. */
const AFTER_THE_DEBOUNCE_MS = 2_000;

function makeConfig(): RobotConfig {
  return {
    id: 'robot-1',
    name: 'TestBot',
    model: 'TestModel',
    robotClass: 'standard',
    robotType: 'g1',
    maxPayloadKg: 10,
    description: 'Test robot',
    initialLocation: { x: 0, y: 0, floor: '1' },
    capabilities: ['navigation'],
  };
}

/**
 * The state a robot that was E-Stopped and damped leaves behind. `warnings` is
 * deliberately EMPTY: the stop warning only exists in a file that this process
 * wrote, so its presence on disk is the signature of a durable write.
 */
function writeLatchedState(agentState: Partial<PersistedAgentState> = {}): string {
  const state: PersistedState = {
    version: PERSISTED_STATE_VERSION,
    savedAt: new Date(Date.now() - 1_000).toISOString(),
    robotState: {
      status: 'online',
      batteryLevel: 61,
      location: { x: 1, y: 2, floor: '1' },
      heldObject: undefined,
      speed: 0,
      errors: [],
      warnings: [],
    },
    taskQueue: [],
    agentState: {
      ...defaultPersistedAgentState(),
      estopLatched: true,
      estopReason: 'Agent Mode E-Stop: operator pressed STOPP',
      estopAt: '2026-08-02T09:00:00.000Z',
      damped: true,
      lastFsmId: G1_FSM_DAMP,
      ...agentState,
    },
  };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  return fs.readFileSync(STATE_FILE, 'utf-8');
}

const onDisk = (): PersistedState =>
  JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as PersistedState;

const hasStopWarning = (warnings: string[]): boolean =>
  warnings.some((w) => w.includes('Emergency stop'));

/** Runtime steps that do nothing, so a test can wire only the one it is about. */
function inertSteps(overrides: Partial<AgentRuntimeSteps>): AgentRuntimeSteps {
  return {
    confirmIncarnation: () => {},
    attachController: () => {},
    reassertRestoredStop: () => {},
    recordBoot: () => {},
    startSimulation: () => {},
    startSafetyMonitoring: () => {},
    announceBootState: () => {},
    startIdleWatcher: () => {},
    abandonIncarnation: () => {},
    ...overrides,
  };
}

const controllers: InstanceType<typeof AgentModeController>[] = [];

/** A real `AgentModeController` with the transport and the planner stubbed. */
function makeController(): InstanceType<typeof AgentModeController> {
  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock: new ControlOwnerLock(),
    planner: {
      plan: async () => ({ blocks: [], fallback: false, attempts: 1 }),
    } as unknown as Planner,
    mirror: {
      emit: () => {},
      push: async () => {},
      logBlock: async () => {},
    } as unknown as ServerMirror,
    vision: { observe: async () => null } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    loco: {
      move: async () => ({ ok: true }),
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    sleep: async () => {},
    idleWatchIntervalMs: 60_000,
  });
  controllers.push(controller);
  return controller;
}

const INCARNATION: IncarnationOpenResult = {
  bootId: 'b-latch-restore',
  startedAt: new Date().toISOString(),
  seq: 2,
  seqExact: true,
  fromCrash: false,
  previous: null,
};

beforeEach(() => {
  // Fake timers, so "the debounced write did NOT happen" is a decided fact
  // rather than a race, and so no watcher tick fires unless a test asks for it.
  vi.useFakeTimers();
  fs.rmSync(STATE_FILE, { force: true });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  while (controllers.length) controllers.pop()?.stopIdleWatcher();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(STATE_FILE, { force: true });
});

describe('restoring an E-Stop latch — the constructor half', () => {
  it('reports the latch in memory while touching neither the sidecar nor the disk', () => {
    const before = writeLatchedState();
    const locoStop = vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });

    const mgr = new RobotStateManager(makeConfig());

    // In memory the robot IS latched, from this instant — anything less would
    // let a command through during the boot window.
    expect(mgr.isEStopTriggered()).toBe(true);
    expect(mgr.getEStopState().reason).toBe('Agent Mode E-Stop: operator pressed STOPP');
    expect(hasStopWarning(mgr.getState().warnings)).toBe(true);
    expect(mgr.getState().speed).toBe(0);

    // …and nothing left this process. THE defect: `_loco` POSTs unconditionally,
    // so this reached the robot the OTHER agent was driving.
    expect(locoStop).not.toHaveBeenCalled();

    // Not even after the debounce window a losing candidate easily outlives.
    vi.advanceTimersByTime(AFTER_THE_DEBOUNCE_MS);
    expect(fs.readFileSync(STATE_FILE, 'utf-8')).toBe(before);
  });

  it('holds nothing back when there was no latch to restore', () => {
    writeLatchedState({ estopLatched: false, estopReason: null, estopAt: null });
    const locoStop = vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });

    const mgr = new RobotStateManager(makeConfig());

    expect(mgr.isEStopTriggered()).toBe(false);
    // Nothing to re-assert, and the port-owned step says so instead of stopping
    // a robot nobody stopped.
    expect(mgr.reassertRestoredSafetyStop()).toBe(false);
    expect(locoStop).not.toHaveBeenCalled();
  });
});

describe('restoring an E-Stop latch — the port-owned half', () => {
  it('commands the base and persists the restored latch once the port is owned', () => {
    writeLatchedState();
    const locoStop = vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
    const mgr = new RobotStateManager(makeConfig());
    expect(locoStop).not.toHaveBeenCalled();

    expect(mgr.reassertRestoredSafetyStop()).toBe(true);

    // The requirement that must survive the fix: the robot really is stopped.
    expect(locoStop).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(AFTER_THE_DEBOUNCE_MS);
    const written = onDisk();
    expect(written.agentState.estopLatched).toBe(true);
    // The warning was NOT in the fixture — its presence proves this write is
    // ours, and that latch and warning still land together.
    expect(hasStopWarning(written.robotState.warnings)).toBe(true);
  });

  it('re-asserts once, so a repeated call cannot undo an operator reset', () => {
    writeLatchedState();
    const locoStop = vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
    const mgr = new RobotStateManager(makeConfig());

    expect(mgr.reassertRestoredSafetyStop()).toBe(true);
    expect(mgr.reassertRestoredSafetyStop()).toBe(false);

    expect(locoStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the reset MANUAL: a restored latch does not auto-clear on a heartbeat', () => {
    // The auto-clear vs manual-reset distinction is what makes a restored latch
    // an EMERGENCY stop rather than a protective one a returning server drops.
    writeLatchedState();
    vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
    const mgr = new RobotStateManager(makeConfig());
    mgr.reassertRestoredSafetyStop();

    mgr.updateServerHeartbeat();

    expect(mgr.isEStopTriggered()).toBe(true);
    expect(mgr.getEStopState().requiresManualReset).toBe(true);
    // …and it takes a deliberate reset to clear it.
    expect(mgr.resetEmergencyStop()).toBe(true);
    expect(mgr.isEStopTriggered()).toBe(false);
  });
});

describe('a process that never owns its port', () => {
  it('leaves the state file byte-identical and issues zero sidecar calls', () => {
    const before = writeLatchedState();
    const locoStop = vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });

    // Exactly what `index.ts` does: construct the manager, then lose the bind.
    const mgr = new RobotStateManager(makeConfig());
    const runtime = createAgentRuntime(
      inertSteps({
        reassertRestoredStop: () => {
          mgr.reassertRestoredSafetyStop();
        },
      }),
    );
    runtime.onBindFailed('port 41246 is already in use — another robot agent owns it');

    vi.advanceTimersByTime(AFTER_THE_DEBOUNCE_MS);

    expect(runtime.startedSteps()).toEqual([]);
    expect(locoStop).not.toHaveBeenCalled();
    expect(fs.readFileSync(STATE_FILE, 'utf-8')).toBe(before);
    // The loser still knows it is latched — it just says so to nobody.
    expect(mgr.isEStopTriggered()).toBe(true);
  });
});

describe('a normal boot of a robot that came back latched (regression)', () => {
  it('ends up stopped AND damped, with the latch on disk', () => {
    writeLatchedState();
    const locoStop = vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });

    const mgr = new RobotStateManager(makeConfig());
    const controller = makeController();
    const runtime = createAgentRuntime(
      inertSteps({
        attachController: () => controller.attach(mgr),
        reassertRestoredStop: () => {
          mgr.reassertRestoredSafetyStop();
        },
        recordBoot: () => controller.recordBoot(INCARNATION),
        announceBootState: () => controller.announceBootState(),
      }),
    );

    runtime.onPortOwned();

    // Stopped: the base was told, exactly once, by the process that owns it.
    expect(locoStop).toHaveBeenCalledTimes(1);
    expect(mgr.isEStopTriggered()).toBe(true);
    // …and both halves of the robot agree about it — a UI that shows no latch
    // while the monitor refuses every command is the lying state TASK-196 fixed.
    expect(controller.getState().estopActive).toBe(true);
    // Damped: the base's last FSM came back too, so nothing walks before a
    // `posture stand`.
    expect(controller.isDamped()).toBe(true);

    vi.advanceTimersByTime(AFTER_THE_DEBOUNCE_MS);
    expect(onDisk().agentState.estopLatched).toBe(true);
  });
});
