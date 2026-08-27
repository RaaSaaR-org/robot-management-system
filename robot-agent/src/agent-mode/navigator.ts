/**
 * @file navigator.ts
 * @description `goto(entity)` expansion: emits VISIBLE `turn` / `walk` / `look`
 *              blocks into the running plan. With a map planner (TASK-208) the
 *              route is planned on the occupancy map — keepouts and peers
 *              included — and walked segment by segment (≤ AGENT_NAV_MAX_SEGMENT_M
 *              each, a look every AGENT_NAV_LOOK_EVERY_M), re-planned from the
 *              fresh pose after every stage; a goal inside a keepout is refused
 *              before the first step. Without a planner, or when no path is
 *              known, it is bearing-and-correct navigation up to ~1 m per stage,
 *              re-bearing after every look. Stages
 *              are sized from the LiDAR range to the target when there is one
 *              and clamped by the measured clearance straight ahead; without a
 *              measurement it is the old blind stage plus arrival-by-contact.
 *              Looks once before the first stage when the robot has moved since
 *              it last looked — commanded metres OR measured odometry (TASK-221)
 *              — so no navigation starts on a distance measured from a pose the
 *              robot has left. A drive under someone else's control lock is
 *              covered separately, by the controller wiping the scene when the
 *              lock goes to teleop or VLA; what is still uncovered is an
 *              uncommanded drive that takes no lock and reaches a `goto` before
 *              any odometry fix does — see the pre-flight look for the bound on
 *              that window. Gives up after
 *              AGENT_MAX_NAV_STAGES stages in total (progress resets the
 *              no-progress tally that the give-up message reports, but does not
 *              refund the stage budget), or sooner when MAX_UNSEEN_LOOKS looks
 *              in a row fail to re-observe the target.
 * @feature agentmode
 * @status live
 */

import { config } from '../config/config.js';
import type { PlannedPath, PlanResult } from './path-planner.js';
import { distanceToBoundaryM, pointInPolygon, type Place } from './place-resolver.js';
import type { SceneMemoryStore } from './scene-memory.js';
import {
  DEG_TO_RAD,
  normalizeDeg,
  type AgentBlock,
  type AgentBlockKind,
  type AgentNavPlan,
  type BlockOutcome,
  type SceneEntity,
} from './types.js';

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
export const ARRIVAL_M = 0.6;
/**
 * Slack on the arrival comparison. A stage sized to land exactly at ARRIVAL_M
 * lands at 0.6000000001 m as often as not, and the answer to that must not be
 * one more stage of a few micrometres. Two centimetres is below what the lidar
 * resolves at that range and below what one walk stage achieves on purpose.
 */
const ARRIVAL_SLACK_M = 0.02;
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
export const UNKNOWN_DISTANCE_STAGE_M = 1.0;
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

/**
 * The map side of navigation (TASK-208): a planner over the occupancy map and
 * the pose the map is expressed in. Both are the controller's to supply; a
 * navigator without them is the pre-map loop, unchanged.
 */
export interface NavPlannerDeps {
  /**
   * Plan from `from` (the pose just sampled) to `goal`, both odometry frame.
   * The navigator does not read the map itself: what counts as a wall, a
   * keepout or a peer is the caller's world model.
   */
  plan: (from: { x: number; y: number }, goal: { x: number; y: number }) => PlanResult;
  /**
   * The robot's odometry pose NOW — sampled, not the poll's cache, because a
   * stage is re-planned from where the last walk actually ended and the cache
   * can be a whole walk old. Null when there is none; then nothing is planned.
   */
  samplePose: () => Promise<{ x: number; y: number; yawDeg: number } | null>;
  /** Longest single planned walk stage (default `AGENT_NAV_MAX_SEGMENT_M`). */
  maxSegmentM?: number;
  /** Look at least every this many metres along a planned route (default `AGENT_NAV_LOOK_EVERY_M`). */
  lookEveryM?: number;
}

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
  /** Absent or null: no map planning, today's staged loop. */
  planner?: NavPlannerDeps | null;
  /**
   * Told about every plan (and re-plan) the navigation makes, and `null` when
   * the navigation ends — the controller mirrors it to the UI and `/map`.
   */
  onNav?: (nav: AgentNavPlan | null) => void;
}

/** What one stage decided to do, before the shared clamps run. */
interface StageIntent {
  /** Turn to make first, degrees relative, or null when inside the deadband. */
  turnDeg: number | null;
  turnWhy: string;
  stageM: number;
  walkWhy: string;
  planned: boolean;
  /** Planned only: whether a look is due after this walk. */
  lookAfter: boolean;
}

/**
 * A place counts as entered once the pose is this far INSIDE its polygon — the
 * resolver's default hysteresis, so the navigator's "arrived in" and the place
 * chip's "you are in" commit on the same line (TASK-209).
 */
