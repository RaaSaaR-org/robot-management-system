/**
 * @file state-frame-registration.test.ts
 * @description TASK-342: a robot whose odometry is NOT the twin frame names
 *              places and fences keepouts only while a current frame
 *              registration relates the two — and loses them again when
 *              odometry re-zeroes (a new boot id) or the registration is removed.
 * @feature robot
 * @status test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RobotConfig } from '../types.js';
import type { CachedBasePose, OdometryFrame } from '../../hardware/HardwareClient.js';

const TEST_ROBOT_ID = 'frame-registration-test-robot';
const TWIN_ID = 'twin-demo-warehouse';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(HERE, `../../../data/state-${TEST_ROBOT_ID}.json`);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-registration-'));
const CACHE_PATH = path.join(TMP, 'place-graph-cache.json');

/** Staging around the twin origin, a keepout rack at x ∈ [4, 5]. */
const SITE_GRAPH = {
  version: 1,
  frame: { id: `twin-${TWIN_ID}`, kind: 'site', units: 'm', yawConvention: 'deg,+x=0,CCW+', twinId: TWIN_ID },
  places: [
    {
      id: 'STAGING',
      name: 'Staging',
      placeType: 'staging',
      floor: 0,
      polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]],
      source: 'surveyed',
      keepout: false,
      landmarks: [],
    },
    {
      id: 'RACK-A',
      name: 'Rack A',
      placeType: 'rack_face',
      floor: 0,
      polygon: [[4, -4], [5, -4], [5, 2], [4, 2]],
      source: 'surveyed',
      keepout: true,
      landmarks: [],
    },
  ],
};

/**
 * `twin = Rot(90°) · odom + (0, -3)`: odom (3, 0) is twin (0, 0) — in STAGING —
 * and odom (3, -4.5) is twin (4.5, 0), inside the rack.
 */
const REGISTRATION = {
  robotId: TEST_ROBOT_ID,
  twinId: TWIN_ID,
  odomFrameId: 'boot-1',
  x: 0,
  y: -3,
  yawDeg: 90,
  method: 'place-anchor',
  anchorPlaceId: 'STAGING',
  createdAt: '2026-09-30T00:00:00.000Z',
  current: true,
  staleReason: null,
};

vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      robotId: TEST_ROBOT_ID,
      place: {
        ...actual.config.place,
        graphPath: '',
        twinId: '',
        refreshMs: 0,
        registrationRefreshMs: 10,
        cachePath: CACHE_PATH,
      },
    },
  };
});

const { RobotStateManager } = await import('../state.js');
const { hardwareClient } = await import('../../hardware/HardwareClient.js');

function makeConfig(): RobotConfig {
  return {
    id: TEST_ROBOT_ID,
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
  return { x, y, yawDeg, source: 'odom', atMs: Date.now() };
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('a robot on odometry fences its site once registered (TASK-342)', () => {
  let registration: unknown;
  let odomFrame: OdometryFrame | null;
  let emit: (p: CachedBasePose | null) => void;
  let m: InstanceType<typeof RobotStateManager>;

  beforeEach(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    registration = null;
    odomFrame = { kind: 'odom', id: 'boot-1' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown) => {
        if (String(url).endsWith('/frame-registration')) {
          return registration ? json(200, registration) : json(404, { error: 'no frame registration' });
        }
        return json(200, SITE_GRAPH);
      }),
    );
    vi.spyOn(hardwareClient, 'getOdometryFrame').mockImplementation(() => odomFrame);
    vi.spyOn(hardwareClient, 'getCachedPose').mockReturnValue(null);
    vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let listener: ((p: CachedBasePose | null) => void) | null = null;
    const spy = vi.spyOn(hardwareClient, 'onPoseSample').mockImplementation((cb) => {
      listener = cb;
      return () => {};
    });
    m = new RobotStateManager(makeConfig());
    spy.mockRestore();
    emit = (p) => (listener as unknown as (p: CachedBasePose | null) => void)(p);
  });

  afterEach(() => {
    m.stopSimulation();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  });

  async function loaded(): Promise<void> {
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).not.toBeNull());
  }

  it('without a registration: not aligned, and the fence does not enforce', async () => {
    await loaded();
    emit(pose(3, -4.5));
    emit(pose(3, -4.5));

    const status = m.getPlaceFrameRegistration();
    expect(status?.registered).toBe(false);
    expect(status?.registered === false && status.reason).toContain('no frame registration');
    expect(m.getState().location.siteAligned).toBe(false);
    expect(m.getState().location.sitePose).toBeUndefined();
    expect(m.getGeofenceState().enforcement).toBe('no-map');
    expect(m.getSafetyStatus().estop.status).toBe('armed');
  });

  it('once registered: names the right place, reports its twin pose, and stops at the keepout', async () => {
    registration = REGISTRATION;
    await loaded();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()?.registered).toBe(true));
    expect(m.getPlaceFrameRegistration()).toMatchObject({ how: 'registration' });

    emit(pose(3, 0, 0));
    emit(pose(3, 0, 0));
    expect(m.getState().location.place).toBe('STAGING');
    expect(m.getState().location.siteAligned).toBe(true);
    // x/y stay raw odometry; sitePose is the twin pose.
    expect(m.getState().location.x).toBe(3);
    const site = m.getState().location.sitePose;
    expect(site?.x).toBeCloseTo(0, 9);
    expect(site?.y).toBeCloseTo(0, 9);
    expect(site?.heading).toBeCloseTo(90, 9);
    // Navigation and the map read the places in odometry.
    const rack = m.getPlaces().find((p) => p.id === 'RACK-A');
    expect(rack?.polygon[0][0]).toBeCloseTo(-1, 9);
    expect(rack?.polygon[0][1]).toBeCloseTo(-4, 9);

    emit(pose(3, -4.5));
    expect(m.getSafetyStatus().estop.status).toBe('triggered');
    expect(m.getSafetyEvents()[0]?.type).toBe('zone_violation');
  });

  it('a new odometry session (boot id) makes the registration stale', async () => {
    registration = REGISTRATION;
    await loaded();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()?.registered).toBe(true));
    emit(pose(3, 0));
    emit(pose(3, 0));
    expect(m.getState().location.place).toBe('STAGING');

    odomFrame = { kind: 'odom', id: 'boot-2' };
    emit(pose(3, -4.5));

    const status = m.getPlaceFrameRegistration();
    expect(status?.registered).toBe(false);
    expect(status?.registered === false && status.reason).toContain('odometry restarted');
    expect(m.getState().location.siteAligned).toBe(false);
    expect(m.getState().location.sitePose).toBeUndefined();
    expect(m.getGeofenceState().enforcement).toBe('no-map');
    expect(m.getSafetyStatus().estop.status).toBe('armed');
  });

  it('a registration removed on the platform is dropped on the next poll', async () => {
    registration = REGISTRATION;
    await loaded();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()?.registered).toBe(true));

    registration = null;
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()?.registered).toBe(false));
    expect(m.getState().location.siteAligned).toBe(false);
  });

  it('a platform that cannot be asked keeps the last registration', async () => {
    registration = REGISTRATION;
    await loaded();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()?.registered).toBe(true));

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(m.getPlaceFrameRegistration()?.registered).toBe(true);
  });
});
