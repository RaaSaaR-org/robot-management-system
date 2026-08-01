/**
 * @file navigator.ts
 * @description `goto(entity)` expansion: bearing-and-correct navigation that
 *              emits VISIBLE `turn` / `walk` / `look` blocks into the running
 *              plan, up to ~1 m per stage, re-bearing after every look. Stages
 *              are sized from the LiDAR range to the target when there is one
 *              and clamped by the measured clearance straight ahead; without a
 *              measurement it is the old blind stage plus arrival-by-contact.
 *              Looks once before the first stage when the robot has moved since
 *              it last looked, so no navigation starts on a distance measured
 *              from a pose the robot has left. Gives up after
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
export const MIN_STAGE_M = 0.3;
/**
 * Considered "arrived" at or inside this distance — but ONLY when the distance
 * was measured, i.e. `distanceSource === 'lidar'`.
 *
 * The history matters, because it is why the check is conditional. Measured
 * against the room scene's exact geometry, qwen2.5vl:7b asked for metres
 * directly is 0.94 m mean absolute error and usually answers `null`; deriving
 * the distance from where the object meets the floor is worse — a floor contact
 * near the image horizon projects to tens of metres. Acting on a guess with that
 * error at a 0.6 m threshold means declaring arrival in open floor, which is
 * both a lie and the end of the navigation. Bearing is the reliable VLM signal
 * (7.2° MAE, see vision.ts); the DISTANCE now comes from the LiDAR (range.ts),
 * and when it does not, arrival still comes from walking into the thing (see
 * the contact rule below).
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
/**
 * Stage length when no measurement says otherwise — walk this, then look again.
 * Unchanged from the pre-LiDAR behaviour, and still what runs whenever the
 * target is outside the sensor's vertical fan.
 */
const UNKNOWN_DISTANCE_STAGE_M = 1.0;
/**
 * How close to the nearest measured surface ahead a commanded stage may take
 * the base. Chosen, not measured, and deliberately conservative:
 *
 *  - the range module rejects every return inside 0.35 m (the MID-360's
 *    self-return blob, see range.ts), so below that radius the sensor is blind
 *    by construction — a margin smaller than 0.35 m would be a number the
 *    measurement cannot back up;
 *  - `forwardClearance` measures from the sensor origin in `base_link`, while
 *    the part of the robot that hits the table first is its feet, further
 *    forward than base_link;
 *  - a stage is open-loop: the executor issues a velocity for a duration and
 *    only measures afterwards, so the base is still moving when the command
 *    expires.
 *
 * 0.45 m = the blind radius plus a hand's width of command slop. If it turns
 * out to be too timid on the real robot, measure the stopping distance and
 * replace this comment with that measurement.
 */
