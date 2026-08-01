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
/**
 * Considered "arrived" at or inside this distance — when a distance exists at
 * all. Do not build anything load-bearing on it: measured against the room
 * scene's exact geometry, qwen2.5vl:7b asked for metres directly is 0.94 m mean
 * absolute error (and usually answers `null`, which is why this branch rarely
 * fires), and deriving the distance from where the object meets the floor is
 * worse — a floor contact near the image horizon projects to tens of metres.
 * Bearing is the reliable signal (7.2° MAE, see vision.ts); arrival in practice
 * comes from walking into the thing.
 */
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
/** A walk that measured less than this moved nothing worth calling motion. */
const CONTACT_STALL_M = 0.05;
/**
 * A walk that achieves less than this fraction of what it was told to do has
 * hit something. Waiting for a dead stall (0.00 m) is too late: the base keeps
 * pushing, ends up inside the table, and every later turn and walk is degraded
 * by the contact — measured, a run that pushed through gave "turned -53° for a
 * commanded -90°" afterwards. 0.3 is below the sim's own worst honest walk
 * (0.65 m of a commanded 1.0 m, when nothing was in the way), so normal
 * slowness does not read as an obstacle.
 */
const CONTACT_SHORTFALL_RATIO = 0.3;
/**
 * How far the target may still be estimated to be for a stalled walk to count
 * as arrival by contact. Beyond this, something ELSE is in the way and saying
 * "arrived" would be a lie — a chair between the robot and the table blocks the
 * walk just as well as the table does.
 */
const CONTACT_MAX_DISTANCE_M = 1.5;

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
    let stagesThatMoved = 0;
    let walkedTotalM = 0;
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
      const walkedM = walk.measured?.distanceM ?? null;

      // Walking into the thing you were walking towards is arrival, not a
      // failure — a robot up against the table cannot get closer to it, and
      // "walk failed" is a poor answer to "go to the table". This fires on a
      // walk that fell far short as well as on one that failed outright,
      // because by the time the base measures a dead 0.00 m it has been pushing
      // into the target for a stage or two and is the worse for it.
      //
      // Every guard matters. An EARLIER stage must have moved, otherwise a dead
      // loco service (which also measures 0.00 m) reads as arrival. The last
      // look must have re-observed the target, so "straight ahead" is current
      // rather than remembered. And the target must be estimated near, or
      // whatever is in the way is more likely something else. Alignment itself
      // is given: the stage turned onto the bearing immediately before this walk.
      const blocked =
        walkedM !== null && (walkedM < CONTACT_STALL_M || walkedM < stageM * CONTACT_SHORTFALL_RATIO);
      const near = current.distanceEstM === null || current.distanceEstM <= CONTACT_MAX_DISTANCE_M;
      if (blocked && stagesThatMoved > 0 && unseenLooks === 0 && near) {
        return {
          ok: true,
          message:
            `Stopped at "${current.label}" after ${stages} stage${stages === 1 ? '' : 's'} and ` +
            `${(walkedTotalM + (walkedM ?? 0)).toFixed(2)} m: the last step moved only ` +
            `${(walkedM ?? 0).toFixed(2)} m of ${stageM.toFixed(2)} m, so the robot is up against ` +
            `something, and "${current.label}" is straight ahead` +
            `${current.distanceEstM === null ? '' : ` (~${current.distanceEstM.toFixed(1)} m by the last look)`}. ` +
            `Counting that as arrived — if something else is in the way, it is between the robot ` +
            `and the target.`,
        };
      }

      if (walk.status !== 'done') {
        return {
          ok: false,
          message: `goto "${entityLabel}": walk failed (${walk.error ?? 'unknown'})`,
        };
      }
      if (walkedM === null || walkedM >= CONTACT_STALL_M) stagesThatMoved++;
      walkedTotalM += walkedM ?? 0;

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
              `${stages} stages and ${walkedTotalM.toFixed(2)} m rather than walk on an ` +
              `unconfirmed heading. It may be out of view, or close enough that the camera now ` +
              `shows only part of it and the vision model named that part something else — ` +
              `check the last look before re-scanning.`,
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
        `goto "${entityLabel}": gave up after ${this.maxStages} stages and ` +
        `${walkedTotalM.toFixed(2)} m ` +
        `(${stagesWithoutProgress} of them without getting closer` +
        `${bestDistance === null ? ', distance never estimated' : `, best distance ~${bestDistance.toFixed(2)} m`}).`,
    };
  }
}