export const PLACE_ENTRY_MARGIN_M = 0.3;
/**
 * How close to a place's centre the robot walks before "arrived in <place>":
 * near enough that a look from there shows the room, not so near that a plant
 * or a rug on the exact centre turns arrival into a stall.
 */
export const PLACE_ARRIVAL_M = 1.0;
/** Stages in a row that get no closer to the centre before a place navigation stops. */
const PLACE_MAX_STALLED_STAGES = 2;
/**
 * The executor's own refusals — the map or the lidar says the next step would
 * touch something. During a place navigation these are re-plan points, not
 * failures: see {@link Navigator.navigateToPlace}.
 */
const REFUSED_WALK = /refusing to walk|stopping margin|too close/i;
/**
 * Refusals in a row before a `goto <entity>` gives up. Two: the first is worth
 * a re-plan (the map has just grown by the refusal, and the next stage re-bears
 * from a fresh pose, which is what corrects an undershot turn), a third in a
 * row means the way really is blocked rather than mis-aimed.
 */
const MAX_REFUSED_STAGES = 2;

/**
 * Where "into the place" leads: the area centroid when that lies inside the
 * polygon (a rectangle's centre), otherwise the sampled point deepest inside
 * it — a concave room's centroid can fall outside the room, and "walk to a
 * point in the corridor between the two arms of the L" is not the order. The
 * entry test decides arrival, so a goal a little off only shortens the walk.
 */
export function placeGoal(place: Place): { x: number; y: number } {
  const poly = place.polygon;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    const f = xj * yi - xi * yj;
    area += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  if (Math.abs(area) > 1e-9) {
    const centroid = { x: cx / (3 * area), y: cy / (3 * area) };
    if (pointInPolygon(centroid.x, centroid.y, poly)) return centroid;
  }
  // Deepest sampled interior point (a coarse pole of inaccessibility).
  const xs = poly.map(([x]) => x);
  const ys = poly.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const N = 32;
  let best: { x: number; y: number } | null = null;
  let bestDepth = -1;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = minX + ((maxX - minX) * i) / N;
      const y = minY + ((maxY - minY) * j) / N;
      if (!pointInPolygon(x, y, poly)) continue;
      const depth = distanceToBoundaryM(x, y, poly);
      if (depth > bestDepth) {
        bestDepth = depth;
        best = { x, y };
      }
    }
  }
  return best ?? { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
}

export class Navigator {
  private readonly deps: NavigatorDeps;
  private readonly maxStages: number;
  private readonly planner: NavPlannerDeps | null;
  private readonly maxSegmentM: number;
  private readonly lookEveryM: number;

  constructor(deps: NavigatorDeps) {
    this.deps = deps;
    this.maxStages = deps.maxStages ?? config.agentMode.maxNavStages;
    this.planner = deps.planner ?? null;
    this.maxSegmentM = deps.planner?.maxSegmentM ?? config.agentMode.navMaxSegmentM;
    this.lookEveryM = deps.planner?.lookEveryM ?? config.agentMode.navLookEveryM;
  }

  /**
   * Where the target is in the odometry frame, from a MEASURED distance
   * (lidar or the fleet's own report of a peer) and the stored bearing. A
   * `vlm-estimate` is 0.94 m MAE and does not make a pose; null then.
   */
  private projectGoal(
    // A STORED entity, not an observed one: a stored row always carries a world
    // bearing, where an observation may carry none at all (TASK-221). Only
    // `scene.get` ever feeds this, so the narrower type costs nothing and stops
    // an unplaced sighting from being projected into a goal pose.
    entity: SceneEntity,
    pose: { x: number; y: number; yawDeg: number },
  ): { x: number; y: number } | null {
    const measured =
      (entity.distanceSource === 'lidar' || entity.distanceSource === 'fleet') && entity.distanceEstM !== null
        ? entity.distanceEstM
        : null;
    if (measured === null) return null;
    // The stored bearing is in the scene's yaw frame; the pose's yaw is the
    // odometry's. Going through the robot-relative bearing keeps them apart.
    const rel = normalizeDeg(entity.bearingDeg - this.deps.scene.getYawDeg());
    const heading = (pose.yawDeg + rel) * DEG_TO_RAD;
    return { x: pose.x + measured * Math.cos(heading), y: pose.y + measured * Math.sin(heading) };
  }

  private describeNav(
    target: string,
    goal: { x: number; y: number } | null,
    path: PlannedPath | null,
    reason: string | null,
  ): AgentNavPlan {
    return {
      target,
      planned: path !== null,
      path: path ? path.waypoints.map(([x, y]) => [x, y] as [number, number]) : null,
      goal: goal ? { ...goal } : null,
      lengthM: path ? path.lengthM : null,
      segments: path ? path.segments.length : 0,
      reason,
      updatedAt: new Date().toISOString(),
    };
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
    try {
      return await this.navigateInner(entityLabel);
    } finally {
      // Whatever happened, the route is over — the map must not keep drawing it.
      this.deps.onNav?.(null);
    }
  }

