/**
 * @file state-place-awareness.test.ts
 * @description The pose seam end to end inside the state manager (TASK-195):
 *              samples arrive from the HardwareClient poll (NOT the block
 *              executor), drive `RobotLocation`, resolve to a place with
 *              hysteresis, and go honestly UNKNOWN when the pose disappears.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RobotConfig } from '../types.js';
import type { CachedBasePose } from '../../hardware/HardwareClient.js';

const TEST_ROBOT_ID = 'place-awareness-test-robot';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(HERE, `../../../data/state-${TEST_ROBOT_ID}.json`);
const WAREHOUSE_GRAPH = path.resolve(
  HERE,
  '../../../hardware/sim_evaluator/places/places.warehouse.json',
);

// NOTE: `HardwareClient` and `state.js` are imported DYNAMICALLY below, after
// these constants exist. A static import of either would pull `config.js` in
// during module evaluation — i.e. before the constants the hoisted mock
// factory closes over are initialized.
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

function makeConfig(): RobotConfig {
  return {
    id: 'robot-1',
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

function pose(x: number, y: number, yawDeg = 0): CachedBasePose {
  return { x, y, yawDeg, source: 'sim', atMs: Date.now() };
}

/**
 * Build a manager and hand back the pose callback it registered on the
 * hardware poll. Capturing it is the point of the test: if a future change
 * moves the sampling into `BlockExecutor`, this spy stops seeing anything.
 */
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

describe('RobotStateManager — place awareness', () => {
  beforeEach(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  });

  it('subscribes to the HARDWARE POLL, not to block completions', () => {
    const { emit } = makeManager();
    // Teleop and VLA rollouts never touch a block; a place derived from block
    // completions would be silently wrong the moment a human takes over.
    expect(emit).toBeTypeOf('function');
  });

  it('drives x / y / heading / place from the sampled pose', () => {
    const { manager, emit } = makeManager();

    emit(pose(9, 0, 45));
    emit(pose(9, 0, 45));

    const location = manager.getState().location;
    expect(location.x).toBe(9);
    expect(location.y).toBe(0);
    expect(location.heading).toBe(45);
    expect(location.place).toBe('AISLE-3');
    expect(manager.getPlaceBelief()?.place?.name).toBe('Aisle 3');
  });

  it('holds the place across the hysteresis band and commits past it', () => {
    const { manager, emit } = makeManager();
    emit(pose(0, 0));
    emit(pose(0, 0));
    expect(manager.getState().location.place).toBe('STAGING');

    // 0.1 m past the shared edge at x = 2.0 — inside AISLE-1, not convincingly.
    emit(pose(2.1, 0));
    expect(manager.getState().location.place).toBe('STAGING');

    emit(pose(2.5, 0));
    expect(manager.getState().location.place).toBe('STAGING');
    emit(pose(2.6, 0));
    expect(manager.getState().location.place).toBe('AISLE-1');
  });

  it('goes UNKNOWN when the pose disappears — never the last place', () => {
    const { manager, emit } = makeManager();
    emit(pose(9, 0));
    emit(pose(9, 0));
    expect(manager.getState().location.place).toBe('AISLE-3');

    emit(null);

    expect(manager.getState().location.place).toBeNull();
    expect(manager.getPlaceBelief()).toEqual({
      place: null,
      poseM: null,
      poseSource: null,
      driftSinceAnchorM: null,
      ageMs: null,
      insideKeepout: null,
    });
    // The last KNOWN coordinates stay in `location` (the robot is physically
    // still there) but the claim about which place that is, is withdrawn.
    expect(manager.getState().location.x).toBe(9);
  });

  it('records the place in the durable safety state so a reboot inherits it', () => {
    const { manager, emit } = makeManager();
    emit(pose(-7, 0));
    emit(pose(-7, 0));

    expect(manager.getAgentSafetyState().place).toBe('DOCK-1');

    emit(null);
    expect(manager.getAgentSafetyState().place).toBeNull();
  });

  it('reports UNKNOWN before any sample rather than the configured start pose', () => {
    const { manager } = makeManager();
    // `initialLocation` is a guess the operator made, not a claim the robot
    // invented about where it woke up.
    expect(manager.getPlaceBelief()?.place).toBeNull();
    expect(manager.getState().location.place).toBeUndefined();
  });
});