export const CLEARANCE_MARGIN_M = 0.45;
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
 *
 * The same threshold decides whether a stage stopped by the measured forward
 * clearance counts as arrival, for the same reason: "I cannot advance" is only
 * "I am there" when the target is known to be right in front.
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
    let lookedAlready = false;

    if (!entity) {
      const look = await this.deps.runGeneratedBlock(
        'look',
        {},
        `Looking for "${entityLabel}" — it is not in the scene memory yet.`
      );
      if (look.status !== 'done') {
        return { ok: false, message: `goto "${entityLabel}": the look failed (${look.error ?? 'unknown'})` };
      }
      lookedAlready = true;
      entity = this.deps.scene.get(entityLabel);
    }
    if (!entity) {
      return {
        ok: false,
        message: `goto "${entityLabel}": not in the scene memory — scan the room first.`,
      };
    }

    // The loop below re-looks after every stage, so inside a navigation the
    // distances are always one walk old at most. What it cannot see is what
    // happened BEFORE it was called: a `walk` block or a previous `goto`. Those
    // motions have expired the distances they invalidated (see
    // expireOnTranslation), which leaves this navigation blind on its first
    // stage unless it measures again — and measuring is cheap next to walking
    // off a two-metre-old number.
    //
    // The 07 recording is the case: retreat 2 m, "geh zum Tisch", arrival
    // declared on the spot from the clearance measured before the retreat.
    //
    // NOT covered, and it must not be read as if it were: motion that never
    // passed through Agent Mode. Quest teleop and a direct POST to the sidecar
    // both move the robot without touching `noteTranslationM`, so
    // `hasMovedSinceObservation()` answers false, this look is skipped, and a
    // distance measured before a four-metre teleop drive can still end a
    // navigation at stage 0. Closing it means feeding measured odometry deltas
    // in here, or clearing scene memory when the control lock leaves the agent.
    if (!lookedAlready && this.deps.scene.hasMovedSinceObservation()) {
      const look = await this.deps.runGeneratedBlock(
        'look',
        {},
        `Looking again before walking to "${entityLabel}" — the robot has moved since it was last seen, ` +
          `so the remembered distances are from a pose it has left.`
      );
      if (look.status !== 'done') {
        return { ok: false, message: `goto "${entityLabel}": the look failed (${look.error ?? 'unknown'})` };
      }
      entity = this.deps.scene.get(entityLabel) ?? entity;
    }

    let stages = 0;
    let stagesWithoutProgress = 0;
    let unseenLooks = 0;
    let stagesThatMoved = 0;
    let walkedTotalM = 0;
    let bestDistance = entity.distanceEstM;
    /**
     * Has the lidar EVER put a number on this target during this navigation?
     *
     * The contact rules below treat a null distance as "near enough to count
     * hitting something as arriving". That is right for a robot with no range
     * sensor at all — contact is the only arrival signal it has. It is wrong
     * the moment the lidar is alive and merely missed one look (snapshot
     * timeout, empty cloud, sparse cone), because then null means UNKNOWN, and
     * a robot that walks into a chair four metres short of the table would
     * report `ok: true`. This flag is the only thing that can tell those two
     * situations apart, and translation-expiry routes through null constantly
     * by design, so the distinction is load-bearing rather than theoretical.
     */
    let everMeasured = entity.distanceSource === 'lidar' && entity.distanceEstM !== null;

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

      // Only a MEASURED distance may drive the loop. `distanceEstM` carries
      // whichever number the last look produced, and the vision model's guess
      // (0.94 m MAE) at a 0.6 m threshold would call arrival in open floor.
      const measuredM = current.distanceSource === 'lidar' ? current.distanceEstM : null;
      if (measuredM !== null) everMeasured = true;

      if (measuredM !== null && measuredM <= ARRIVAL_M) {
        return {
          ok: true,
          message:
            `Arrived at "${current.label}" after ${stages} stage${stages === 1 ? '' : 's'}: ` +
            `the lidar measures ${measuredM.toFixed(2)} m in that direction (nearest surface ` +
            `inside the cone around its bearing).`,
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
      //    stale distance estimate cannot drive the robot into the target. With
      //    a measured range the stage is sized to what is actually left; without
      //    one it is still the blind fixed stage, then look again.
      const remaining = measuredM === null ? UNKNOWN_DISTANCE_STAGE_M : Math.max(0, measuredM - ARRIVAL_M);
      // No MIN_STAGE_M floor here: `remaining` is already the approach that is
      // left, so flooring it commands the robot to walk further than the lidar
      // says it may — a target measured 0.61 m out got a 0.30 m stage, up to
      // 0.29 m of it into the target. Clamp 2a would normally catch that, but
      // it is gated on a live clearance, and the re-bearing turn just above
      // expires the clearance whenever it exceeds 10° — so the same physical
      // situation was decided by whether the correction happened to be 9° or
      // 15°. MIN_STAGE_M keeps its real job: the stop trigger in 2b.
      let stageM = Math.min(STAGE_LENGTH_M, remaining);

      // 2a. Never walk further than the measured way ahead allows. This is the
      //     only obstacle check the navigator has that does not require hitting
      //     the obstacle first: `forwardClearanceM` is the nearest surface in a
      //     robot-wide corridor straight ahead. `null` is UNKNOWN — the sensor's
      //     vertical fan does not cover everything in front of the robot — so it
      //     changes nothing, and the loop falls back to the contact rule below.
      const clearanceM = this.deps.scene.getForwardClearanceM();
      /** The clearance that shortened this stage, or null if none did. */
      let clampedToM: number | null = null;
      if (clearanceM !== null && Math.max(0, clearanceM - CLEARANCE_MARGIN_M) < stageM) {
        stageM = Math.max(0, clearanceM - CLEARANCE_MARGIN_M);
        clampedToM = clearanceM;
      }

      // 2b. Clamped below the shortest useful stage: the robot is already within
      //     a stopping margin of something solid and cannot usefully advance.
      //     Commanding the remaining few centimetres would just push into it.
      if (clearanceM !== null && stageM < MIN_STAGE_M) {
        // `measuredM`, not `distanceEstM`: same rule as line 218 — only a lidar
        // distance may end a navigation. `distanceEstM` still carries the VLM's
        // own guess whenever the cone came back sparse (the DOCUMENTED normal
        // degradation, since the fan misses head-height objects), and that guess
        // is 0.94 m MAE against a 1.5 m threshold. Reading it here would let a
        // model that says "1.5 m" about a table 3.5 m away turn a chair in the
        // way into "arrived". A guess is UNKNOWN for this purpose, and UNKNOWN
        // only counts as "near" on a robot whose lidar never spoke for this
        // target — see `everMeasured`.
        const near = measuredM === null ? !everMeasured : measuredM <= CONTACT_MAX_DISTANCE_M;
        // Same reasoning as the contact rule: "I cannot advance" only means "I
        // am there" when the target was just re-observed straight ahead and is
        // believed near. The extra `stagesThatMoved > 0 || measuredM !== null`
        // guard keeps a robot that never moved from claiming arrival on a wall
        // it happened to be started against — unless the lidar measured the
        // target itself to be that close.
        if (near && unseenLooks === 0 && (stagesThatMoved > 0 || measuredM !== null)) {
          return {
            ok: true,
            message:
              `Stopped at "${current.label}" after ${stages} stage${stages === 1 ? '' : 's'} and ` +
              `${walkedTotalM.toFixed(2)} m: the lidar measures the nearest surface straight ahead ` +
              `at ${clearanceM.toFixed(2)} m, inside the ${CLEARANCE_MARGIN_M.toFixed(2)} m ` +
              `stopping margin, and "${current.label}" is straight ahead` +
              `${measuredM === null ? ' (its distance was never measured)' : ` (${measuredM.toFixed(2)} m by lidar)`}. Counting that ` +
              `as arrived — the returns are unlabelled, so if something else is in the way, it is ` +
              `between the robot and the target.`,
          };
        }
        return {
          ok: false,
          message:
            `goto "${entityLabel}": stopped after ${stages} stage${stages === 1 ? '' : 's'} and ` +
            `${walkedTotalM.toFixed(2)} m — the lidar measures a surface ${clearanceM.toFixed(2)} m ` +
            `straight ahead, too close to take another step, and that is not "${current.label}"` +
            `${current.distanceEstM === null ? ' (its distance is unknown)' : ` (~${current.distanceEstM.toFixed(1)} m away)`}. ` +
            `Something is in the way — walk around it, or ask again from a different position.`,
        };
      }

      const walk = await this.deps.runGeneratedBlock(
        'walk',
        { distanceM: stageM, direction: 'forward' },
        `Walking ${stageM.toFixed(1)} m towards "${current.label}" (stage ${stages}/${this.maxStages})` +
          `${clampedToM === null ? '' : `, shortened to keep ${CLEARANCE_MARGIN_M.toFixed(2)} m clear of the surface the lidar measures ${clampedToM.toFixed(2)} m ahead`}.`
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
      // Lidar-only, for the reason spelled out at the same test in 2b above.
      const near = measuredM === null ? !everMeasured : measuredM <= CONTACT_MAX_DISTANCE_M;
      if (blocked && stagesThatMoved > 0 && unseenLooks === 0 && near) {
        return {
          ok: true,
          message:
            `Stopped at "${current.label}" after ${stages} stage${stages === 1 ? '' : 's'} and ` +
            `${(walkedTotalM + (walkedM ?? 0)).toFixed(2)} m: the last step moved only ` +
            `${(walkedM ?? 0).toFixed(2)} m of ${stageM.toFixed(2)} m, so the robot is up against ` +
            `something, and "${current.label}" is straight ahead` +
            `${current.distanceEstM === null ? ' (its distance was never measured)' : ` (~${current.distanceEstM.toFixed(1)} m by the last look)`}. ` +
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
