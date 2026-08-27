/**
 * @file planner-scene-targets.test.ts
 * @description The controller's side of TASK-221 item 3: the planner is handed
 *              the scene rows as numbers next to the prose, and a `turn` + `walk`
 *              pair that copies one of those rows is folded into a measured
 *              `goto` instead of running open-loop.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { AgentModeController } from '../agent-mode-controller.js';
import { ControlOwnerLock } from '../control-owner.js';
import { Planner } from '../planner.js';
import { RangeSensor } from '../range.js';
import { SceneMemoryStore } from '../scene-memory.js';
import type { PlannerInput, PlannerSceneTarget } from '../planner.js';
import type { GenerateFn, GenerateRequest, GenerateResponse } from '../llm.js';
import type { ServerMirror } from '../server-mirror.js';
import type { VisionClient, VisionObservation } from '../vision.js';
import type { RobotStateManager } from '../../robot/state.js';

/** The bench's `goto-door` scene: a door 4.4 m away, 96° off the robot's nose. */
const VIEW: VisionObservation = {
  currentView: 'a door off to the left',
  entities: [{ label: 'door', bearingDeg: 96, distanceEstM: 4.4, confidence: 0.9 }],
  personVisible: false,
  raw: '{}',
  degraded: false,
};

const CLEARANCE_M = 2.95;

function rig(plan: Planner | { plan: (input: PlannerInput) => Promise<unknown> }) {
  const moves: Array<{ vx: number; durationS: number }> = [];
  const scene = new SceneMemoryStore('robot-1');
  const controller = new AgentModeController({
    robotId: 'robot-1',
    enabled: true,
    lock: new ControlOwnerLock(),
    scene,
    mapKeeper: null,
    peerTracker: null,
    planner: plan as unknown as Planner,
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
    say: async () => false,
    sleep: async () => {},
    now: () => 1e12,
  });
  controller.attach({
    isEStopTriggered: () => false,
    isTeleopActive: () => false,
    isVLAActive: () => false,
    getState: () => ({ batteryLevel: 90 }),
    getPlaceBelief: () => null,
    getPlaces: () => [],
    getPlaceFrameRegistration: () => ({ registered: false, reason: 'no frame' }),
  } as unknown as RobotStateManager);

  // The door as a look would have left it: a measured range, and a measured
  // corridor straight ahead that the turn is about to retire.
  scene.merge(
    {
      ...VIEW,
      entities: [
        { label: 'door', bearingDeg: 96, distanceEstM: 4.4, distanceSource: 'lidar', confidence: 0.9 },
      ],
    },
    undefined,
    { forwardClearanceM: CLEARANCE_M },
  );

  return { controller, moves, scene };
}

/** A planner double that answers with the open-loop pair the bench sees. */
function turnThenWalk(): { generate: GenerateFn; requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  const generate: GenerateFn = async (req): Promise<GenerateResponse> => {
    requests.push(req);
    return {
      text: JSON.stringify({
        blocks: [
          { kind: 'turn', angleDeg: 96, reasoning: 'Face the door.' },
          { kind: 'walk', distanceM: 4.4, direction: 'forward' },
        ],
      }),
      output: null,
    };
  };
  return { generate, requests };
}

