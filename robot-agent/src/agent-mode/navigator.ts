/**
 * @file navigator.ts
 * @description `goto(entity)` expansion: bearing-and-correct navigation that
 *              emits VISIBLE `turn` / `walk` / `look` blocks into the running
 *              plan, ~1 m per stage, re-bearing after every look. Gives up after
 *              AGENT_MAX_NAV_STAGES stages in total (progress resets the
 *              no-progress tally that the give-up message reports, but does not
 *              refund the stage budget), or sooner when MAX_UNSEEN_LOOKS looks
 *              in a row fail to re-observe the target.
 * @feature agentmode
 * @status live
 */

import { config } from '../config/config.js';
import type { SceneMemoryStore } from './scene-memory.js';
import { normalizeDeg, type AgentBlock, type AgentBlockKind, type BlockOutcome } from './types.js';

/** Below this bearing error a correction turn is not worth a stage. */
const BEARING_DEADBAND_DEG = 8;
/** Longest single walk stage, in metres. */
const STAGE_LENGTH_M = 1.0;
/** Shortest useful stage — below this the FSM barely moves. */
const MIN_STAGE_M = 0.3;
/** Considered "arrived" at or inside this distance. */
const ARRIVAL_M = 0.6;
/** Distance must shrink by at least this much for a stage to count as progress. */
const PROGRESS_EPSILON_M = 0.05;
/**
 * How many consecutive looks may fail to re-observe the target before the
 * navigation gives up. A stored bearing that no look has confirmed is a guess
 * about where the world *was*, and walking on it is how the robot ends up
 * somewhere nobody aimed it at.
 */
const MAX_UNSEEN_LOOKS = 2;
/** Assumed distance when the VLM gave none — one stage, then look again. */
const UNKNOWN_DISTANCE_STAGE_M = 1.0;

export interface NavigatorDeps {
  scene: SceneMemoryStore;
  /**
   * Append a generated block to the plan and run it to completion. Returns the
   * finished block so the navigator can react to a failure. The controller owns
   * plan bookkeeping and event emission.
   */
  runGeneratedBlock: (
    kind: AgentBlockKind,
    params: Record<string, unknown>,
    reasoning: string
  ) => Promise<AgentBlock>;
  isAborted: () => boolean;
  maxStages?: number;
}

export class Navigator {
  private readonly deps: NavigatorDeps;
  private readonly maxStages: number;

  constructor(deps: NavigatorDeps) {
    this.deps = deps;
    this.maxStages = deps.maxStages ?? config.agentMode.maxNavStages;
  }

