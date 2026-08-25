/**
 * @file state-geofence-enforcement.test.ts
 * @description TASK-201: when the keepout fence stops fencing, SAY SO.
 * @feature robot
 * @status test
 *
 * The integration test the task asks for, and the shape of its assertion is the
 * point. `state-geofence-actuation.test.ts` asserts "a stop fires", and that is
 * exactly what let this defect through: below the drift budget a stop DOES
 * fire, so the suite was green while a robot with a spent budget walked through
 * a rack with `estop=armed` and `systemHealthy=true`.
 *
 * So the load-bearing assertion here is a DISJUNCTION — after driving past the
 * budget and walking at a keepout, either a stop fires OR the published state
 * says enforcement is off. Both branches are acceptable robot behaviour; being
 * in neither is the bug.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RobotConfig } from '../types.js';
import type { CachedBasePose } from '../../hardware/HardwareClient.js';

const TEST_ROBOT_ID = 'geofence-enforcement-test-robot';

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
const { config: appConfig } = await import('../../config/config.js');
const { GEOFENCE_ADVISORY_PREFIX } = await import('../../safety/types.js');

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
 * Pace inside CROSS-AISLE until the drift budget is spent.
 *
 * Two properties matter and both are deliberate:
 *
 *  - It never approaches RACK-A (x ∈ [4, 5]) or RACK-B (x ∈ [7, 8]), so nothing
 *    here trips the fence — the budget is spent by ordinary errands, which is
 *    the observed scenario: 15 m is ~0.75 of one 20 m hall traverse.
 *  - The PLACE ID NEVER CHANGES. That is the trap TASK-201 names: `onPoseSample`
 *    used to bail out early on an unchanged place id, so anything that only
 *    fired on a place change could not see this at all.
 */
function driveUntilStale(emit: (p: CachedBasePose | null) => void): number {
  let metres = 0;
  emit(pose(-5, 4));
  for (let leg = 0; metres <= appConfig.place.driftBudgetM + 5; leg++) {
    emit(pose(leg % 2 === 0 ? 0 : -5, 4));
    metres += 5;
  }
  return metres;
}