// ============================================================================
// TASK-200 — the enforced geofence, end to end inside the state manager
// ============================================================================

describe('RobotStateManager — geofence (TASK-200)', () => {
  beforeEach(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A protective stop now ACTUATES (TASK-200 review): it commands the base to
    // stop. Stubbed so these tests stay offline — the actuation itself is
    // asserted in state-geofence-actuation.test.ts.
    vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  });

  /**
   * The shipped warehouse graph fences RACK-A at x ∈ [4, 5], y ∈ [-4, 2] —
   * the wall between AISLE-1 and AISLE-2. Walking east down the aisle is the
   * sim equivalent of "drive into a keepout".
   */
  it('walking into RACK-A takes a zone_violation protective stop', () => {
    const { manager, emit } = makeManager();

    emit(pose(3, 0)); // AISLE-1, well clear
    emit(pose(3, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('armed');
    expect(manager.getPlaceBelief()?.insideKeepout).toBe(false);

    emit(pose(4.5, 0)); // inside the rack

    expect(manager.getPlaceBelief()?.insideKeepout).toBe(true);
    const estop = manager.getSafetyStatus().estop;
    expect(estop.status).toBe('triggered');
    expect(estop.reason).toContain('Rack A');
    expect(manager.getSafetyEvents()[0]?.type).toBe('zone_violation');
  });

  it('fires on the MARGIN, while the robot is still outside the polygon', () => {
    const { manager, emit } = makeManager();
    // 0.2 m short of the rack face at x = 4 — inside the 0.5 m margin.
    emit(pose(3.8, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');
  });

  it('losing the pose neither triggers a stop nor releases one', () => {
    const { manager, emit } = makeManager();

    emit(null);
    emit(null);
    expect(manager.getSafetyStatus().estop.status).toBe('armed');

    emit(pose(4.5, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');

    // The sidecar drops the poll. Not seeing the robot is not evidence it left.
    emit(null);
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');
    expect(manager.getPlaceBelief()?.insideKeepout).toBeNull();
  });

  it('releases once the robot is measurably clear again', () => {
    const { manager, emit } = makeManager();
    emit(pose(4.5, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');

    emit(pose(3, 0)); // back down the aisle, past margin + clearance

    expect(manager.getSafetyStatus().estop.status).toBe('armed');
    expect(manager.getState().warnings.some((w) => w.includes('Keepout violated'))).toBe(false);
  });

  it('a STALE pose inside the rack does not trigger a stop', () => {
    const { manager, emit } = makeManager();

    // Spend the drift budget pacing inside AISLE-1 (15 m by default), so the
    // belief degrades to `stale` before the robot ever reaches the rack.
    emit(pose(3, -3));
    for (let i = 0; i < 5; i++) {
      emit(pose(3, 1));
      emit(pose(3, -3));
    }
    expect(manager.getPlaceBelief()?.place?.confidence).toBe('stale');

    emit(pose(4.5, 0));

    expect(manager.getSafetyStatus().estop.status).toBe('armed');
    expect(manager.getPlaceBelief()?.insideKeepout).toBeNull();
  });

  it('an operator re-anchor declares the place and resets the drift budget', () => {
    const { manager, emit } = makeManager();
    emit(pose(9, -3));
    for (let i = 0; i < 5; i++) {
      emit(pose(9, 1));
      emit(pose(9, -3));
    }
    expect(manager.getPlaceBelief()?.place?.confidence).toBe('stale');

    const declared = manager.declarePlace('AISLE-3');

    expect(declared).toMatchObject({ id: 'AISLE-3', source: 'declared', confidence: 'confident' });
    expect(manager.getPlaceBelief()?.driftSinceAnchorM).toBe(0);
    expect(manager.getState().location.place).toBe('AISLE-3');
  });

  it('a re-anchor onto a place the graph does not have changes nothing', () => {
    const { manager, emit } = makeManager();
    emit(pose(9, 0));
    emit(pose(9, 0));
    expect(manager.declarePlace('CANTEEN')).toBeNull();
    expect(manager.getPlaceBelief()?.place?.id).toBe('AISLE-3');
  });

  it('exposes the graph places so the re-anchor parser has a vocabulary', () => {
    const { manager } = makeManager();
    expect(manager.getPlaces().map((p) => p.id)).toContain('RACK-A');
  });
});