  /**
   * Walk INTO `place` — a room or area of the place graph — by planning on the
   * map towards its centre and walking the plan in stages (TASK-209).
   *
   * Different from {@link navigate} in what "there" means. An entity is a thing
   * the camera saw: its position is a bearing plus a lidar range, and arrival is
   * standing 0.6 m from its surface. A place is a polygon the robot was GIVEN,
   * so no look is needed to know where it is, and arrival is the robot's own
   * pose being inside the polygon — near its centre when the map allows, or as
   * far in as the map lets it get when furniture stands on the centre. The
   * looks along the way are not for finding the place; they fill the scene
   * memory with what the place holds, which is what "discover the room" means.
   *
   * When the map has no path yet — the room has never been seen, or the goal is
   * still off the grid — one bounded stage is walked BY SIGHT towards the
   * centre, under the executor's own clearance and map clamps, and the plan is
   * tried again from where that ended. The map grows with every stage, so a
   * wall the robot walks up to is a wall the next plan goes around: that is how
   * a doorway is found without anyone naming it.
   *
   * Whether it ended well is decided by where the robot stands, not by which
   * counter ran out: a navigation that spends its whole stage budget and ends
   * INSIDE the polygon arrived — short of the centre, and it says so.
   */
  async navigateToPlace(place: Place): Promise<BlockOutcome> {
    try {
      return await this.navigateToPlaceInner(place);
    } finally {
      this.deps.onNav?.(null);
    }
  }

