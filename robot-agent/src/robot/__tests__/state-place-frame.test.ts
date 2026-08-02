/**
 * @file state-place-frame.test.ts
 * @description TASK-200 review, finding 2: nothing registers the robot's
 *              odometry origin to the place graph's frame, so a twin-derived
 *              graph is compared against coordinates about a different origin.
 *              This asserts the FAIL-CLOSED behaviour: no place is named and no
 *              keepout is judged until somebody registers the two frames.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RobotConfig } from '../types.js';
import type { CachedBasePose } from '../../hardware/HardwareClient.js';

const TEST_ROBOT_ID = 'place-frame-test-robot';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(HERE, `../../../data/state-${TEST_ROBOT_ID}.json`);

/**
 * The same warehouse geometry, re-labelled as what it would be if it had come
 * out of a scan: a `site` frame belonging to a DigitalTwin, whose origin is
 * `ScanSession.originX/Y` — the robot's pose when somebody pressed scan.
 */
const TWIN_GRAPH = path.join(os.tmpdir(), `places.twin.${TEST_ROBOT_ID}.json`);
fs.writeFileSync(
  TWIN_GRAPH,
  JSON.stringify({
    version: 1,
    frame: {
      id: 'site-1',
      kind: 'site',
      units: 'm',
      yawConvention: 'deg,+x=0,CCW+',
      twinId: 'twin-42',
    },
    places: [
      {
        id: 'AISLE-1',
        name: 'Aisle 1',
        placeType: 'aisle',
        floor: 0,
        polygon: [
          [2, -4],
          [4, -4],
          [4, 2],
          [2, 2],
        ],
        source: 'surveyed',
        keepout: false,
        landmarks: [],
      },
      {
        id: 'RACK-A',
        name: 'Rack A',
        placeType: 'rack_face',
        floor: 0,
        polygon: [
          [4, -4],
          [5, -4],
          [5, 2],
          [4, 2],
        ],
        source: 'surveyed',
        keepout: true,
        landmarks: [],
      },
    ],
  }),
  'utf-8',
);

vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      robotId: TEST_ROBOT_ID,
      place: { ...actual.config.place, graphPath: TWIN_GRAPH },
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

