/**
 * @file state-geofence-actuation.test.ts
 * @description TASK-200 review, findings 1 and 3: a geofence stop must actually
 *              STOP A MOVING ROBOT (abort the plan that is driving and command
 *              the base), and an operator re-anchor must never release a latched
 *              keepout stop as a side effect of naming a room.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RobotConfig } from '../types.js';
import type { CachedBasePose } from '../../hardware/HardwareClient.js';

const TEST_ROBOT_ID = 'geofence-actuation-test-robot';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(HERE, `../../../data/state-${TEST_ROBOT_ID}.json`);
const WAREHOUSE_GRAPH = path.resolve(
  HERE,
  '../../../hardware/sim_evaluator/places/places.warehouse.json',
);

// Everything that transitively pulls `config.js` is imported DYNAMICALLY below,
// after these constants exist — see the note in state-place-awareness.test.ts.
vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      robotId: TEST_ROBOT_ID,
      place: { ...actual.config.place, graphPath: WAREHOUSE_GRAPH },
    },
  };
});

const { RobotStateManager } = await import('../state.js');
const { hardwareClient } = await import('../../hardware/HardwareClient.js');
const { AgentModeController } = await import('../../agent-mode/agent-mode-controller.js');
const { ControlOwnerLock } = await import('../../agent-mode/control-owner.js');
const { RangeSensor } = await import('../../agent-mode/range.js');
type Planner = import('../../agent-mode/planner.js').Planner;
type PlannedBlock = import('../../agent-mode/planner.js').PlannedBlock;
type ServerMirror = import('../../agent-mode/server-mirror.js').ServerMirror;
type VisionClient = import('../../agent-mode/vision.js').VisionClient;

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

function pose(x: number, y: number, yawDeg = 0): CachedBasePose {
  return { x, y, yawDeg, source: 'sim', atMs: Date.now() };
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A manager plus the pose callback it registered on the hardware poll. */
function makeManager() {
  let emit: ((p: CachedBasePose | null) => void) | null = null;
  const spy = vi.spyOn(hardwareClient, 'onPoseSample').mockImplementation((cb) => {
    emit = cb;
    return () => {};
  });
  const manager = new RobotStateManager(makeConfig());
  spy.mockRestore();
  return { manager, emit: emit as unknown as (p: CachedBasePose | null) => void };
}

/**
 * A REAL AgentModeController attached to a REAL RobotStateManager, with the
 * locomotion client stubbed so every `/loco/move` the plan issues is recorded.
 * The point of the test is what happens to those calls when the fence fires.
 */
function makeAgent(
  manager: InstanceType<typeof RobotStateManager>,
  blocks: PlannedBlock[],
  gate: Promise<{ ok: boolean }> | null,
) {
  const moves: Array<{ vx: number; durationS: number }> = [];
  let moveCalls = 0;

  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock: new ControlOwnerLock(),
    planner: {
      plan: async () => ({ blocks, fallback: false, attempts: 1 }),
    } as unknown as Planner,
    mirror: {
      emit: () => {},
      push: async () => {},
      logBlock: async () => {},
    } as unknown as ServerMirror,
    vision: { observe: async () => null } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    loco: {
      move: async (vx: number, _vy: number, _omega: number, durationS: number) => {
        moves.push({ vx, durationS });
        moveCalls++;
        // The first walk hangs, so the fence fires while the robot is MOVING —
        // which is the entire failure scenario.
        return moveCalls === 1 && gate ? gate : { ok: true };
      },
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    sleep: async () => {},
  });
  controller.attach(manager);
  return { controller, moves };
}

const WALK: PlannedBlock = { kind: 'walk', params: { distanceM: 2, direction: 'forward' } };