  private async navigateToPlaceInner(place: Place): Promise<BlockOutcome> {
    const label = place.name || place.id;
    if (place.keepout) {
      return { ok: false, message: `"${label}" is a keepout — I won't walk into it.` };
    }
    if (!this.planner) {
      return {
        ok: false,
        message: `goto place "${label}": needs the map planner (AGENT_NAV_PLANNER=grid) and an odometry pose.`,
      };
    }
    const goal = placeGoal(place);
    const inside = (p: { x: number; y: number }): boolean =>
      pointInPolygon(p.x, p.y, place.polygon) &&
      distanceToBoundaryM(p.x, p.y, place.polygon) >= PLACE_ENTRY_MARGIN_M;
    const arrived = (stages: number, walkedM: number, distM: number, tail: string): BlockOutcome => ({
      ok: true,
      message:
        `Arrived in ${label} after ${stages} stage${stages === 1 ? '' : 's'} and ${walkedM.toFixed(2)} m — ` +
        `${tail.replace('%d', distM.toFixed(2))}`,
    });

    let stages = 0;
    let walkedTotalM = 0;
    let metresSinceLook = 0;
    /**
     * Progress is measured on what the robot is actually following: the
     * remaining PLANNED length while there is a path, the straight-line
     * distance while walking by sight. Straight-line distance alone is wrong
     * on a route — leaving the kitchen for the living room first walks AWAY
     * from the living room's centre, out through the kitchen door — and the
     * measured 8.7 → 7.8 → 7.3 m plan that was ended as "no closer" is what
     * this comment stands for. Switching between the two resets the baseline.
     */
    let best: number | null = null;
    let bestKind: 'planned' | 'sight' | null = null;
    let stagesWithoutProgress = 0;
    let plannedStages = 0;
    let bySightStages = 0;
    let lookedForMap = false;

    while (stages < this.maxStages) {
      if (this.deps.isAborted()) {
        return { ok: false, message: `goto place "${label}" aborted after ${stages} stages` };
      }
      const pose = await this.planner.samplePose();
      if (!pose) {
        return { ok: false, message: `goto place "${label}": no odometry pose — cannot tell where the robot is.` };
      }
      const distM = Math.hypot(goal.x - pose.x, goal.y - pose.y);
      const isInside = inside(pose);
      if (isInside && distM <= PLACE_ARRIVAL_M) {
        return arrived(stages, walkedTotalM, distM, 'the pose is %d m from its centre.');
      }

      let verdict = this.planner.plan({ x: pose.x, y: pose.y }, goal);
      if (!verdict.ok && verdict.reason === 'no-map' && !lookedForMap) {
        // Nothing integrated yet — typically right after a restart, when the
        // map on disk is only restored by the first lidar frame. One look
        // costs seconds; a blind stage the wrong way costs a whole leg.
        lookedForMap = true;
        const look = await this.deps.runGeneratedBlock(
          'look',
          {},
          `Looking around before setting off for ${label} — the map has nothing yet.`,
        );
        if (look.status !== 'done') {
          return { ok: false, message: `goto place "${label}": the look failed (${look.error ?? 'unknown'})` };
        }
        verdict = this.planner.plan({ x: pose.x, y: pose.y }, goal);
      }
      let path: PlannedPath | null = null;
      let planReason: string | null = null;
      if (verdict.ok) {
        path = verdict.path;
      } else if (verdict.reason === 'goal-in-keepout') {
        const fence = verdict.keepout?.name ?? 'a keepout';
        this.deps.onNav?.(this.describeNav(label, goal, null, `inside keepout ${fence}`));
        return { ok: false, message: `The centre of ${label} is inside keepout ${fence} — I won't walk there.` };
      } else {
        planReason = verdict.message;
      }
      this.deps.onNav?.(this.describeNav(label, goal, path, planReason));

      const metric = path ? path.lengthM : distM;
      const kind: 'planned' | 'sight' = path ? 'planned' : 'sight';
      if (kind !== bestKind) {
        bestKind = kind;
        best = null;
      }
      if (best === null || metric < best - PROGRESS_EPSILON_M) {
        best = metric;
        stagesWithoutProgress = 0;
      } else {
        stagesWithoutProgress++;
      }
      // Inside, but not getting any nearer the centre: something stands on it,
      // or the map has no way further in. Being in the room was the order.
      if (isInside && stagesWithoutProgress >= PLACE_MAX_STALLED_STAGES) {
        return arrived(
          stages,
          walkedTotalM,
          distM,
          `stopped %d m from its centre, the last ${stagesWithoutProgress} stages got no closer.`,
        );
      }
      if (stagesWithoutProgress > PLACE_MAX_STALLED_STAGES) {
        return {
          ok: false,
          message:
            `goto place "${label}": stopped after ${stages} stages and ${walkedTotalM.toFixed(2)} m, still ` +
            `${distM.toFixed(2)} m from its centre and outside it — the last ${stagesWithoutProgress} stages got no ` +
            `closer, so the way in is blocked or not on the map.`,
        };
      }

      stages++;

      const segment = path && path.segments.length > 0 ? path.segments[0]! : null;
      const bearingToGoalDeg = normalizeDeg((Math.atan2(goal.y - pose.y, goal.x - pose.x) * 180) / Math.PI - pose.yawDeg);
      let turnDeg: number;
      let stageM: number;
      let planned: boolean;
      let lookAfter: boolean;
      let walkWhy: string;
      if (path && segment) {
        turnDeg = normalizeDeg(segment.headingDeg - pose.yawDeg);
        stageM = Math.min(this.maxSegmentM, segment.lengthM);
        const remainingAfter = path.lengthM - stageM;
        const next = path.segments[1] ?? null;
        lookAfter =
          metresSinceLook + stageM >= this.lookEveryM ||
          (stageM < segment.lengthM ? segment.throughUnknown : (next?.throughUnknown ?? false)) ||
          remainingAfter < MIN_STAGE_M;
        planned = true;
        plannedStages++;
        walkWhy =
          `Walking ${stageM.toFixed(1)} m along the planned path into ${label} ` +
          `(${path.lengthM.toFixed(1)} m in ${path.segments.length} segment${path.segments.length === 1 ? '' : 's'} on the map` +
          `${path.throughUnknown ? ', partly across unmapped floor' : ''}; stage ${stages}/${this.maxStages})`;
      } else if (path && !segment) {
        // Planned to within the plan's tolerance already: the final approach,
        // straight at the centre, sized to what is left.
        if (isInside && distM - ARRIVAL_M < MIN_STAGE_M) {
          return arrived(stages - 1, walkedTotalM, distM, 'the pose is %d m from its centre.');
        }
        turnDeg = bearingToGoalDeg;
        stageM = Math.max(MIN_STAGE_M, Math.min(STAGE_LENGTH_M, distM - ARRIVAL_M));
        planned = false;
        lookAfter = true;
        walkWhy = `Walking ${stageM.toFixed(1)} m into ${label} — final approach (stage ${stages}/${this.maxStages})`;
      } else {
        // No path on the map (yet): one bounded stage by sight, straight at the
        // centre. The executor clamps it to the lidar's clearance and to what
        // the map knows; the next plan starts from wherever that ended.
        turnDeg = bearingToGoalDeg;
        stageM = Math.min(UNKNOWN_DISTANCE_STAGE_M, Math.max(MIN_STAGE_M, distM - ARRIVAL_M));
        planned = false;
        lookAfter = true;
        bySightStages++;
        walkWhy =
          `Walking ${stageM.toFixed(1)} m towards ${label} (stage ${stages}/${this.maxStages}) — no known path on ` +
          `the map (${planReason ?? 'unknown'}), walking by sight until the map knows more`;
      }

      if (Math.abs(turnDeg) > BEARING_DEADBAND_DEG) {
        const turn = await this.deps.runGeneratedBlock(
          'turn',
          { angleDeg: turnDeg },
          planned
            ? `Turning ${Math.round(turnDeg)}° onto the planned path into ${label} (stage ${stages}).`
            : `Turning ${Math.round(turnDeg)}° towards the centre of ${label} (stage ${stages}).`,
        );
        if (turn.status !== 'done') {
          return { ok: false, message: `goto place "${label}": turn failed (${turn.error ?? 'unknown'})` };
        }
      }
      if (this.deps.isAborted()) {
        return { ok: false, message: `goto place "${label}" aborted after ${stages} stages` };
      }

      const walk = await this.deps.runGeneratedBlock(
        'walk',
        planned ? { distanceM: stageM, direction: 'forward', planned: true } : { distanceM: stageM, direction: 'forward' },
        `${walkWhy}.`,
      );
      if (walk.status !== 'done') {
        // The executor refusing to walk into something it can see on the map
        // or the lidar is a fact about the way, not a fault: the map has grown
        // by that fact, so plan again from here. The no-progress count at the
        // top of the loop is what ends a navigation that keeps being refused.
        if (walk.error && REFUSED_WALK.test(walk.error)) continue;
        return { ok: false, message: `goto place "${label}": walk failed (${walk.error ?? 'unknown'})` };
      }
      const walkedM = walk.measured?.distanceM ?? null;
      walkedTotalM += walkedM ?? 0;
      metresSinceLook += walkedM ?? stageM;

      if (!lookAfter) continue;
      metresSinceLook = 0;
      const look = await this.deps.runGeneratedBlock(
        'look',
        {},
        planned
          ? `Looking around on the way into ${label} (stage ${stages}) — what the place holds goes into scene memory.`
          : `Looking around before the next stage towards ${label} (stage ${stages}).`,
      );
      if (look.status !== 'done') {
        return { ok: false, message: `goto place "${label}": look failed (${look.error ?? 'unknown'})` };
      }
    }

    // The stage budget is spent. Where that leaves the robot decides the
    // verdict, not which counter expired: "go to dock 1" is carried out the
    // moment the robot stands in Dock 1, and it is no less carried out because
    // the budget ran out on the stage that put it there. The measured run this
    // stands for is the warehouse goto that walked 18.01 m across the hall,
    // ended INSIDE the Dock 1 polygon 1.41 m of planned route short of its
    // centre, and reported "gave up after 12 stages" — while the very same end
    // state one stage earlier, reached through the stall counter above, reports
    // the honest "Arrived in Dock 1 … stopped 1.41 m from its centre". Same
    // place, same pose, opposite verdicts. So: re-sample, and if the robot is
    // inside, say it arrived and say plainly how it ended. Not inside — or no
    // pose to check — is a real failure and keeps the wording below.
    const finalPose = await this.planner.samplePose();
    if (finalPose && inside(finalPose)) {
      return arrived(
        stages,
        walkedTotalM,
        Math.hypot(goal.x - finalPose.x, goal.y - finalPose.y),
        `stopped %d m from its centre — the ${this.maxStages}-stage budget ran out before it got there.`,
      );
    }

    const how = [
      plannedStages > 0 ? `${plannedStages} on a planned path` : '',
      bySightStages > 0 ? `${bySightStages} by sight` : '',
    ]
      .filter(Boolean)
      .join(', ');
    return {
      ok: false,
      message:
        `goto place "${label}": gave up after ${this.maxStages} stages${how ? ` (${how})` : ''} and ` +
        `${walkedTotalM.toFixed(2)} m` +
        `${best === null ? '' : `, ${bestKind === 'planned' ? 'shortest remaining route' : 'best distance to its centre'} ${best.toFixed(2)} m`}.`,
    };
  }

