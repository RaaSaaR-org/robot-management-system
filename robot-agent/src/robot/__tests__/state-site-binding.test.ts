/**
 * @file state-site-binding.test.ts
 * @description TASK-328: with no `PLACE_*` env, a robot loads the places of the
 *              site it is bound to (`GET /api/robots/:id/places`); a SIM robot
 *              treats that twin graph as registered, real hardware does not.
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

const TEST_ROBOT_ID = 'site-binding-test-robot';
const TWIN_ID = 'twin-demo-warehouse';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.resolve(HERE, `../../../data/state-${TEST_ROBOT_ID}.json`);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'site-binding-'));
const CACHE_PATH = path.join(TMP, 'place-graph-cache.json');
const ROBOT_CACHE = path.join(TMP, `place-graph-cache.robot-${TEST_ROBOT_ID}.json`);
const LOCAL_GRAPH = path.join(TMP, 'local.json');

/** What the server's twin place-graph export looks like for the Demo Warehouse. */
function siteGraph(frameOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    frame: {
      id: `twin-${TWIN_ID}`,
      kind: 'site',
      units: 'm',
      yawConvention: 'deg,+x=0,CCW+',
      twinId: TWIN_ID,
      ...frameOverrides,
    },
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
}

fs.writeFileSync(
  LOCAL_GRAPH,
  JSON.stringify({ ...siteGraph({ id: 'local-sim', kind: 'sim', twinId: undefined }) }),
  'utf-8',
);

vi.mock('../../config/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/config.js')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      robotId: TEST_ROBOT_ID,
      place: { ...actual.config.place, graphPath: '', twinId: '', refreshMs: 0, cachePath: CACHE_PATH },
    },
  };
});

const { RobotStateManager } = await import('../state.js');
const { hardwareClient } = await import('../../hardware/HardwareClient.js');
const { config: appConfig } = await import('../../config/config.js');

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

