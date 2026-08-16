/**
 * @file peers-plumbing.test.ts
 * @description The seam between the peer tracker and the two things that read
 *              it (TASK-207): the map's dynamic overlay gets every accepted
 *              peer; scene memory gets only the ones the robot would notice —
 *              within AGENT_PEERS_NOTICE_M and inside ±90° of heading — with
 *              `distanceSource: 'fleet'`, and nothing at all without an own pose.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { SceneMemoryStore } from '../scene-memory.js';
import { PeerTracker, type FleetPeer } from '../peers.js';
import { MapKeeper } from '../occupancy-map-keeper.js';
import { RangeSensor } from '../range.js';
import type { Planner } from '../planner.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient } from '../vision.js';
import type { CachedBasePose } from '../../hardware/HardwareClient.js';
import type { RobotStateManager } from '../../robot/state.js';
import type { PointCloudFrame } from '../../robot/types.js';

const FRAME = { kind: 'sim' as const, id: 'room' };

const peer = (over: Partial<FleetPeer> = {}): FleetPeer => ({
  robotId: 'robot-b',
  name: 'Bravo',
  x: 2,
  y: 0,
  headingDeg: 0,
  frame: FRAME,
  place: null,
  zone: null,
  updatedAt: '2026-08-15T10:00:00.000Z',
  poseAgeMs: null, // server says nothing about pose age unless a test says so
  footprintRadiusM: 0.35,
  ...over,
});

function wallFrame(distM = 6): PointCloudFrame {
  const pts: number[] = [];
  for (let i = 0; i < 81; i++) pts.push(distM, -2 + i * 0.05, 1.0);
  return {
    robotId: 'r1',
    sensor: 'mid360_lidar',
    sensorType: 'lidar',
    frame: 'base_link',
    pointCount: 81,
    positions: pts,
    intensities: [],
    hasIntensity: false,
    sequence: 0,
    source: 'hardware',
    timestamp: new Date().toISOString(),
  };
}

function rig(pose: () => CachedBasePose | null) {
  const scene = new SceneMemoryStore('robot-a');
  const tracker = new PeerTracker({
    enabled: true,
    pollMs: 2000,
    serverUrl: 'http://s',
    robotId: 'robot-a',
    getFrame: () => FRAME,
    log: () => {},
  });
  const range = new RangeSensor({ snapshot: async () => wallFrame(), cacheMs: 0 });
  const mapKeeper = new MapKeeper({
    enabled: true,
    range,
    getPose: pose,
    getBootId: () => 'boot-a',
    log: () => {},
  });
  const controller = new AgentModeController({
    robotId: 'robot-a',
    enabled: false,
    scene,
    peerTracker: tracker,
    mapKeeper,
    getPose: pose,
    lock: new ControlOwnerLock(),
    planner: { plan: async () => ({ blocks: [] }) } as unknown as Planner,
    vision: { observe: async () => null } as unknown as VisionClient,
    mirror: { logBlock: async () => {}, pushState: async () => {}, logPlan: async () => {} } as unknown as ServerMirror,
  });
  controller.attach({ getPlaceBelief: () => null } as unknown as RobotStateManager);
  return { controller, scene, tracker, range, mapKeeper };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('peer plumbing', () => {
  it('notices a peer ahead and within range, as a fleet-sourced entity the planner can read', () => {
    const { controller, scene, tracker } = rig(() => ({ x: 0, y: 0, yawDeg: 0, source: 'sim', atMs: Date.now() }));
    tracker.ingest([peer({ x: 2, y: 0.5 })]);
    // getScene() is null before any observation — the fleet still shows in the summary.
    expect(controller.getScene()).toBeNull();
    expect(scene.listEntities()).toHaveLength(1);
    expect(scene.listEntities()[0]).toMatchObject({
      label: 'robot Bravo',
      distanceSource: 'fleet',
      distanceEstM: 2.1,
    });
    expect(Math.round(scene.listEntities()[0].bearingDeg)).toBe(14);
    expect(scene.summary()).toContain('robot Bravo');
    expect(scene.summary()).toContain('fleet-reported');
    expect(controller.peers()).toHaveLength(1);
  });

  it('ignores a peer behind the robot or beyond the notice radius, but still blocks the map with it', async () => {
    const { controller, scene, tracker, range, mapKeeper } = rig(() => ({
      x: 0,
      y: 0,
      yawDeg: 0,
      source: 'sim',
      atMs: Date.now(),
    }));
    // Give the keeper a map first (a fresh frame at the robot's pose).
    for (let i = 0; i < 4; i++) await range.measure([0]);
    await flush();
    tracker.ingest([
      peer({ robotId: 'behind', name: 'Behind', x: -1.5, y: 0 }),
      peer({ robotId: 'far', name: 'Far', x: 4, y: 0 }),
      peer({ robotId: 'side', name: 'Side', x: 0, y: 1.5 }), // exactly 90°: still noticed
    ]);
    controller.getState();
    expect(scene.listEntities().map((e) => e.label)).toEqual(['robot Side']);
    const map = mapKeeper.getMap()!;
    expect(map.getDynamicObstacles().map((o) => o.label).sort()).toEqual(['robot Behind', 'robot Far', 'robot Side']);
    expect(map.isTraversable(4, 0, 0.3)).toBe(false);
  });

  it('says nothing about peers without an own pose — bearings would be fiction', () => {
    const { controller, scene, tracker } = rig(() => null);
    tracker.ingest([peer({ x: 1, y: 0 })]);
    controller.getState();
    expect(scene.listEntities()).toEqual([]);
    expect(controller.peers()).toHaveLength(1); // still tracked, just not spoken about
  });

  it('turns with the robot: a peer ahead stops being noticed once the robot turns away', () => {
    let yaw = 0;
    const { controller, scene, tracker } = rig(() => ({ x: 0, y: 0, yawDeg: yaw, source: 'sim', atMs: Date.now() }));
    tracker.ingest([peer({ x: 2, y: 0 })]);
    controller.getState();
    expect(scene.listEntities()).toHaveLength(1);
    yaw = 180;
    controller.getState(); // the render pull re-derives bearings from the CURRENT pose
    expect(scene.listEntities()).toEqual([]);
  });

  it('exposes peer status for /map and reports a controller without a tracker honestly', () => {
    const { controller, tracker } = rig(() => null);
    tracker.ingest([peer(), peer({ robotId: 'x', frame: { kind: 'odom', id: 'other' } })]);
    expect(controller.peerStatus()).toMatchObject({ enabled: true, peers: 1, dropped: 1 });
    const bare = new AgentModeController({
      robotId: 'robot-a',
      enabled: false,
      peerTracker: null,
      mapKeeper: null,
      lock: new ControlOwnerLock(),
      planner: { plan: async () => ({ blocks: [] }) } as unknown as Planner,
      vision: { observe: async () => null } as unknown as VisionClient,
      mirror: { logBlock: async () => {}, pushState: async () => {}, logPlan: async () => {} } as unknown as ServerMirror,
    });
    expect(bare.peerStatus()).toBeNull();
    expect(bare.peers()).toEqual([]);
  });
});