  /**
   * Walk to `entityLabel`.
   *
   * The loop is: re-bear (turn) → walk one stage → look → re-read the entity.
   * If the entity is not in scene memory at all, one `look` is spent trying to
   * find it; if it is still unknown the navigation fails honestly rather than
   * inventing a heading.
   */
  async navigate(entityLabel: string): Promise<BlockOutcome> {
    let entity = this.deps.scene.get(entityLabel);

    if (!entity) {
      const look = await this.deps.runGeneratedBlock(
        'look',
        {},
        `Looking for "${entityLabel}" — it is not in the scene memory yet.`
      );
      if (look.status !== 'done') {
        return { ok: false, message: `goto "${entityLabel}": the look failed (${look.error ?? 'unknown'})` };
      }
      entity = this.deps.scene.get(entityLabel);
    }
    if (!entity) {
      return {
        ok: false,
        message: `goto "${entityLabel}": not in the scene memory — scan the room first.`,
      };
    }

    let stages = 0;
    let stagesWithoutProgress = 0;
    let unseenLooks = 0;
    let bestDistance = entity.distanceEstM;

    while (stages < this.maxStages) {
      if (this.deps.isAborted()) {
        return { ok: false, message: `goto "${entityLabel}" aborted after ${stages} stages` };
      }

      const current = this.deps.scene.get(entityLabel);
      if (!current) {
        return {
          ok: false,
          message: `goto "${entityLabel}": lost track of it after ${stages} stages`,
        };
      }

      if (current.distanceEstM !== null && current.distanceEstM <= ARRIVAL_M) {
        return {
          ok: true,
          message: `Arrived at "${current.label}" after ${stages} stage${stages === 1 ? '' : 's'} (~${current.distanceEstM.toFixed(2)} m).`,
        };
      }

      stages++;

      // 1. Re-bear: the stored bearing is world-frame, so the correction is the
      //    difference to the robot's current heading.
      const relativeDeg = normalizeDeg(current.bearingDeg - this.deps.scene.getYawDeg());
      if (Math.abs(relativeDeg) > BEARING_DEADBAND_DEG) {
        const turn = await this.deps.runGeneratedBlock(
          'turn',
          { angleDeg: relativeDeg },
          `Turning ${Math.round(relativeDeg)}° towards "${current.label}" (stage ${stages}).`
        );
        if (turn.status !== 'done') {
          return {
            ok: false,
            message: `goto "${entityLabel}": turn failed (${turn.error ?? 'unknown'})`,
          };
        }
      }

      if (this.deps.isAborted()) {
        return { ok: false, message: `goto "${entityLabel}" aborted after ${stages} stages` };
      }

      // 2. Walk one stage — never the whole remaining distance in one go, so a
      //    stale distance estimate cannot drive the robot into the target.
      const remaining =
        current.distanceEstM === null
          ? UNKNOWN_DISTANCE_STAGE_M
          : Math.max(0, current.distanceEstM - ARRIVAL_M);
      const stageM = Math.max(MIN_STAGE_M, Math.min(STAGE_LENGTH_M, remaining));
      const walk = await this.deps.runGeneratedBlock(
        'walk',
        { distanceM: stageM, direction: 'forward' },
        `Walking ${stageM.toFixed(1)} m towards "${current.label}" (stage ${stages}/${this.maxStages}).`
      );
      if (walk.status !== 'done') {
        return {
          ok: false,
          message: `goto "${entityLabel}": walk failed (${walk.error ?? 'unknown'})`,
        };
      }

      // 3. Look again — this is what refreshes the bearing and the distance.
      const seenBefore = current.observedSeq;
      const look = await this.deps.runGeneratedBlock(
        'look',
        {},
        `Re-checking where "${current.label}" is (stage ${stages}).`
      );
      if (look.status !== 'done') {
        return {
          ok: false,
          message: `goto "${entityLabel}": look failed (${look.error ?? 'unknown'})`,
        };
      }

      // 3a. Did that look actually find it again? A look that succeeds without
      //     re-observing the target leaves the stored bearing untouched, and
      //     `scene.get` keeps handing it back as if it were fresh. Steering on
      //     it walks the robot away from a target it can no longer see, so the
      //     re-observation count is what has to gate the next stage.
      if (this.deps.scene.get(entityLabel)?.observedSeq === seenBefore) {
        unseenLooks++;
        if (unseenLooks >= MAX_UNSEEN_LOOKS) {
          return {
            ok: false,
            message:
              `goto "${entityLabel}": ${unseenLooks} looks in a row did not report it, so the ` +
              `stored bearing (${Math.round(current.bearingDeg)}°) is stale and I stopped after ` +
              `${stages} stages rather than walk on an unconfirmed heading. It may be out of ` +
              `view, or close enough that the camera now shows only part of it and the vision ` +
              `model named that part something else — check the last look before re-scanning.`,
          };
        }
      } else {
        unseenLooks = 0;
      }

      // 4. Progress bookkeeping — an unknown distance can never count as progress.
      const after = this.deps.scene.get(entityLabel);
      const nowDistance = after?.distanceEstM ?? null;
      if (
        nowDistance !== null &&
        (bestDistance === null || nowDistance < bestDistance - PROGRESS_EPSILON_M)
      ) {
        bestDistance = nowDistance;
        stagesWithoutProgress = 0;
      } else {
        stagesWithoutProgress++;
      }
    }

    return {
      ok: false,
      message:
        `goto "${entityLabel}": gave up after ${this.maxStages} stages ` +
        `(${stagesWithoutProgress} of them without getting closer` +
        `${bestDistance === null ? ', distance never estimated' : `, best distance ~${bestDistance.toFixed(2)} m`}).`,
    };
  }
}