function pose(x: number, y: number): CachedBasePose {
  return { x, y, yawDeg: 0, source: 'sim', atMs: Date.now() };
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const SIM_FRAME: OdometryFrame = { kind: 'sim', id: 'warehouse' };
const ODOM_FRAME: OdometryFrame = { kind: 'odom', id: 'boot-1' };

function makeManager() {
  let emit: ((p: CachedBasePose | null) => void) | null = null;
  const spy = vi.spyOn(hardwareClient, 'onPoseSample').mockImplementation((cb) => {
    emit = cb;
    return () => {};
  });
  const manager = new RobotStateManager(makeConfig());
  spy.mockRestore();
  return {
    manager,
    emit: (p: CachedBasePose | null) => (emit as unknown as (p: CachedBasePose | null) => void)?.(p),
  };
}

describe('a robot loads its site places through its binding (TASK-328)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let odomFrame: OdometryFrame | null;
  const managers: Array<InstanceType<typeof RobotStateManager>> = [];

  function manager() {
    const m = makeManager();
    managers.push(m.manager);
    return m;
  }

  beforeEach(() => {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    for (const f of [CACHE_PATH, ROBOT_CACHE]) fs.rmSync(f, { force: true });
    appConfig.place.graphPath = '';
    appConfig.place.twinId = '';
    appConfig.place.refreshMs = 0;
    fetchMock = vi.fn(async () => json(200, siteGraph()));
    vi.stubGlobal('fetch', fetchMock);
    odomFrame = SIM_FRAME;
    vi.spyOn(hardwareClient, 'getOdometryFrame').mockImplementation(() => odomFrame);
    vi.spyOn(hardwareClient, 'locoStop').mockResolvedValue({ ok: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const m of managers.splice(0)) m.stopSimulation();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  });

  it('with no PLACE_* env, fetches /api/robots/:id/places', async () => {
    const { manager: m } = manager();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).not.toBeNull());
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(new RegExp(`/api/robots/${TEST_ROBOT_ID}/places$`));
  });

  it('a SIM robot treats the twin graph as registered: place resolves and siteAligned is true', async () => {
    const { manager: m, emit } = manager();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).not.toBeNull());

    // Two samples: a place commits on two consecutive qualifying resolves.
    emit(pose(0, 0));
    emit(pose(0, 0));

    expect(m.getPlaceFrameRegistration()).toEqual({ registered: true, how: 'sim-twin-origin' });
    expect(m.getState().location.place).toBe('STAGING');
    expect(m.getState().location.siteAligned).toBe(true);
  });

  it('a SIM robot fences the twin keepouts', async () => {
    const { manager: m, emit } = manager();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).not.toBeNull());

    emit(pose(4.5, 0));

    expect(m.getSafetyStatus().estop.status).toBe('triggered');
    expect(m.getSafetyEvents()[0]?.type).toBe('zone_violation');
  });

  it('re-assesses once the sidecar says it is a sim, after the graph was adopted', async () => {
    odomFrame = null; // sidecar not answered yet
    const { manager: m, emit } = manager();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).not.toBeNull());
    expect(m.getPlaceFrameRegistration()?.registered).toBe(false);

    odomFrame = SIM_FRAME;
    emit(pose(0, 0));
    emit(pose(0, 0));

    expect(m.getPlaceFrameRegistration()?.registered).toBe(true);
    expect(m.getState().location.place).toBe('STAGING');
  });

  it('REAL hardware bound to the same twin stays UNREGISTERED with the existing reason', async () => {
    odomFrame = ODOM_FRAME;
    const { manager: m, emit } = manager();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).not.toBeNull());

    emit(pose(0, 0));
    emit(pose(4.5, 0));

    const status = m.getPlaceFrameRegistration();
    expect(status?.registered).toBe(false);
    expect(status?.registered === false && status.reason).toContain('scan start');
    expect(m.getState().location.place).toBeNull();
    expect(m.getState().location.siteAligned).toBe(false);
    expect(m.getGeofenceState().enforcement).toBe('no-map');
    expect(m.getSafetyStatus().estop.status).toBe('armed');
  });

  it('an unbound robot (404 "robot has no site") keeps place UNKNOWN without an error', async () => {
    fetchMock.mockImplementation(async () => json(404, { error: 'robot has no site' }));
    const error = vi.spyOn(console, 'error');
    const { manager: m, emit } = manager();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    emit(pose(0, 0));

    expect(m.getPlaceBelief()).toBeNull();
    expect(m.getState().location.place ?? null).toBeNull();
    expect(m.getState().location.siteAligned).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });

  it('unbinding while running drops the graph on the next refresh', async () => {
    appConfig.place.refreshMs = 10;
    const { manager: m, emit } = manager();
    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).not.toBeNull());
    emit(pose(0, 0));
    emit(pose(0, 0));
    expect(m.getState().location.place).toBe('STAGING');

    fetchMock.mockImplementation(async () => json(404, { error: 'robot has no site' }));

    await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).toBeNull());
    expect(m.getState().location.place).toBeNull();
    expect(m.getState().location.siteAligned).toBeUndefined();
    expect(m.getPlaceBelief()).toBeNull();
  });

  it('boots from the per-robot disk cache when the server is unreachable', async () => {
    fs.writeFileSync(ROBOT_CACHE, JSON.stringify(siteGraph()), 'utf-8');
    fetchMock.mockImplementation(async () => {
      throw new Error('ECONNREFUSED');
    });

    const { manager: m, emit } = manager();
    // Adopted synchronously, before the fetch has even failed.
    expect(m.getPlaceFrameRegistration()).toEqual({ registered: true, how: 'sim-twin-origin' });
    emit(pose(0, 0));
    emit(pose(0, 0));
    expect(m.getState().location.place).toBe('STAGING');
  });

  describe('precedence: PLACE_GRAPH_PATH > PLACE_TWIN_ID > binding', () => {
    it('PLACE_TWIN_ID beats the binding', async () => {
      appConfig.place.twinId = TWIN_ID;
      const { manager: m } = manager();
      await vi.waitFor(() => expect(m.getPlaceFrameRegistration()).not.toBeNull());
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.every((u) => u.includes(`/api/digital-twins/${TWIN_ID}/places/_index.json`))).toBe(true);
    });

    it('PLACE_GRAPH_PATH beats both, and fetches nothing', () => {
      appConfig.place.graphPath = LOCAL_GRAPH;
      appConfig.place.twinId = TWIN_ID;
      const { manager: m } = manager();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(m.getPlaceFrameRegistration()).toEqual({ registered: true, how: 'identity' });
      // A sim-kind graph names no twin, so the robot is not site-aligned.
      expect(m.getState().location.siteAligned).toBe(false);
    });
  });
});