describe('a fence that has stopped fencing SAYS SO (TASK-201)', () => {
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

  /**
   * THE regression test. Written as the task specifies: assert the disjunction,
   * never "a stop fires" alone.
   */
  it('drive past the budget, then walk at a keepout: either a stop fires or the state says the fence is off', () => {
    const { manager, emit } = makeManager();

    const metres = driveUntilStale(emit);
    expect(metres).toBeGreaterThan(appConfig.place.driftBudgetM);
    expect(manager.getPlaceBelief()?.place?.confidence).toBe('stale');

    // Now walk straight at RACK-A — deep inside the margined keepout, the very
    // pose that stops the robot dead when the budget is intact.
    emit(pose(4.5, 0));

    const stopped = manager.getSafetyStatus().estop.status === 'triggered';
    const saysNotEnforcing = manager.getGeofenceState().enforcement === 'not-enforcing';

    // One of the two must be true. Being in NEITHER is the defect: the robot
    // walks through the rack and every published surface says it is fine.
    expect(stopped || saysNotEnforcing).toBe(true);

    // And, for this build, it is specifically the second — recorded rather than
    // merely allowed, so a future change that starts stopping here (a real
    // re-localisation, say) fails loudly instead of silently redefining what
    // this test proves.
    expect(stopped).toBe(false);
    expect(saysNotEnforcing).toBe(true);
  });

  /**
   * The other half of the same claim, and the reason the disjunction above is
   * not vacuous: with the budget intact the identical pose stops the robot AND
   * the fence reports itself as enforcing.
   */
  it('control: with the budget intact the same pose stops the robot and the fence reads enforcing', () => {
    const { manager, emit } = makeManager();

    emit(pose(3, 0)); // AISLE-1, comfortably clear
    expect(manager.getGeofenceState().enforcement).toBe('enforcing');

    emit(pose(4.5, 0));
    expect(manager.getSafetyStatus().estop.status).toBe('triggered');
    expect(manager.getGeofenceState().enforcement).toBe('enforcing');
  });

  /**
   * The trap named in the task, pinned on its own.
   *
   * `onPoseSample` had a BARE `return` when the place id had not changed, and
   * the observed failure is a constant place id while the budget trips. A
   * transition detected after that gate can never fire, so this asserts the
   * listeners hear about the lapse with the place id pinned to one value the
   * whole way through.
   */
  it('notifies listeners when only enforcement changed — the place id never moves', () => {
    const { manager, emit } = makeManager();

    // Settle into CROSS-AISLE first: the resolver needs consecutive confirming
    // samples before it commits a place. Repeating one pose costs zero drift.
    emit(pose(-5, 4));
    emit(pose(-5, 4));
    emit(pose(-5, 4));
    expect(manager.getState().location.place).toBe('CROSS-AISLE');

    let notifications = 0;
    const unsubscribe = manager.subscribe(() => {
      notifications++;
    });

    driveUntilStale(emit);

    // The whole drive happened inside one place: nothing about the PLACE
    // changed, and the old code published nothing at all for this run.
    expect(manager.getState().location.place).toBe('CROSS-AISLE');
    expect(manager.getGeofenceState().enforcement).toBe('not-enforcing');
    expect(notifications).toBeGreaterThan(0);

    unsubscribe();
  });

  /**
   * Logged on the TRANSITION, not latched once. The state flips back and forth
   * as an operator re-anchors and the budget is spent again; a one-shot latch
   * would report the first lapse and stay silent for every later one — which is
   * indistinguishable from the fence having recovered.
   */
  it('logs every transition, not just the first — a latch would hide the second lapse', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { manager, emit } = makeManager();

    const lapses = () =>
      warn.mock.calls.filter((c) => String(c[0]).includes('Geofence: enforcing → not-enforcing'))
        .length;

    driveUntilStale(emit);
    expect(manager.getGeofenceState().enforcement).toBe('not-enforcing');
    expect(lapses()).toBe(1);

    // An operator re-anchors: the budget is spent afresh, the fence enforces
    // again, and the next errand spends it again.
    expect(manager.declarePlace('CROSS-AISLE')).not.toBeNull();
    emit(pose(-5, 4));
    expect(manager.getGeofenceState().enforcement).toBe('enforcing');

    driveUntilStale(emit);
    expect(manager.getGeofenceState().enforcement).toBe('not-enforcing');
    expect(lapses()).toBe(2);
  });

  /**
   * The lapse and the healthy-looking safety payload must arrive TOGETHER —
   * that pairing is the operator's whole evidence. It is a warning and only a
   * warning: it must not flip `systemHealthy`, which belongs to the stop path.
   */
  it('surfaces the advisory in /safety warnings without flipping systemHealthy', () => {
    const { manager, emit } = makeManager();
    driveUntilStale(emit);

    const status = manager.getSafetyStatus();
    expect(status.warnings.some((w) => w.startsWith(GEOFENCE_ADVISORY_PREFIX))).toBe(true);
    // Warn-only, modelled on `tiltWarning`: nothing here touches `estopState`.
    expect(status.systemHealthy).toBe(true);
    expect(status.estop.status).toBe('armed');
  });

  /**
   * The value the field STARTS at, before any pose has been evaluated.
   *
   * `no-map` is the right initial answer and `enforcing` would be the wrong one
   * for the same reason the whole task exists: a fence nobody has run yet is
   * not a fence that works. It is not a lapse either — a `not-enforcing`
   * default would put a permanent amber condition on every robot between boot
   * and its first odometry sample, which is how a real lapse gets lost in
   * wallpaper.
   *
   * NOTE this robot DOES have a place graph (see the `vi.mock` above): it
   * reports `no-map` because nothing has been evaluated, not because nothing
   * was surveyed. The un-surveyed and unregistered-frame paths are covered in
   * `state-place-frame.test.ts`, which owns a graph that cannot be compared
   * with the robot's odometry.
   */
  it('reads `no-map` before the first pose sample, and raises no advisory', () => {
    const { manager } = makeManager();
    expect(manager.getGeofenceState().enforcement).toBe('no-map');
    expect(
      manager.getSafetyStatus().warnings.some((w) => w.startsWith(GEOFENCE_ADVISORY_PREFIX)),
    ).toBe(false);
  });
});
