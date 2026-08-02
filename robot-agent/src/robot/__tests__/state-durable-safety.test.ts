/**
 * @file state-durable-safety.test.ts
 * @description Restore semantics of the durable safety state (TASK-196): a
 *              robot that was E-Stopped comes back E-Stopped, the warning and
 *              the latch are never restored apart, and a snapshot older than
 *              PLACE_STALE_MS stops being treated as truth.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RobotConfig } from '../types.js';
import {
  StatePersistence,
  PERSISTED_STATE_VERSION,
  PLACE_STALE_MS,
  defaultPersistedAgentState,
  type PersistedAgentState,
  type PersistedState,
} from '../StatePersistence.js';

const TEST_ROBOT_ID = 'durable-safety-test-robot';

// Same resolution RobotStateManager uses for its per-robot state file.
const STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  `../../../data/state-${TEST_ROBOT_ID}.json`,
);

vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...actual,
    config: { ...actual.config, robotId: TEST_ROBOT_ID },
  };
});

const { RobotStateManager } = await import('../state.js');

const INITIAL_LOCATION = { x: 0, y: 0, floor: '1' };

function makeConfig(): RobotConfig {
  return {
    id: 'robot-1',
    name: 'TestBot',
    model: 'TestModel',
    robotClass: 'standard',
    robotType: 'so101',
    maxPayloadKg: 10,
    description: 'Test robot',
    initialLocation: { ...INITIAL_LOCATION },
    capabilities: ['navigation'],
  };
}

function writeState(opts: {
  ageMs?: number;
  warnings?: string[];
  agentState?: Partial<PersistedAgentState>;
}): PersistedState {
  const state: PersistedState = {
    version: PERSISTED_STATE_VERSION,
    savedAt: new Date(Date.now() - (opts.ageMs ?? 1000)).toISOString(),
    robotState: {
      status: 'online',
      batteryLevel: 37,
      location: { x: 11, y: 22, zone: 'AISLE-3', heading: 90, floor: '2' },
      heldObject: 'crate-7',
      speed: 0,
      errors: [],
      warnings: opts.warnings ?? [],
    },
    taskQueue: [],
    agentState: { ...defaultPersistedAgentState(), ...opts.agentState },
  };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

beforeEach(() => {
  // The debounced write triggered by the restored stop must not outlive the
  // test and recreate the fixture file after it was deleted.
  vi.useFakeTimers();
  fs.rmSync(STATE_FILE, { force: true });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(STATE_FILE, { force: true });
});

describe('RobotStateManager — a rebooted robot remembers it was stopped', () => {
  it('comes back LATCHED, with the warning that belongs to the latch', () => {
    writeState({
      agentState: {
        estopLatched: true,
        estopReason: 'Agent Mode E-Stop: operator pressed STOPP',
        estopAt: '2026-08-02T09:00:00.000Z',
      },
    });

    const mgr = new RobotStateManager(makeConfig());

    // The latch is real, not cosmetic: this is what refuses motion.
    expect(mgr.isEStopTriggered()).toBe(true);
    const estop = mgr.getEStopState();
    expect(estop.status).toBe('triggered');
    expect(estop.reason).toBe('Agent Mode E-Stop: operator pressed STOPP');
    expect(estop.triggeredAt).toBe('2026-08-02T09:00:00.000Z');
    // …and the warning came back WITH it.
    expect(mgr.getState().warnings.some((w) => w.includes('Emergency stop'))).toBe(true);
  });

  it('never restores the E-Stop warning without the latch', () => {
    // Exactly the state a v1 robot (or one stopped by a path that never
    // latched) left behind: the zombie warning, alone.
    writeState({
      warnings: ['Emergency stop activated: something from a previous life', 'battery low'],
      agentState: { estopLatched: false },
    });

    const mgr = new RobotStateManager(makeConfig());

    expect(mgr.isEStopTriggered()).toBe(false);
    const warnings = mgr.getState().warnings;
    expect(warnings.some((w) => w.includes('Emergency stop'))).toBe(false);
    expect(warnings.some((w) => w.includes('Protective stop'))).toBe(false);
    // Unrelated warnings are none of this rule's business.
    expect(warnings).toContain('battery low');
  });

  it('restores battery, pose and held object from a FRESH snapshot', () => {
    writeState({ ageMs: 5_000 });

    const mgr = new RobotStateManager(makeConfig());
    const state = mgr.getState();

    expect(state.batteryLevel).toBe(37);
    expect(state.location.x).toBe(11);
    expect(state.location.zone).toBe('AISLE-3');
    expect(state.heldObject).toBe('crate-7');
  });

  it('drops pose, place and held object when the snapshot is STALE', () => {
    writeState({
      ageMs: PLACE_STALE_MS + 60_000,
      agentState: { place: 'AISLE-3' },
    });

    const mgr = new RobotStateManager(makeConfig());
    const state = mgr.getState();

    // A robot that was carried while powered off must not report its old pose.
    expect(state.location.x).toBe(INITIAL_LOCATION.x);
    expect(state.location.y).toBe(INITIAL_LOCATION.y);
    expect(state.location.zone).toBeUndefined();
    expect(state.heldObject).toBeUndefined();
    expect(mgr.getAgentSafetyState().place).toBeNull();
    // Battery does not go stale the way a pose does.
    expect(state.batteryLevel).toBe(37);
  });

  it('exposes what it read for Agent Mode to re-latch itself from', () => {
    writeState({
      agentState: {
        estopLatched: true,
        estopReason: 'Agent Mode E-Stop: stop word',
        damped: true,
        lastFsmId: 1,
        bootId: 'b-7f3a',
      },
    });

    const restored = new RobotStateManager(makeConfig()).getRestoredAgentState();

    expect(restored).not.toBeNull();
    expect(restored!.estopLatched).toBe(true);
    expect(restored!.damped).toBe(true);
    expect(restored!.lastFsmId).toBe(1);
    expect(restored!.bootId).toBe('b-7f3a');
  });

  it('reports nothing restored when there is no state file', () => {
    const mgr = new RobotStateManager(makeConfig());

    expect(mgr.getRestoredAgentState()).toBeNull();
    expect(mgr.isEStopTriggered()).toBe(false);
    expect(mgr.getAgentSafetyState()).toEqual(defaultPersistedAgentState());
  });

  it('writes a file it can read back — the hardcoded-version regression guard', () => {
    const mgr = new RobotStateManager(makeConfig());
    mgr.setAgentSafetyState({ estopLatched: true, estopReason: 'because' });
    mgr.saveStateSync();

    const onDisk: unknown = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    expect((onDisk as PersistedState).version).toBe(PERSISTED_STATE_VERSION);

    const loaded = new StatePersistence(STATE_FILE).load();
    expect(loaded).not.toBeNull();
    expect(loaded!.agentState.estopLatched).toBe(true);
    expect(loaded!.agentState.estopReason).toBe('because');
  });

  it('persists an E-Stop taken on a path that never reaches Agent Mode', () => {
    const mgr = new RobotStateManager(makeConfig());

    mgr.triggerEmergencyStop('remote', 'fleet-wide stop');

    const durable = mgr.getAgentSafetyState();
    expect(durable.estopLatched).toBe(true);
    expect(durable.estopReason).toBe('fleet-wide stop');
    expect(durable.estopAt).not.toBeNull();
  });

  it('clears the durable latch only when the monitor granted the reset', () => {
    const mgr = new RobotStateManager(makeConfig());
    mgr.triggerEmergencyStop('remote', 'fleet-wide stop');

    // The monitor refuses while the server link is down, which is the state at
    // boot — the latch must stay on disk.
    expect(mgr.resetEmergencyStop()).toBe(false);
    expect(mgr.getAgentSafetyState().estopLatched).toBe(true);

    mgr.updateServerHeartbeat();
    expect(mgr.resetEmergencyStop()).toBe(true);
    expect(mgr.getAgentSafetyState().estopLatched).toBe(false);
    expect(mgr.getAgentSafetyState().estopReason).toBeNull();
  });

  it('migrates a v1 file in place instead of losing the robot state', () => {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        robotState: {
          status: 'online',
          batteryLevel: 64,
          location: { x: 5, y: 6, floor: '1' },
          speed: 0,
          errors: [],
          warnings: [],
        },
        taskQueue: [],
      }),
      'utf-8',
    );

    const mgr = new RobotStateManager(makeConfig());

    expect(mgr.getState().batteryLevel).toBe(64);
    expect(mgr.getState().location.x).toBe(5);
    expect(mgr.isEStopTriggered()).toBe(false);
    expect(mgr.getRestoredAgentState()).toEqual(defaultPersistedAgentState());
  });
});