describe('planner scene targets — the controller hands the rows over as numbers', () => {
  it("supplies one target per scene row, bearing in the robot's own frame", async () => {
    const inputs: PlannerInput[] = [];
    const h = rig({
      plan: async (input: PlannerInput) => {
        inputs.push(input);
        return { blocks: [{ kind: 'speak', params: { text: 'ok' } }], fallback: false, attempts: 1 };
      },
    });
    // The robot is not facing +x, so the stored (world) bearing and the relative
    // one differ — which is the whole reason the controller converts rather than
    // passing the row through.
    h.scene.setYawDeg(40, 'odometry');

    await h.controller.submitCommand({ text: 'geh zur Tuer' });
    await h.controller.whenIdle();

    expect(inputs).toHaveLength(1);
    const targets = inputs[0]!.sceneTargets as PlannerSceneTarget[];
    // 56°, not the 96° the summary prints: a `turn` is executed in the robot's
    // current frame, and that is the only frame the fold may match in (TASK-221).
    expect(targets).toEqual([{ label: 'door', relativeBearingDeg: 56, distanceM: 4.4 }]);
    // The prose the model actually reads is unchanged.
    expect(inputs[0]!.sceneSummary).toMatch(/door: bearing 96°/);
  });

  it('never offers a fleet-reported peer as a fold target', async () => {
    // `listEntities()` merges what this robot LOOKED at with the peers the
    // server reported. Only the first group is something a camera saw, and only
    // the first group is expired by `expireOnTranslation` — it walks `entities`
    // and never `fleetEntities`, so a peer's distance survives any amount of
    // driving by either robot.
    //
    // Offered to the fold, that turns "turn 96°, walk 4.4 m" into
    // `goto "robot alice"`: an approach presented as measured, to a colleague
    // who has since walked off, from a distance nothing can retire.
    const inputs: PlannerInput[] = [];
    const h = rig({
      plan: async (input: PlannerInput) => {
        inputs.push(input);
        return { blocks: [{ kind: 'speak', params: { text: 'ok' } }], fallback: false, attempts: 1 };
      },
    });
    h.scene.setFleetEntities([
      { label: 'robot alice', bearingDeg: 96, distanceEstM: 4.4, distanceSource: 'fleet', confidence: 1 },
    ] as never);

    await h.controller.submitCommand({ text: 'geh zur Tuer' });
    await h.controller.whenIdle();

    expect(inputs).toHaveLength(1);
    const targets = (inputs[0]!.sceneTargets ?? []) as PlannerSceneTarget[];
    expect(targets.map((t) => t.label)).toEqual(['door']);
  });

  it('omits them entirely when nothing has been seen', async () => {
    const inputs: PlannerInput[] = [];
    const controller = new AgentModeController({
      robotId: 'robot-1',
      enabled: true,
      lock: new ControlOwnerLock(),
      scene: new SceneMemoryStore('robot-1'),
      mapKeeper: null,
      peerTracker: null,
      planner: {
        plan: async (input: PlannerInput) => {
          inputs.push(input);
          return { blocks: [{ kind: 'speak', params: { text: 'ok' } }], fallback: false, attempts: 1 };
        },
      } as unknown as Planner,
      mirror: { emit: () => {}, push: async () => {}, logBlock: async () => {} } as unknown as ServerMirror,
      vision: { observe: async () => VIEW } as unknown as VisionClient,
      range: new RangeSensor({ enabled: false }),
      loco: {
        move: async () => ({ ok: true }),
        action: async () => ({ ok: true }),
        fsm: async () => ({ ok: true }),
        standHeight: async () => ({ ok: true }),
        odometry: async () => null,
      },
      say: async () => false,
      sleep: async () => {},
      now: () => 1e12,
    });
    controller.attach({
      isEStopTriggered: () => false,
      isTeleopActive: () => false,
      isVLAActive: () => false,
      getState: () => ({ batteryLevel: 90 }),
      getPlaceBelief: () => null,
      getPlaces: () => [],
      getPlaceFrameRegistration: () => ({ registered: false, reason: 'no frame' }),
    } as unknown as RobotStateManager);

    await controller.submitCommand({ text: 'sag hallo' });
    await controller.whenIdle();

    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.sceneTargets).toBeUndefined();
  });
});

describe('planner scene targets — the open-loop approach is folded away', () => {
  it('runs turn 96° + walk 4.4 m as one measured goto instead', async () => {
    // End to end through the REAL planner: the controller supplies the door's
    // row, the model answers with the pair that copies it, and the fold turns
    // the pair into the `goto` that measures its own approach. Without it the
    // walk runs down a heading whose clearance the turn has just retired.
    const { generate } = turnThenWalk();
    const real = new Planner({ generate, modelRef: 'test-ollama/gemma4:e2b' });
    // What the planner HANDED BACK, kept apart from `plan.blocks`: the navigator
    // appends its own stages to that list as it drives, and the claim here is
    // about the plan, not about how the goto was walked.
    const planned: string[][] = [];
    const h = rig({
      plan: async (input: PlannerInput) => {
        const result = await real.plan(input);
        planned.push(result.blocks.map((b) => b.kind));
        return result;
      },
    });

    await h.controller.submitCommand({ text: 'geh zur Tuer' });
    await h.controller.whenIdle();

    expect(planned).toEqual([['goto']]);
    expect(h.controller.getState().plan!.blocks[0]!.params).toEqual({ entity: 'door' });

    // Every walk that ran is a navigator STAGE — they all name the stage they
    // are — so not one leg of this navigation was written by the model.
    const walks = h.controller.getState().plan!.blocks.filter((b) => b.kind === 'walk');
    expect(walks.length).toBeGreaterThan(0);
    for (const w of walks) expect(w.reasoning ?? '').toMatch(/\(stage \d+\/\d+\)/);

    // And nothing drove the whole 4.4 m in one command: each stage is clamped by
    // the clearance the look measured.
    const forward = h.moves.filter((m) => m.vx > 0);
    expect(forward.length).toBeGreaterThan(0);
    for (const m of forward) {
      expect(m.durationS).toBeLessThanOrEqual((CLEARANCE_M - 0.45) / 0.4 + 1e-6);
    }
  });
});