  private async navigateInner(entityLabel: string): Promise<BlockOutcome> {
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
    // Motion that never passed through Agent Mode — Quest teleop, a direct POST
    // to the sidecar, a VLA rollout, a shove on the base — used to be the
    // documented hole here: none of it touches `noteTranslationM`, so this look
    // was skipped and a distance measured before a four-metre teleop drive could
    // end a navigation at stage 0. TASK-221 closed it along the two routes that
    // motion actually takes, and the two are covered by different mechanisms:
    //
    //   - Somebody TAKES THE CONTROL LOCK. `AgentModeController` wipes scene
    //     memory outright the moment the lock goes to `'teleop'` or `'vla'`, so
    //     there is no remembered distance left for their driving to invalidate:
    //     the next `goto` finds nothing stored and looks before it does anything
    //     else. That — not the staleness rule below — is what covers a Quest
    //     session between two commands.
    //   - Somebody does NOT: a shove, the G1's handheld remote, a direct sidecar
    //     POST. `SceneMemoryStore.noteOdometryM` now takes measured fixes from
    //     two feeds — `BlockExecutor.refreshYaw`, which runs while Agent Mode
    //     itself acts, and `AgentModeController.notePolledOdometry`, which runs
    //     only while it does not — and reports the largest displacement from the
    //     pose the robot looked from. The second reads the hardware client's
    //     cached pose rather than the place belief, so it answers on an UNMAPPED
    //     robot too; keying it on a belief left exactly the fleet nobody has
    //     surveyed uncovered (TASK-221 review).
    //
    // What is left is NOT a sampling window and must not be read as one — it is
    // a LATENCY on that second route, and this look can still lose the race
    // against it. `notePolledOdometry` is not a poll of its own: it rides
    // `syncPlace()`, which every state / scene / planner pull calls, and with
    // nothing pulling, the only thing driving it is the 15 s mirror re-push
    // (`MIRROR_REPUSH_INTERVAL_MS`), on a cached pose that is itself up to 2 s
    // old. Worse, Agent Mode claims the control lock BEFORE it plans, and that
    // feed is muted for whoever holds the lock — so a `goto` cannot make up the
    // ground on its own way in. An uncommanded drive that takes no lock and is
    // followed by a command before any pull has happened is therefore still
    // invisible here, and still ends at stage 0. Closing that means subscribing
    // to `HardwareClient.onPoseSample` instead of sampling it on pull.
    //
    // A gap the store could not measure at all is not read as zero either. A
    // look with NO odometry fix behind it since the previous look — `/loco/odom`
    // timing out across it, which is the routine failure and not a fault —
    // leaves the store's window anchorless, and the next fix to land declares
    // that window unmeasured rather than zero: the store calls it moved and
    // this look runs (TASK-221 N1, `SceneMemoryStore.reopenOdomWindow`).
    //
    // The residue is the same LATENCY as above and not a second hole. A fix
    // that landed early in the window and then stopped — the 2 s pose cache
    // getting one read in before the outage — still anchors the look at the
    // pose it reported, so a blackout that starts mid-window is measured from
    // up to one fix back; and a feed that never speaks again leaves the store
    // on the commanded metres alone, exactly where a robot with no `/loco/odom`
    // has always been.
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
    /** Executor refusals in a row — see {@link MAX_REFUSED_STAGES}. */
    let refusedStages = 0;
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
    /**
     * Where the target is in the odometry frame, from the last MEASURED
     * distance (TASK-208). Kept across stages: a walk expires the scene's
     * distances (see expireOnTranslation) but not this — odometry knows how
     * far the robot has come since the fix. Refreshed on every look that
     * measures again.
     */
    let goalOdom: { x: number; y: number } | null = null;
    /** Metres walked since the last look — the planned route looks every `lookEveryM`. */
    let metresSinceLook = 0;
    let plannedStages = 0;

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

      if (measuredM !== null && measuredM <= ARRIVAL_M + ARRIVAL_SLACK_M) {
        return {
          ok: true,
          message:
            `Arrived at "${current.label}" after ${stages} stage${stages === 1 ? '' : 's'}: ` +
            `the lidar measures ${measuredM.toFixed(2)} m in that direction (nearest surface ` +
            `inside the cone around its bearing).`,
        };
      }

      // 0. Where is the target in the odometry frame, and is there a path to it
      //    on the map (TASK-208)? Only a MEASURED distance makes a goal pose;
      //    the goal survives the walks between looks because odometry does.
      const pose = this.planner ? await this.planner.samplePose() : null;
      if (pose) {
        const projected = this.projectGoal(current, pose);
        if (projected) goalOdom = projected;
      }
      const goalDistM = pose && goalOdom ? Math.hypot(goalOdom.x - pose.x, goalOdom.y - pose.y) : null;

      // Arrival by odometry: the lidar put the target HERE, and the base has
      // dead-reckoned to within the arrival distance of it since. Only from a
      // measured fix (`goalOdom` is never made from a guess), and only when no
      // fresh measurement contradicts it — a fresh one was handled above.
      if (measuredM === null && goalDistM !== null && goalDistM <= ARRIVAL_M + ARRIVAL_SLACK_M) {
        return {
          ok: true,
          message:
            `Arrived at "${current.label}" after ${stages} stage${stages === 1 ? '' : 's'}: ` +
            `odometry puts the robot ${goalDistM.toFixed(2)} m from where the lidar last measured it` +
            `${walkedTotalM > 0 ? ` (${walkedTotalM.toFixed(2)} m walked)` : ''}.`,
        };
      }

      stages++;

      let path: PlannedPath | null = null;
      let planReason: string | null = null;
      if (!this.planner) {
        planReason = 'no map planner';
      } else if (!pose) {
        planReason = 'no odometry pose';
      } else if (!goalOdom) {
        planReason = 'the target\'s distance is not measured';
      } else {
        const verdict = this.planner.plan({ x: pose.x, y: pose.y }, goalOdom);
        if (verdict.ok) {
          path = verdict.path;
        } else if (verdict.reason === 'goal-in-keepout') {
          // Refused BEFORE the first step, verbatim: this is the sentence the
          // planner and the operator get, and it names the place.
          const fence = verdict.keepout?.name ?? 'a keepout';
          this.deps.onNav?.(this.describeNav(current.label, goalOdom, null, `inside keepout ${fence}`));
          return {
            ok: false,
            message: `"${current.label}" is inside keepout ${fence} — I won't walk there.`,
          };
        } else {
          planReason = verdict.message;
        }
      }
      this.deps.onNav?.(this.describeNav(current.label, goalOdom, path, planReason));

      let intent: StageIntent;
      const segment = path && path.segments.length > 0 ? path.segments[0]! : null;
      if (path && segment && pose) {
        // 1p. Turn onto the first planned segment, in the odometry frame.
        const turnDeg = normalizeDeg(segment.headingDeg - pose.yawDeg);
        const stageM = Math.min(this.maxSegmentM, segment.lengthM);
        const remainingAfter = path.lengthM - stageM;
        const next = path.segments[1] ?? null;
        // A look is due when the route has gone `lookEveryM` since the last
        // one, when the ground ahead is unknown to the map, or when the plan
        // is about to run out — the final approach must be measured, never
        // dead-reckoned into the target.
        const lookAfter =
          metresSinceLook + stageM >= this.lookEveryM ||
          (stageM < segment.lengthM ? segment.throughUnknown : (next?.throughUnknown ?? false)) ||
          remainingAfter < MIN_STAGE_M;
        plannedStages++;
        intent = {
          turnDeg: Math.abs(turnDeg) > BEARING_DEADBAND_DEG ? turnDeg : null,
          turnWhy:
            `Turning ${Math.round(turnDeg)}° onto the planned path to "${current.label}" ` +
            `(segment 1 of ${path.segments.length}, stage ${stages}).`,
          stageM,
          walkWhy:
            `Walking ${stageM.toFixed(1)} m along the planned path to "${current.label}" ` +
            `(${path.lengthM.toFixed(1)} m in ${path.segments.length} segment${path.segments.length === 1 ? '' : 's'} on the map` +
            `${path.throughUnknown ? ', partly across unmapped floor' : ''}; stage ${stages}/${this.maxStages})`,
          planned: true,
          lookAfter,
        };
      } else {
        // 1. Re-bear: the stored bearing is world-frame, so the correction is the
        //    difference to the robot's current heading.
        const relativeDeg = normalizeDeg(current.bearingDeg - this.deps.scene.getYawDeg());
        // 2. Walk one stage — never the whole remaining distance in one go, so a
        //    stale distance estimate cannot drive the robot into the target. With
        //    a measured range the stage is sized to what is actually left; with
        //    only the odometry's memory of the last fix (TASK-208) it is what
        //    that says is left; without either it is still the blind fixed
        //    stage, then look again.
        const remaining =
          measuredM !== null
            ? Math.max(0, measuredM - ARRIVAL_M)
            : goalDistM !== null
              ? Math.max(0, goalDistM - ARRIVAL_M)
              : UNKNOWN_DISTANCE_STAGE_M;
        // The route was planned but is already inside the plan's own tolerance:
        // that is the final approach, sized above, not "walking by sight".
        const finalApproach = path !== null && !segment;
        const bySight =
          !finalApproach && this.planner
            ? ` — no known path on the map (${planReason ?? 'unknown'}), walking by sight`
            : '';
        intent = {
          turnDeg: Math.abs(relativeDeg) > BEARING_DEADBAND_DEG ? relativeDeg : null,
          turnWhy: `Turning ${Math.round(relativeDeg)}° towards "${current.label}" (stage ${stages}).`,
          // No MIN_STAGE_M floor here: `remaining` is already the approach that is
          // left, so flooring it commands the robot to walk further than the lidar
          // says it may — a target measured 0.61 m out got a 0.30 m stage, up to
          // 0.29 m of it into the target. Clamp 2a would normally catch that, but
          // it is gated on a live clearance, and the re-bearing turn just above
          // expires the clearance whenever it exceeds 10° — so the same physical
          // situation was decided by whether the correction happened to be 9° or
          // 15°. MIN_STAGE_M keeps its real job: the stop trigger in 2b.
          stageM: Math.min(STAGE_LENGTH_M, remaining),
          walkWhy: '',
          planned: false,
          lookAfter: true,
        };
        intent.walkWhy =
          `Walking ${intent.stageM.toFixed(1)} m towards "${current.label}" (stage ${stages}/${this.maxStages})` +
          `${finalApproach ? ' — final approach' : bySight}`;
      }

      if (intent.turnDeg !== null) {
        const turn = await this.deps.runGeneratedBlock('turn', { angleDeg: intent.turnDeg }, intent.turnWhy);
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

      let stageM = intent.stageM;

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
        // `planned` tells the executor this segment was checked against the map
        // (walls, peers, keepouts) — see its turn-expiry cap.
        intent.planned ? { distanceM: stageM, direction: 'forward', planned: true } : { distanceM: stageM, direction: 'forward' },
        intent.walkWhy +
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
        // The executor refusing to walk into something it can see on the map or
        // the lidar is a fact about the way, not a fault — the same treatment
        // `navigateToPlace` gives it. `goto place "kitchen"` re-planned and got
        // there while `goto "Tisch"` died on the spot with "walk failed", from
        // the same executor on the same map: an undershot turn (−53° for a
        // commanded −90°) aimed the walk at the crate the route went around,
        // and one re-plan from the corrected bearing was all it needed.
        if (walk.error && REFUSED_WALK.test(walk.error)) {
          refusedStages++;
          if (refusedStages > MAX_REFUSED_STAGES) {
            return {
              ok: false,
              message:
                `goto "${entityLabel}": stopped after ${stages} stage${stages === 1 ? '' : 's'} — ` +
                `the last ${refusedStages} were refused before the robot moved (${walk.error}), ` +
                `so the way is blocked.`,
            };
          }
          continue;
        }
        return {
          ok: false,
          message: `goto "${entityLabel}": walk failed (${walk.error ?? 'unknown'})`,
        };
      }
      refusedStages = 0;
      if (walkedM === null || walkedM >= CONTACT_STALL_M) stagesThatMoved++;
      walkedTotalM += walkedM ?? 0;
      metresSinceLook += walkedM ?? stageM;

      // 3p. On a planned route the map already knows what is between here and
      //     the next look; a full VLM look after every stage is what made a
      //     3.5 m walk take six of them. Skip it until it is due, and let the
      //     odometry carry the goal meanwhile (progress is measured against it).
      if (intent.planned && !intent.lookAfter) {
        const poseAfter = this.planner ? await this.planner.samplePose() : null;
        const nowDistance =
          poseAfter && goalOdom ? Math.hypot(goalOdom.x - poseAfter.x, goalOdom.y - poseAfter.y) : null;
        if (nowDistance !== null && (bestDistance === null || nowDistance < bestDistance - PROGRESS_EPSILON_M)) {
          bestDistance = nowDistance;
          stagesWithoutProgress = 0;
        } else {
          stagesWithoutProgress++;
        }
        continue;
      }

      // 3. Look again — this is what refreshes the bearing and the distance.
      const seenBefore = current.observedSeq;
      metresSinceLook = 0;
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
          // Before giving up on the label: is the robot simply THERE? A target
          // seen from 2 m away is often named differently from 0.6 m away (the
          // ladder that becomes "shelf" up close), and the lidar's fix on it
          // has been carried by odometry all the way (TASK-208). Standing
          // within the arrival distance of that fix is arrival — said with the
          // caveat that the last looks did not name it.
          const poseNow = this.planner ? await this.planner.samplePose() : null;
          const fixDistM = poseNow && goalOdom ? Math.hypot(goalOdom.x - poseNow.x, goalOdom.y - poseNow.y) : null;
          if (fixDistM !== null && fixDistM <= ARRIVAL_M + ARRIVAL_SLACK_M) {
            return {
              ok: true,
              message:
                `Arrived where "${current.label}" was measured, after ${stages} stage${stages === 1 ? '' : 's'} and ` +
                `${walkedTotalM.toFixed(2)} m: odometry puts the robot ${fixDistM.toFixed(2)} m from the lidar's last ` +
                `fix on it. The last ${unseenLooks} looks did not name it — up close the camera may show only part ` +
                `of it — so check the last look if the name matters.`,
            };
          }
          return {
            ok: false,
            message:
              `goto "${entityLabel}": ${unseenLooks} looks in a row did not report it, so the ` +
              `stored bearing (${Math.round(current.bearingDeg)}°) is stale and I stopped after ` +
              `${stages} stages and ${walkedTotalM.toFixed(2)} m rather than walk on an ` +
              `unconfirmed heading. It may be out of view, or close enough that the camera now ` +
              `shows only part of it and the vision model named that part something else — ` +
              `check the last look before re-scanning.` +
              // The ambiguous case reads exactly like the out-of-view one from the
              // outside, and the fix is different: naming a different landmark
              // helps, re-scanning does not.
              (current.duplicatesInView && current.duplicatesInView > 1
                ? ` Note that a look reported ${current.duplicatesInView} separate things called ` +
                  `"${current.label}" — I steered towards the most central one, so if that was ` +
                  `not the one you meant, name it differently or move closer first.`
                : ''),
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
        `goto "${entityLabel}": gave up after ${this.maxStages} stages` +
        `${plannedStages > 0 ? ` (${plannedStages} on a planned path)` : ''} and ` +
        `${walkedTotalM.toFixed(2)} m ` +
        `(${stagesWithoutProgress} of them without getting closer` +
        `${bestDistance === null ? ', distance never estimated' : `, best distance ~${bestDistance.toFixed(2)} m`}).`,
    };
  }
}