describe('an UNREGISTERED place frame fails closed (TASK-200 review, finding 2)', () => {
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

  it('says so, in a reason an operator can act on', () => {
    const { manager } = makeManager();
    const status = manager.getPlaceFrameRegistration();
    expect(status?.registered).toBe(false);
    expect(status?.registered === false && status.reason).toContain('twin-42');
  });

  it('names NO place, however confidently the pose falls inside a polygon', () => {
    // This is the exact failure the honest-null rule cannot catch: the pose IS
    // finite and it DOES fall inside AISLE-1. It is just a pose about a
    // different origin, so the name would be fiction.
    const { manager, emit } = makeManager();

    emit(pose(3, 0));
    emit(pose(3, 0));

    expect(manager.getState().location.place).toBeNull();
    expect(manager.getPlaceBelief()?.place).toBeNull();
    // The COORDINATES are real and measured — they keep driving the pose.
    expect(manager.getState().location.x).toBe(3);
  });

  it('does NOT fence: standing inside a keepout takes no stop', () => {
    // Fail-closed cuts both ways and that is the point: an unregistered frame
    // must not fire a spurious stop either, because the polygon it would be
    // stopping for is somewhere else entirely.
    const { manager, emit } = makeManager();

    emit(pose(4.5, 0));

    expect(manager.getSafetyStatus().estop.status).toBe('armed');
    expect(manager.getSafetyEvents()).toHaveLength(0);
    // Three-valued and honest: not `false`, which would read as "safe".
    expect(manager.getPlaceBelief()?.insideKeepout).toBeNull();
  });

  /**
   * TASK-200 review, residual finding: the declaration survived, and then
   * survived FOREVER. The blocked branch read `tracker.current()` instead of
   * feeding the sample to the tracker, so `driftSinceAnchorM` never moved and
   * `lastPose` never advanced — the reviewer's probe declared AISLE-1 at x=3,
   * walked 200 m, and still got `confidence=confident drift=0`.
   *
   * Odometry TRANSLATION is frame-independent: the unknown is the origin
   * offset, not the metre. So the drift budget applies whether or not the two
   * frames are registered, and a declared place goes `stale` on it either way.
   */
  it('spends the drift budget on an unregistered frame, exactly as on a registered one', () => {
    const { manager, emit } = makeManager();
    emit(pose(3, 0));

    expect(manager.declarePlace('AISLE-1')).toMatchObject({
      id: 'AISLE-1',
      confidence: 'confident',
    });

    // The probe, verbatim: 100 samples out to x = 203.
    for (let i = 1; i <= 100; i++) emit(pose(3 + i * 2, 0));

    const belief = manager.getPlaceBelief();
    // Still AISLE-1 — nothing here overrules the operator, and geometry is
    // still not consulted (x=203 is inside no polygon at all).
    expect(belief?.place?.id).toBe('AISLE-1');
    // …but the robot no longer pretends to be sure of it.
    expect(belief?.place?.confidence).toBe('stale');
    expect(belief?.driftSinceAnchorM).toBeCloseTo(200, 5);
    expect(belief?.poseM).toEqual({ x: 203, y: 0 });
    // The pose itself is untouched by any of this.
    expect(manager.getState().location.x).toBe(203);
  });

  it('stays `confident` inside the budget — the fix does not make everything stale', () => {
    const { manager, emit } = makeManager();
    emit(pose(3, 0));
    manager.declarePlace('AISLE-1');

    // 5 m, well inside the 15 m budget.
    for (let i = 1; i <= 5; i++) emit(pose(3 + i, 0));

    expect(manager.getPlaceBelief()?.place?.confidence).toBe('confident');
    expect(manager.getPlaceBelief()?.driftSinceAnchorM).toBeCloseTo(5, 5);
  });

  it('a fresh declaration after the drift re-arms the budget', () => {
    // The operator can see the robot; saying where it is spends the budget
    // afresh. That is the whole re-anchor contract, and it must still work in
    // an unregistered frame — which is precisely where it is needed most.
    const { manager, emit } = makeManager();
    emit(pose(3, 0));
    manager.declarePlace('AISLE-1');
    for (let i = 1; i <= 100; i++) emit(pose(3 + i * 2, 0));
    expect(manager.getPlaceBelief()?.place?.confidence).toBe('stale');

    expect(manager.declarePlace('AISLE-1')).toMatchObject({ confidence: 'confident' });
    emit(pose(204, 0));
    expect(manager.getPlaceBelief()?.place?.confidence).toBe('confident');
    expect(manager.getPlaceBelief()?.driftSinceAnchorM).toBeCloseTo(1, 5);
  });

  it('an unregistered frame still names NO place once the drift made it stale', () => {
    // Fail-closed is unchanged by the fix: with no declaration at all, a
    // hundred samples inside AISLE-1's polygon still name nothing.
    const { manager, emit } = makeManager();

    for (let i = 0; i < 100; i++) emit(pose(3, 0.01 * i));

    expect(manager.getPlaceBelief()?.place).toBeNull();
    expect(manager.getState().location.place).toBeNull();
  });

  it('keeps an operator DECLARATION, which does not depend on the frame', () => {
    // A human who can see the robot does not need the two origins registered.
    const { manager, emit } = makeManager();
    emit(pose(3, 0));

    expect(manager.declarePlace('AISLE-1')).toMatchObject({ id: 'AISLE-1', source: 'declared' });
    emit(pose(3.2, 0));
    expect(manager.getPlaceBelief()?.place?.id).toBe('AISLE-1');

    // …and it still dies with the pose.
    emit(null);
    expect(manager.getPlaceBelief()?.place).toBeNull();
    emit(pose(3, 0));
    expect(manager.getPlaceBelief()?.place).toBeNull();
  });
});
