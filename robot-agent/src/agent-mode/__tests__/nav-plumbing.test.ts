/**
 * @file nav-plumbing.test.ts
 * @description The controller's side of TASK-208: every forward walk is checked
 *              against the place graph's keepouts before it runs — only on a
 *              registered frame, never on an unregistered one — and the `goto`
 *              block carries whether it was planned, with `nav` mirrored into
 *              the state.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import type { Planner, PlannedBlock } from '../planner.js';
import type { Place } from '../place-resolver.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { RobotStateManager } from '../../robot/state.js';

const TABLE: Place = {
  id: 'TABLE',
  name: 'TABLE',
  placeType: 'cell',
  floor: 0,
  polygon: [
    [2, -1],
    [3, -1],
    [3, 1],
    [2, 1],
  ],
  source: 'surveyed',
  keepout: true,
  landmarks: [],
};

const VIEW: VisionObservation = {
  currentView: 'a table straight ahead',
  entities: [{ label: 'table', bearingDeg: 0, distanceEstM: 2.5, confidence: 0.9 }],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

function rig(blocks: PlannedBlock[], registered: boolean) {
  const moves: Array<{ vx: number; durationS: number }> = [];
  const scene = new SceneMemoryStore('robot-1');
  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock: new ControlOwnerLock(),
    scene,
    mapKeeper: null,
    peerTracker: null,
    navPlanner: 'grid',
    getPose: () => ({ x: 0, y: 0, yawDeg: 0, source: 'sim', atMs: 1e12 }),
    planner: { plan: async () => ({ blocks, fallback: false, attempts: 1 }) } as unknown as Planner,
    mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {} } as unknown as ServerMirror,
    vision: { observe: async () => VIEW } as unknown as VisionClient,
    range: new RangeSensor({ enabled: false }),
    loco: {
      move: async (vx, _vy, _omega, durationS) => {
        moves.push({ vx, durationS });
        return { ok: true };
      },
      action: async () => ({ ok: true }),
      fsm: async () => ({ ok: true }),
      standHeight: async () => ({ ok: true }),
      odometry: async () => null,
    },
    sleep: async () => {},
    now: () => 1e12,
  });
  controller.attach({
    isEStopTriggered: () => false,
    isTeleopActive: () => false,
    isVLAActive: () => false,
    getState: () => ({ batteryLevel: 90 }),
    getPlaceBelief: () => null,
    getPlaces: () => [TABLE],
    getPlaceFrameRegistration: () => (registered ? { registered: true, how: 'identity' } : { registered: false, reason: 'twin frame' }),
  } as unknown as RobotStateManager);
  return { controller, moves, scene };
}

describe('nav plumbing — the keepout check on a plain walk', () => {
  it('shortens a walk that would cross a keepout, on a registered frame', async () => {
    const h = rig([{ kind: 'walk', params: { distanceM: 3, direction: 'forward' } }], true);
    await h.controller.submitCommand({ text: 'walk 3 m' });
    await h.controller.whenIdle();
    const block = h.controller.getState().plan!.blocks[0]!;
    expect(block.status).toBe('done');
    // Polygon face at x = 2, margin 0.5 → fence at 1.5 m; allowed ≈ 1.3 m.
    expect(block.result).toMatch(/Stopped 1\.[67]\d m short of the requested 3\.00 m — TABLE keepout ahead/);
    expect(h.moves[0]!.durationS).toBeLessThan(1.4 / 0.4 + 0.01);
    expect(h.moves[0]!.durationS).toBeGreaterThan(1.2 / 0.4);
  });

  it('says nothing new on an unregistered frame — polygons and pose are about different origins', async () => {
    const h = rig([{ kind: 'walk', params: { distanceM: 3, direction: 'forward' } }], false);
    await h.controller.submitCommand({ text: 'walk 3 m' });
    await h.controller.whenIdle();
    const block = h.controller.getState().plan!.blocks[0]!;
    expect(block.status).toBe('done');
    expect(block.result).not.toMatch(/keepout/);
    expect(h.moves[0]!.durationS).toBeCloseTo(3 / 0.4, 2);
  });
});

describe('nav plumbing — the goto block says how it is driven', () => {
  it('marks a goto walked by sight (no map) and mirrors nav into the state while it runs', async () => {
    const h = rig([{ kind: 'goto', params: { entity: 'table' } }], true);
    // Seed the scene so the navigator has a target with a measured distance.
    h.scene.merge(
      { ...VIEW, entities: [{ label: 'table', bearingDeg: 0, distanceEstM: 2.5, distanceSource: 'lidar', confidence: 0.9 }] },
      undefined,
      { forwardClearanceM: null },
    );
    expect(h.controller.getState().nav).toBeNull();
    await h.controller.submitCommand({ text: 'go to the table' });
    await h.controller.whenIdle();
    const goto = h.controller.getState().plan!.blocks[0]!;
    expect(goto.kind).toBe('goto');
    expect(goto.nav).toBeDefined();
    expect(goto.nav!.planned).toBe(false);
    expect(goto.nav!.reason).toMatch(/no map/);
    // The route is over: nothing left to draw.
    expect(h.controller.getState().nav).toBeNull();
  });
});