describe('geofence stop ACTUATION (TASK-200 review, finding 1)', () => {
  beforeEach(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  });

  it('crossing the fence mid-plan aborts the plan and commands the base to stop', async () => {
    // Before this fix the stop only set `speed = 0` on an in-memory object and
    // wrote a warning string: the running `walk` block finished its multi-second
    // `/loco/move`, the plan walked on to the next two, and only the NEXT
    // operator command was refused. The robot drove into the rack.
    const locoStop = vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
    const { manager, emit } = makeManager();
    const gate = deferred<{ ok: boolean }>();
    const { controller, moves } = makeAgent(manager, [WALK, WALK, WALK], gate.promise);

    await controller.submitCommand({ text: 'lauf nach Osten' });
    await vi.waitFor(() => expect(moves).toHaveLength(1));

    // …and while that walk is in flight, the pose poll puts the robot inside
    // the margined RACK-A keepout (x ∈ [4, 5] in the shipped warehouse graph).
    emit(pose(4.5, 0));

    // The stop actuates SYNCHRONOUSLY, inside the sample that detected it.
    expect(locoStop).toHaveBeenCalledTimes(1);

    gate.resolve({ ok: true });
    await controller.whenIdle();

    const plan = controller.getState().plan!;
    expect(plan.status).toBe('aborted');
    // Block 0 was already in flight and is never cut off mid-motion; blocks 1
    // and 2 are the ones that used to keep driving into the rack.
    expect(plan.blocks.map((b) => b.status)).toEqual(['done', 'skipped', 'skipped']);
    expect(plan.blocks[1]?.error).toContain('zone_violation');
    expect(plan.blocks[1]?.error).toContain('Rack A');
    // The decisive assertion: no FURTHER motion was commanded after the stop.
    expect(moves).toHaveLength(1);
    expect(manager.getSafetyEvents()[0]?.type).toBe('zone_violation');
  });

  it('control: without a violation the same plan walks all three blocks', async () => {
    // Proves the assertion above is about the fence and not about the harness.
    vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
    const { manager, emit } = makeManager();
    const { controller, moves } = makeAgent(manager, [WALK, WALK, WALK], null);

    await controller.submitCommand({ text: 'lauf nach Osten' });
    await vi.waitFor(() => expect(moves.length).toBeGreaterThan(0));
    emit(pose(3, 0)); // AISLE-1, comfortably clear of RACK-A
    await controller.whenIdle();

    expect(controller.getState().plan!.status).toBe('done');
    expect(moves).toHaveLength(3);
  });

  it('reports an undelivered StopMove instead of assuming the base stopped', async () => {
    const locoStop = vi
      .spyOn(hardwareClient, 'locoStop')
      .mockResolvedValue({ ok: false, error: 'sidecar /loco/action unreachable' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { emit } = makeManager();

    emit(pose(4.5, 0));
    await vi.waitFor(() => expect(locoStop).toHaveBeenCalled());

    await vi.waitFor(() =>
      expect(
        warn.mock.calls.some((c) => String(c[0]).includes('StopMove NOT delivered')),
      ).toBe(true),
    );
  });
});

describe('a re-anchor never RELEASES a keepout stop (TASK-200 review, finding 3)', () => {
  beforeEach(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  });

  it('declaring a place while a keepout stop is latched does NOT clear it', () => {
    const { manager, emit } = makeManager();

    // Walk into RACK-A: the stop latches.
    emit(pose(4.5, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');

    // It paces inside the rack until the 15 m drift budget is spent — the
    // "drifted 30 m" of the finding, without teleporting past the fence.
    for (let i = 0; i < 5; i++) {
      emit(pose(4.5, 1));
      emit(pose(4.5, -3));
    }
    expect(manager.getPlaceBelief()?.place?.confidence).toBe('stale');

    // The robot is physically still in the rack; its drifted coordinates put it
    // in the aisle. The geofence honestly answers UNKNOWN (the budget is spent)
    // and the stop is HELD — this is the state the finding starts from.
    emit(pose(3, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');

    // "You are in aisle 1." An operator asserts a PLACE. It resets the drift
    // budget — and nothing else. It corrects no coordinate.
    expect(manager.declarePlace('AISLE-1')).not.toBeNull();

    // The very next sample used to be `confident` again, hence `clear`, hence a
    // released protective stop — on the strength of somebody naming a room.
    emit(pose(3, 0));

    expect(manager.getSafetyStatus().estop.status).toBe('triggered');
    expect(manager.getSafetyStatus().estop.reason).toContain('Rack A');
    expect(manager.getPlaceBelief()?.insideKeepout).toBeNull();
  });

  it('an explicit operator reset still releases it, and re-entry stops again', () => {
    const { manager, emit } = makeManager();
    emit(pose(4.5, 0));
    manager.declarePlace('AISLE-1');
    emit(pose(3, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');

    // The deliberate act TASK-200 asks for: somebody looked at the robot.
    manager.updateServerHeartbeat();
    expect(manager.resetEmergencyStop()).toBe(true);
    expect(manager.getSafetyStatus().estop.status).toBe('armed');

    // …and the guard stands down with it: normal `clear`/`violating` behaviour
    // resumes, so this is a HOLD, not a permanent latch.
    emit(pose(3, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('armed');
    emit(pose(4.5, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');
  });

  it('a re-anchor with nothing latched changes nothing about releasing', () => {
    const { manager, emit } = makeManager();
    emit(pose(3, 0));
    emit(pose(3, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('armed');

    manager.declarePlace('AISLE-1');
    emit(pose(4.5, 0)); // into the rack — still stops
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');
    emit(pose(3, 0)); // measurably clear, no re-anchor since — still releases
    expect(manager.getSafetyStatus().estop.status).toBe('armed');
  });
});
