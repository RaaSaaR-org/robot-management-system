/**
 * @file block-executor.ts
 * @description One handler per block kind, dispatching through HardwareClient's
 *              `/loco/*` LocoClient facade. A running block is NEVER interrupted
 *              mid-flight: the abort flag is checked between blocks, and inside
 *              `wait`'s sleep (which may exit early).
 * @feature agentmode
 * @status live
 */

import { config, type LeftTurnStrategy } from '../config/config.js';
import { hardwareClient, type LocoActionName, type LocoResult } from '../hardware/HardwareClient.js';
// The two clamp constants live in navigator.ts because that is where they are
// justified (the 0.45 m comment is the reason the number exists). Importing
// them is acyclic: navigator.ts imports only config, place-resolver, scene-memory and types.
import { CLEARANCE_MARGIN_M, MIN_STAGE_M, UNKNOWN_DISTANCE_STAGE_M } from './navigator.js';
import type { SegmentCheck } from './path-planner.js';
import { RangeSensor } from './range.js';
import { gateByHash, type ChecklistAnswers } from './inspector.js';
import type { PatrolCaptureHost } from './patrol.js';
import { demoNarration } from './host.js';
import { runVlaSkillBlock } from './vla-skill-block.js';
import type { SkillRunReport, SkillRunRequest } from './vla-skills.js';
import { speakThroughVoiceService } from './voice-narrator.js';
import {
  getWorkspace,
  oneLine,
  type JournalRecord,
  type PromoteResult,
  type TrustLevel,
  type Workspace,
} from './workspace.js';
import type { ObservedEntity, SceneMemoryStore } from './scene-memory.js';
import type { VisionClient, VisionObservation } from './vision.js';
import {
  DEG_TO_RAD,
  RAD_TO_DEG,
  normalizeDeg,
  type AgentBlock,
  type BlockOutcome,
  type PostureName,
  type SceneMemory,
  type SpokenLanguage,
  type WalkDirection,
} from './types.js';

/**
 * Posture → `LocoClient.SetFsmId` id. These mirror `LOCO_FSM_NAMES` in
 * `hardware/g1_sidecar.py`, which is the authoritative table for this firmware
 * (0 zero-torque, 1 damp, 3 sit, 500 start/main, 702 lie→stand, 706 squat↔stand).
 * Keep the two in sync — the sidecar passes unknown ids straight through to the
 * robot, so a wrong id here would be commanded verbatim to a real humanoid.
 *
 * `high` / `low` are deliberately ABSENT: on the G1, stand height is
 * `SetStandHeight` (API 7104), not an FSM id, and the sidecar exposes no
 * endpoint for it. Guessing an FSM id for them could make a real robot squat or
 * lie down, so {@link BlockExecutor} fails those postures with a clear message
 * instead. See the task report's contract-gap note.
 */
export const G1_FSM_IDS: Partial<Record<PostureName, number>> = {
  damp: 1,
  sit: 3,
  stand: 500,
};

/** The E-Stop damping id. Split out so the safety path never sees `undefined`. */
export const G1_FSM_DAMP = 1;

/**
 * FSM ids in which the base ACCEPTS a velocity command and does nothing with
 * it. Mirrors `NON_LOCOMOTING_FSM` in `hardware/sim_g1_dds/loco_state.py`
 * (zero-torque 0, damp 1, sit 3); the real G1's onboard FSM behaves the same.
 * `SetVelocity` still answers RPC_OK in these states, which is why a block must
 * verify motion by odometry instead of trusting the return code.
 */
export const G1_NON_LOCOMOTING_FSM_IDS: ReadonlySet<number> = new Set([0, G1_FSM_DAMP, 3]);

/** Velocity components (robot frame) for each walking direction. */
const WALK_AXES: Record<WalkDirection, { fx: number; fy: number }> = {
  forward: { fx: 1, fy: 0 },
  backward: { fx: -1, fy: 0 },
  // +y is to the robot's LEFT, matching the CCW-positive yaw convention.
  left: { fx: 0, fy: 1 },
  right: { fx: 0, fy: -1 },
};

/**
 * Render a failed `/loco/*` call as one honest line. A 403 (locomotion switched
 * off on the sidecar) is called out explicitly: it is permanent for that
 * process, so the operator must change the sidecar, not retry the command.
 */
function locoError(result: LocoResult): string {
  const reason = result.error ?? 'unknown sidecar error';
  return result.locoDisabled ? `LOCOMOTION DISABLED — ${reason}` : reason;
}

/**
 * Whether a MEASURED rotation shows that a commanded one did not happen.
 *
 * Takes a measurement, never `null`: callers must decide for themselves what an
 * unmeasurable rotation means, and the answer is always "not a failure". A
 * robot with no odometry can only dead-reckon, and failing its turns would
 * ground it for a sensor it never had — so `turnMeasured` returning `null` is
 * NOT routed here. A command small enough to sit inside the noise floor cannot
 * be judged either, so it passes.
 */
function didNotTurn(commandedDeg: number, turnedDeg: number): boolean {
  return (
    Math.abs(normalizeDeg(commandedDeg)) > ZERO_MOTION_DEG && Math.abs(turnedDeg) < ZERO_MOTION_DEG
  );
}

/** Minimum command duration — a sub-tick move would be swallowed by the FSM. */
/**
 * Fraction by which a measured motion may fall short of the command before the
 * block says so. A few percent is ordinary tracking error; more than this means
 * the robot was blocked, slowed, or the velocity command expired early — which
 * the planner must know about before it re-plans from the assumed pose.
 */
const SHORTFALL_TOLERANCE = 0.1;

/**
 * Below this, the measured motion is indistinguishable from odometry noise: the
 * robot did not move at all. Such a block FAILS, however cheerfully the sidecar
 * answered — the loco service ACKs every velocity command while the base sits
 * in a non-locomoting FSM (see {@link G1_NON_LOCOMOTING_FSM_IDS}), so a damped
 * robot lying on the floor would otherwise walk through an entire plan
 * reporting "Walked 0.00 m … done".
 */
const ZERO_MOTION_M = 0.02;
const ZERO_MOTION_DEG = 2;

/**
 * How close to the commanded heading a closed-loop turn has to land before it
 * stops correcting. 5° is a little over twice {@link ZERO_MOTION_DEG}: chasing
 * anything smaller would spend a whole extra velocity command on a correction
 * the odometry can barely distinguish from noise, and MIN_DURATION_S means the
 * shortest command available already rotates further than that at any sane
 * turn rate.
 */
const TURN_TOLERANCE_DEG = 5;

/**
 * Iteration cap for one closed-loop turn.
 *
 * Sized from the worst tracking actually measured, not the best. Against the
 * live Isaac sim `isaac_yaw_sweep.py` reports a yaw-rate ratio of 0.09–0.15, and
 * a single command is capped at {@link MAX_TURN_STEP_DEG}, so a compensated
 * correction recovers at most ~15° of heading. A half turn therefore needs of
 * the order of ten corrections, and anything smaller silently returns a large
 * shortfall instead of a turn. {@link TURN_BUDGET_MS} is the real guard; this
 * only stops the loop spinning on a base that reports motion but never
 * converges.
 */
const MAX_TURN_ITERATIONS = 12;

/**
 * Smallest yaw-rate tracking ratio {@link BlockExecutor} will compensate for.
 *
 * Measured, not guessed: `isaac_yaw_sweep.py` against the live Isaac sim reports
 * 0.09–0.15 of the commanded rate in BOTH directions, in place. At a ratio that
 * low a purely proportional loop is hopeless — the remainder decays as 0.9ⁿ, so
 * reaching {@link TURN_TOLERANCE_DEG} from 90° would need ~27 corrections. The
 * loop therefore divides the remaining angle by the tracking ratio it has just
 * measured, and this floor stops a base that reports a near-zero ratio (or one
 * dead sample) from turning that into a division by ~0.
 */
const MIN_TURN_GAIN = 0.05;

/**
 * Weight of the newest tracking observation in the running estimate.
 *
 * Deliberately heavy. The estimate starts at 1.0 (assume the base does what it
 * is told), which makes the FIRST command of every turn byte-for-byte the one
 * the open-loop code would have sent — so a base that tracks perfectly is never
 * over-commanded, and a plant this loop has never met is not slandered on the
 * strength of zero evidence. But when the truth is 0.10, a slow filter spends
 * the whole iteration budget walking the estimate down. Half-and-half converges
 * in three or four corrections while still averaging out a single odd sample.
 */
const TURN_GAIN_ALPHA = 0.5;

/**
 * How many DIRECTION REVERSALS one turn may spend correcting an overshoot.
 *
 * The loop used to stop dead at the first sign flip, on the reasoning that
 * MIN_DURATION_S floors every command at ~9° so a small correction oscillates
 * forever. That reasoning is right for a small overshoot and wrong for a large
 * one, and it made every overshoot PERMANENT: the block returned ok:true with
 * the robot pointing somewhere nobody asked for, and the map followed. A
 * reversal is now allowed while the error is bigger than the smallest command
 * that can be issued (see {@link smallestCommandableDeg}) — which is exactly the
 * condition under which a correction can land instead of bouncing — and capped
 * here so a plant that overshoots in BOTH directions still terminates.
 */
const MAX_TURN_REVERSALS = 2;

/**
 * How many consecutive dead LEFT commands confirm that this base cannot rotate
 * CCW in place, within one turn.
 *
 * One is not evidence. `isaac_loco_bridge.py` republishes a frozen yaw for up to
 * ODOM_LOWSTATE_STALE_S (1 s) and `g1_sidecar.py` serves the last fix as current
 * for 2 s more, so a single odometry hiccup on a base that turns left perfectly
 * well produces a delta of ~0 and looks exactly like the dead checkpoint. The
 * cost of re-probing is one repeated command (~2 s); the cost of believing the
 * first sample is a ~270° spin, and — before this — a process-wide latch that
 * turned every later left turn into one too.
 */
const DEAD_LEFT_PROBES = 2;

/**
 * How many separate TURNS must confirm a dead left before `auto` latches the
 * mirror strategy for the rest of the process.
 *
 * The latch outlives the block, the plan and the robot's next reboot, so it asks
 * for more than the within-turn confirmation above: two independent turns, each
 * of which measured {@link DEAD_LEFT_PROBES} dead left commands. An outage long
 * enough to fake that has already taken Agent Mode's heading away entirely.
 * The latch is also RELEASED (not merely not-taken) the moment a left command is
 * measured to rotate the base — see {@link BlockExecutor.turnMeasured} — because
 * "this checkpoint cannot turn left" must stop being believed as soon as the
 * robot demonstrates otherwise, without waiting for a restart.
 */
const DEAD_LEFT_TURNS_TO_LATCH = 2;

/**
 * Smallest left turn worth taking the LONG way round.
 *
 * Mirroring θ costs 360 − θ of extra rotation: 270° to satisfy a 90° request is
 * a trade worth making on a base that cannot turn left at all, and 354° to
 * satisfy a 6° one is not — a patrol's routine heading alignment (`capture`
 * re-aligns whenever it is more than 5° off) would become a full revolution,
 * which takes ~8 s, drifts the dead-reckoned position by more than the 6° it was
 * correcting, and looks to anyone watching like a malfunction. Below this the
 * left command is issued directly and an honest "the robot did not turn" is the
 * outcome, which is the smaller error of the two.
 */
const MIN_MIRROR_DEG = 30;

/**
 * Wall-clock ceiling on one closed-loop turn, checked BETWEEN iterations (a
 * command in flight is never cut short — the same rule as the abort flag).
 *
 * This, not {@link MAX_TURN_ITERATIONS}, is the binding limit on a base that
 * rotates very little per command, and it is what stops `turn` becoming an
 * open-ended block. Raised with the iteration cap so a poorly-tracking base can
 * actually finish a half turn: ~12 corrections of {@link MAX_TURN_STEP_DEG} at
 * 45°/s is ~40 s of commands.
 */
const TURN_BUDGET_MS = 45_000;

/**
 * Longest rotation any SINGLE velocity command may ask for.
 *
 * This is a measurement constraint, not a motion one. A rotation is recovered
 * from two yaw samples, and two samples cannot tell +190° from −170°: they end
 * on the same heading. Keeping every command under half a turn — with room for
 * a base that overshoots by up to ~20% — keeps that ambiguity out of the loop
 * entirely, so each delta unwraps with `normalizeDeg` and nothing has to guess.
 * The mirror strategy's 270° therefore goes out as 150° + 120°, which is the
 * same rotation and a measurable one.
 */
const MAX_TURN_STEP_DEG = 150;

/**
 * A rotation to be taken WHILE WALKING FORWARD — an ARC — and the walk distance
 * it is allowed to spend doing it.
 *
 * ## Why this exists at all
 *
 * On the G1 locomotion checkpoint this rig runs, an in-place LEFT rotation is
 * dead: `isaac_yaw_sweep.py` measures a commanded-to-achieved ratio of **0.01**
 * turning left in place, against 0.26–0.53 turning right. The base also drifts
 * **−0.90 °/s** while walking, so the heading correction the code needs is
 * almost always LEFT — precisely the one that does nothing. Every rotation
 * Agent Mode could emit was in-place ({@link turnToCommand} hard-zeroes vx/vy),
 * so every automatic heading correction on this checkpoint was a no-op, and a
 * `goto` across open floor bowed away from its line until it gave up.
 *
 * An ARC — `vx > 0` combined with `omega != 0` — is measured to work in both
 * directions on the same checkpoint. This is how that primitive is asked for.
 *
 * ## Why the forward speed is not negotiable
 *
 * `forwardMps` is held at the walk speed for the whole arc and is never reduced
 * to make an arc "gentler". Measured on this checkpoint: `vx = 0.3` produces no
 * gait AT ALL — the command reaches the policy (it appears in the sim's own
 * `cmd=` log) and the legs stay frozen to three decimals — while `vx = 0.5`
 * walks at 0.156 m/s. A slower arc is therefore not a slower arc, it is an
 * in-place turn with extra steps, i.e. exactly the dead command this replaces.
 *
 * The magnitude is bought with TIME instead: the budget bounds how long the
 * arc's commands may run, which bounds the rotation each one may ask for.
 */
interface ArcOption {
  /** Forward speed to hold throughout, m/s. Never reduced — see above. */
  forwardMps: number;
  /**
   * Most forward distance, COMMANDED and in metres, the arc may spend. It is
   * the caller's own distance budget: a walk's remaining metres, or the metres
   * of the coming stage a navigator alignment may eat into. An arc that cannot
   * fund one {@link MIN_DURATION_S} command out of what is left does not run.
   */
  budgetM: number;
  /**
   * Most forward distance the arc may be MEASURED to cover, m. Set only when
   * the caller budgeted REAL ground — the navigator's stage alignment — in
   * which case {@link budgetM} is this number divided by the CONFIGURED
   * `AGENT_ARC_TRAVEL_GAIN`. That gain is a prior about the base; this is the
   * promise, and the arc holds to it at the ratio it measures for itself.
   */
  travelBudgetM?: number;
}

/**
 * What an arc actually cost and covered. All zero for an in-place rotation, so
 * a caller can add these unconditionally.
 *
 * `commandedM` and `movedM` are deliberately BOTH reported and are not the same
 * number: the budget is spent in commanded metres (that is what was taken from
 * the walk), while what the robot is believed to have travelled is whatever
 * odometry reports — 31% of commanded on this checkpoint. Reporting either
 * alone would make one of the two consumers lie.
 *
 * HOW MUCH `movedM` IS WORTH DEPENDS ENTIRELY ON THE ODOMETRY UNDERNEATH IT, and
 * this comment used to claim more than the Isaac rig could deliver. Until
 * TASK-231 that bridge (`isaac_loco_bridge.py`) dead reckoned x/y from the
 * velocity it had itself commanded, so `movedM` there was the COMMAND played
 * back and any ratio computed from it was circular — it reported ~100% of
 * commanded no matter what the robot did, and once measured 7.995 m against a
 * true 0.113 m. It now publishes the sim's true world pose from `rt/sim_state`
 * and falls back to dead reckoning only when that is missing, stamping
 * `SportModeState_.error_code` (0x600D true, 0xDEAD reckoned) either way. A real
 * G1 reports real odometry and never had this problem. So: a ratio out of this
 * number is only evidence when the pose behind it was measured, and the 31%
 * above was taken on the MuJoCo path, not on Isaac.
 */
interface ArcTravel {
  /** Forward distance COMMANDED across the arc's velocity commands, m. */
  commandedM: number;
  /** Displacement MEASURED by odometry across them, m. 0 when unmeasured. */
  movedM: number;
  /** Wall time the arc's commands were held for, s. */
  durationS: number;
}

/** An in-place rotation's travel: nothing, on every axis. */
const NO_ARC_TRAVEL: ArcTravel = { commandedM: 0, movedM: 0, durationS: 0 };

/**
 * Longest stretch of a walk that may run without the heading being re-measured.
 *
 * The measurement that forced this (TASK-227, Isaac factory scene): commanding
 * `vx = 0.3` for 25 s produced 2.7 m of travel while the heading fell from +45°
 * to −18° — about **2°/s of unbidden yaw**, in a straight-line walk nobody asked
 * to curve. `walk` measured DISTANCE ONLY, so the curve was invisible: the block
 * reported "Walked 2.70 m" and the navigator re-planned from a pose 63° off the
 * one the robot was in.
 *
 * Sized in DURATION, expressed in metres, because drift accrues with the time a
 * velocity command is held and `walkToCommand` derives that time from
 * `AGENT_WALK_SPEED_MPS`. At the 0.4 m/s default, 1.5 m is 3.75 s of commanded
 * motion — about 7.5° at the measured drift rate, i.e. roughly one
 * {@link WALK_HEADING_TOLERANCE_DEG} per segment. So the heading is re-measured
 * about as often as it can go out of tolerance, and no faster: each correction
 * costs two odometry reads and at least one {@link MIN_DURATION_S} command.
 *
 * It is deliberately SHORTER than the navigator's own `AGENT_NAV_MAX_SEGMENT_M`
 * (2 m), so a planned `goto` stage is corrected inside itself rather than only
 * at the stage boundary where the navigator happens to re-plan.
 */
const MAX_WALK_SEGMENT_M = 1.5;

/**
 * How far off its starting heading a walk may be before a segment boundary
 * spends a correction on it.
 *
 * Two numbers bound this from either side. Below, {@link TURN_TOLERANCE_DEG}
 * (5°) is where the closed-loop turn stops correcting, and a walk tolerance at
 * or under it would ask for a correction the turn declines to finish — the two
 * loops would chase each other for the whole walk. Above, 8° of heading error
 * over one {@link MAX_WALK_SEGMENT_M} segment puts the end of the segment
 * 1.5·sin 8° ≈ 0.21 m off the line, which is inside the `MIN_STAGE_M` (0.3 m)
 * granularity the navigator already plans and arrives at.
 */
const WALK_HEADING_TOLERANCE_DEG = 8;

/** Why a motion command can be accepted and still move nothing. */
const NO_MOTION_HINT =
  'the command was accepted but nothing moved — the base is most likely in a ' +
  'non-locomoting FSM (damp/sit, e.g. after an E-Stop) or physically blocked. ' +
  'Send a `posture` block with pose "stand" before moving again.';

/**
 * Why an in-place LEFT rotation can be accepted and rotate nothing HERE, and
 * what does work instead.
 *
 * Said out loud, and named, because the alternative is a block that reports
 * "the robot did not turn" for the one failure mode on this rig that is neither
 * a damped base nor an obstacle — and whose fix is not "stand up and retry".
 */
const DEAD_LEFT_HINT =
  'an in-place LEFT (CCW) rotation is dead on this G1 locomotion checkpoint — ' +
  'isaac_yaw_sweep.py measures a commanded-to-achieved ratio of 0.01 turning ' +
  'left in place, against 0.26-0.53 turning right. What DOES rotate this base ' +
  'to the left is an ARC (forward velocity combined with omega), which is how ' +
  'goto takes its heading corrections — so route the move through `goto`, or ' +
  'set AGENT_LEFT_TURN_STRATEGY=mirror to take the turn the long way round to ' +
  'the right. If the base is damped or blocked instead, the same command ' +
  'measures nothing for a different reason: ' +
  NO_MOTION_HINT;

const MIN_DURATION_S = 0.2;

/**
 * How long the G1's WaveHand animation plays after SetTaskId is accepted. The
 * sim (`sim_g1_dds/loco_state.py`, WAVE_DURATION_S) is timed to the same value.
 */
export const WAVE_GESTURE_MS = 4_000;
/** Cap so a hallucinated distance cannot produce a minutes-long command. */
const MAX_DURATION_S = 60;

export interface WalkCommand {
  vx: number;
  vy: number;
  omega: number;
  durationS: number;
}

/**
 * The forward velocity that goes ON THE WIRE, given the speed a caller asked
 * for. `AGENT_WALK_COMMAND_MPS` wins when set; the sentinel 0 resolves back to
 * the caller's speed, which is the old coupled behaviour.
 *
 * Shared by {@link walkToCommand} and {@link BlockExecutor.arcFor} on purpose.
 * An arc drives the base forward exactly as a walk does, so if the two resolved
 * their commanded velocity differently, tuning a rig past its stepping
 * threshold would fix the walk and leave every arcing heading correction below
 * it — silently, since a base that does not step still reports a completed
 * command. That is the same dead correction the arc was added to replace.
 */
function commandedForwardMps(speedMps: number): number {
  const speed = Math.abs(speedMps) > 1e-6 ? Math.abs(speedMps) : 0.4;
  return Math.abs(config.agentMode.walkCommandMps) > 1e-6
    ? Math.abs(config.agentMode.walkCommandMps)
    : speed;
}

/**
 * distance (m) → (vx, vy, duration). Velocity is held constant and the
 * DURATION carries the distance; that is what LocoClient's
 * `SetVelocity(vx, vy, omega, duration)` expects.
 *
 * Two speeds, not one: `AGENT_WALK_COMMAND_MPS` is what goes on the wire and
 * `AGENT_WALK_ACHIEVED_MPS` is what the duration is derived from. Both default
 * to the sentinel 0, which resolves back to `speedMps` — so an untuned rig gets
 * the old coupled `AGENT_WALK_SPEED_MPS` arithmetic byte for byte. See
 * `__tests__/walk-profile.test.ts`.
 */
export function walkToCommand(
  distanceM: number,
  direction: WalkDirection,
  speedMps: number = config.agentMode.walkSpeedMps
): WalkCommand {
  const speed = Math.abs(speedMps) > 1e-6 ? Math.abs(speedMps) : 0.4;
  const distance = Math.abs(distanceM);
  const axes = WALK_AXES[direction] ?? WALK_AXES.forward;
  // THE SAME TWO ROLES A TURN HAS, AND THE SAME REASON THEY MUST SEPARATE.
  //
  // `speed` was doing both jobs: it set the commanded vx AND the speed the
  // duration was divided by. On a base with a stepping threshold those pull
  // apart. The Isaac G1 will not initiate a gait below ~0.5 m/s commanded and
  // the sim clamps vx at 1.5, while what it ACHIEVES is about a quarter of
  // whatever it is asked for (measured against the sim's true root pose:
  // vx 1.5 -> 0.341 m/s). Coupled, a 1 m walk at vx 1.5 becomes a 0.67 s
  // command -- shorter than the base's own gait initiation -- and the robot
  // does not move at all.
  //
  // Both overrides default to the sentinel 0, which resolves back to `speed`,
  // so an untuned rig is byte-identical to the old behaviour.
  const commanded = commandedForwardMps(speed);
  const achieved = Math.abs(config.agentMode.walkAchievedMps) > 1e-6
    ? Math.abs(config.agentMode.walkAchievedMps)
    : speed;
  const durationS = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, distance / achieved));
  return { vx: axes.fx * commanded, vy: axes.fy * commanded, omega: 0, durationS };
}

/**
 * angle (deg, + = left/CCW) → (omega, duration) at AGENT_TURN_SPEED_DPS. omega
 * is rad/s because that is LocoClient's unit; its SIGN carries the direction and
 * the duration carries the magnitude.
 *
 * The angle is NORMALIZED first, so this always takes the shorter way round —
 * 270° left is issued as 90° right. That is the right rule for an operator's
 * `turn` block and the wrong one for the mirror strategy, which exists to take
 * the LONG way deliberately; see {@link turnToCommandExact}.
 */
export function turnToCommand(
  angleDeg: number,
  turnSpeed?: number | TurnProfile
): WalkCommand {
  return turnToCommandExact(normalizeDeg(angleDeg), turnSpeed);
}

/**
 * The two DIFFERENT numbers a turn command is made of.
 *
 * They used to be one number, `AGENT_TURN_SPEED_DPS`, doing double duty: it set
 * the commanded omega AND the rate the hold duration was divided out of. That
 * works exactly as long as the base does what it is told. On the Isaac factory
 * rig it does not — measured 2026-08-29, in place, commanded rad/s → achieved
 * deg/s:
 *
 * ```
 *   0.60 → left +0.11  right −0.25      (both effectively dead)
 *   0.79 → left +0.10  right −3.5
 *   0.90 → left +0.51  right −5.45
 *   1.20 → left +5.09  right −14.73
 *   1.60 → left +7.88  right −13.89
 *   2.00 → left +9.29  right −20.35
 * ```
 *
 * Two facts fall out, and they pull the single knob in OPPOSITE directions:
 *
 *   1. There is a **deadband**. Below about 0.9 rad/s an in-place turn produces
 *      essentially nothing, and the 45 °/s default is 0.785 rad/s — inside it.
 *      The COMMANDED omega therefore has to go UP.
 *   2. What comes back **saturates** an order of magnitude below the command, so
 *      the DURATION has to be derived from a much LOWER rate. Dividing 90° by
 *      45 °/s and holding 2 s buys ~19° at 9.29 °/s.
 *
 * The asymmetry (roughly 2× better turning right than left) lives in the
 * vendor's trained locomotion policy, not in this file. It cannot be fixed here,
 * only compensated — which is why the achieved rate is per-direction.
 */
export interface TurnProfile {
  /** Commanded |omega| in rad/s. Must clear the base's deadband. */
  commandRadS: number;
  /** Yaw rate ACHIEVED turning left (CCW, +omega), deg/s. Sizes the duration. */
  achievedDpsLeft: number;
  /** Yaw rate ACHIEVED turning right (CW, −omega), deg/s. Sizes the duration. */
  achievedDpsRight: number;
}

/** `AGENT_TURN_SPEED_DPS`, or 45 when it is unset or nonsense. */
function nominalTurnDps(): number {
  return Math.abs(config.agentMode.turnSpeedDps) > 1e-6
    ? Math.abs(config.agentMode.turnSpeedDps)
    : 45;
}

/** A finite, strictly positive override, or the fallback. */
function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 1e-6 ? value : fallback;
}

/**
 * The profile a command with this forward speed is issued under: the ARC
 * numbers when `vx > 0`, the in-place ones otherwise. Forward motion partially
 * lifts the deadband (0.785 rad/s is dead standing still and turns at 4.68 °/s
 * at `vx = 0.5`), so the two are measured and configured separately.
 *
 * EVERY fallback ends at `nominalTurnDps()`, which is what the coupled code did.
 * With no env var set this returns `{ 45°/s as rad/s, 45, 45 }` and every number
 * downstream is identical to the code this replaced.
 */
export function turnProfileFor(forwardMps = 0): TurnProfile {
  const a = config.agentMode;
  const nominal = nominalTurnDps();
  const arcing = Number.isFinite(forwardMps) && forwardMps > 1e-6;
  const commandRadS = positiveOr(
    arcing ? a.turnArcCommandRadS : 0,
    positiveOr(a.turnCommandRadS, nominal * DEG_TO_RAD)
  );
  return {
    commandRadS,
    achievedDpsLeft: positiveOr(
      arcing ? a.turnArcAchievedDpsLeft : 0,
      positiveOr(a.turnAchievedDpsLeft, nominal)
    ),
    achievedDpsRight: positiveOr(
      arcing ? a.turnArcAchievedDpsRight : 0,
      positiveOr(a.turnAchievedDpsRight, nominal)
    ),
  };
}

/**
 * A `turnSpeedDps` number, as every caller used to pass, expressed as the
 * profile it always implicitly meant: commanded omega and achieved rate equal,
 * both directions the same. An explicit number is therefore still an exact
 * override of both roles and bypasses the env tuning — which is what a caller
 * that hands over a rate is asking for.
 */
function coupledProfile(turnSpeedDps: number): TurnProfile {
  const rate = Math.abs(turnSpeedDps) > 1e-6 ? Math.abs(turnSpeedDps) : 45;
  return { commandRadS: rate * DEG_TO_RAD, achievedDpsLeft: rate, achievedDpsRight: rate };
}

/** The rate a rotation of this sign is expected to actually achieve, deg/s. */
export function achievedDpsFor(profile: TurnProfile, angleDeg: number): number {
  return angleDeg >= 0 ? profile.achievedDpsLeft : profile.achievedDpsRight;
}

/** Resolve whatever the second argument of a turn conversion was given as. */
function resolveTurnProfile(
  turnSpeed: number | TurnProfile | undefined,
  forwardMps: number
): TurnProfile {
  if (typeof turnSpeed === 'number') return coupledProfile(turnSpeed);
  if (turnSpeed) return turnSpeed;
  return turnProfileFor(forwardMps);
}

/**
 * The same conversion as {@link turnToCommand}, for an angle that is ALREADY
 * the exact rotation to perform — no shortest-path normalization.
 *
 * The mirror strategy (see {@link BlockExecutor}) turns left 90° by commanding
 * right 270°, and normalizing would fold that straight back into the +90° that
 * this locomotion policy ignores. Magnitudes beyond a full turn are clamped to
 * 360°, because more than one revolution is never a rotation anybody asked for.
 */
export function turnToCommandExact(
  angleDeg: number,
  turnSpeed?: number | TurnProfile,
  forwardMps = 0
): WalkCommand {
  // `forwardMps` is the ONLY way a command with both vx and omega leaves this
  // file, and it defaults to 0 so every existing caller is byte-identical. It
  // also selects the profile: an arc and an in-place turn are different plants.
  const vx = Number.isFinite(forwardMps) && forwardMps > 0 ? forwardMps : 0;
  const profile = resolveTurnProfile(turnSpeed, vx);
  const angle = Number.isFinite(angleDeg)
    ? Math.max(-360, Math.min(360, angleDeg))
    : 0;
  // The two roles, separated. The DURATION carries the magnitude and so must be
  // divided by what the base ACHIEVES in this direction; the OMEGA has to clear
  // the deadband and is not that number. See {@link TurnProfile}.
  const achieved = achievedDpsFor(profile, angle);
  const durationS = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, Math.abs(angle) / achieved));
  const omega = Math.sign(angle) * profile.commandRadS;
  return { vx, vy: 0, omega, durationS };
}

/**
 * The smallest rotation a single command can ASK FOR, in degrees.
 *
 * {@link MIN_DURATION_S} floors every command's duration, so a request for 1° and
 * a request for 9° go out as the same 0.2 s of omega — a base that tracks its
 * command perfectly rotates ~9° for both. Two rules depend on knowing that
 * number rather than assuming it: a correction smaller than this cannot land (it
 * can only replace one overshoot with another, which is why a reversal is
 * refused below it), and a "shortfall" smaller than this is quantisation, not a
 * robot that fell short.
 */
function smallestCommandableDeg(angleDeg: number, forwardMps: number): number {
  // Direction-dependent, because the ACHIEVED rate is: on the Isaac rig the
  // shortest command buys 1.9° to the left and 4.1° to the right. With no env
  // tuning both are `MIN_DURATION_S × AGENT_TURN_SPEED_DPS`, exactly as before.
  return MIN_DURATION_S * achievedDpsFor(turnProfileFor(forwardMps), angleDeg);
}

/** Everything a block handler may touch. Injectable end-to-end for tests. */
export interface BlockExecutorDeps {
  scene: SceneMemoryStore;
  vision: VisionClient;
  /**
   * LiDAR ranging for every observation. Defaults to a real {@link RangeSensor},
   * which talks to the sidecar and degrades to "no readings" when there is none
   * — the same facade pattern as {@link BlockExecutorDeps.loco}, so a test can
   * inject a disabled or scripted sensor instead of reaching for the network.
   */
  range?: RangeSensor;
  /** Checked between blocks and inside `wait` — never mid-motion. */
  isAborted: () => boolean;
  /**
   * The map's verdict on the straight line `distanceM` ahead (TASK-208):
   * keepouts at the geofence margin, occupied cells, peers. `null` when there
   * is nothing to say — no pose, no map and no keepouts — which clamps
   * nothing: fail-closed on the honest side, never a false "clear".
   */
  checkForwardPath?: (distanceM: number) => Promise<SegmentCheck | null> | SegmentCheck | null;
  /** Called after every scene merge so the controller can mirror it. */
  onScene?: (scene: SceneMemory) => void;
  /**
   * Called after every look with the RAW observation and is AWAITED (TASK-212):
   * the patrol's en-route comparators run here, and the one line the robot
   * says when it confirms a person is what makes the look a pause. Absent or
   * null-returning when no patrol is active — the executor never knows.
   */
  onLook?: (observation: VisionObservation) => Promise<void> | void;
  /**
   * The active patrol's capture/inspect host (TASK-212), or null when no
   * patrol runs — `capture`/`inspect` then fail with a plain message. A getter,
   * because the executor is built once and patrols come and go.
   */
  patrol?: () => PatrolCaptureHost | null;
  /**
   * Run one VLA skill for a `demo` block (TASK-213), or absent when this agent
   * cannot — the block then says so instead of pretending. Supplied by the
   * controller (which owns the RobotStateManager the SkillExecutor needs);
   * deliberately NOT an HTTP call back into our own REST API, which would make
   * a demo depend on the agent being reachable from itself.
   */
  runSkill?: (input: SkillRunRequest) => Promise<SkillRunReport>;
  /** Grab a base64 JPEG from a named camera. Default: the sidecar. */
  snapshot?: (cameraName: string) => Promise<string>;
  /** Camera used by `capture` (default `AGENT_CAMERA_NAME`). */
  cameraName?: string;
  /**
   * How an in-place LEFT rotation is executed (default
   * `AGENT_LEFT_TURN_STRATEGY`). Injectable so a test can pin one strategy
   * without reaching into `process.env`, and so a second embodiment could be
   * given its own without a global.
   */
  leftTurnStrategy?: LeftTurnStrategy;
  loco?: {
    move(vx: number, vy: number, omega: number, durationS: number): Promise<LocoResult>;
    action(name: LocoActionName, args?: Record<string, unknown>): Promise<LocoResult>;
    fsm(id: number): Promise<LocoResult>;
    standHeight(preset: 'high' | 'low'): Promise<LocoResult>;
    odometry(): Promise<{ x: number; y: number; yaw: number; source: string } | null>;
  };
  /** Voice service POST. Default: `${VOICE_SERVICE_URL}/say`. */
  say?: (text: string, language?: SpokenLanguage) => Promise<boolean>;
  /**
   * Language the robot speaks in right now — the operator's, when the command
   * arrived by voice. A getter, not a value, because it belongs to the running
   * plan while the executor is built once at startup.
   */
  language?: () => SpokenLanguage | undefined;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /**
   * Durable memory for the `remember` block (TASK-197). Defaults to the process
   * workspace singleton; `null` disables the block with an honest refusal
   * rather than pretending the line was stored.
   */
  memory?: Workspace | null;
  /**
   * How much a `remember` from this channel is trusted. A getter, because it is
   * a property of WHO is talking right now, not of the executor.
   *
   * Default `untrusted`, NOT `operator`. The trust tier exists to keep content
   * nobody vouched for out of durable memory, and `DURABLE_TRUST_LEVELS` is a
   * Set precisely so an unlisted level is refused by default rather than
   * admitted by omission — a default that hands out the most privileged tier to
   * any construction that forgot the dep contradicts that in the same feature.
   * The controller supplies the real answer (see `rememberTrust()` there); an
   * executor built without one can journal, and cannot write memory.
   */
  rememberTrust?: () => TrustLevel;
  /**
   * Report the outcome of a DURABLE write (TASK-197). Called with `false` when
   * a write to the workspace actually failed on the disk, and with `true` when
   * one lands — the controller turns that into the `workspace_write_failed`
   * heartbeat predicate, so "my memory silently stopped recording" becomes
   * something the robot says instead of something only the log knows.
   *
   * A REFUSAL is not a failure and is deliberately not reported here: an
   * untrusted record, a full file or a place-scoped note with no place all mean
   * the disk is fine and the block outcome already says so.
   */
  onDurableWrite?: (ok: boolean, error: string | null) => void;
}

const defaultLoco: NonNullable<BlockExecutorDeps['loco']> = {
  move: (vx, vy, omega, durationS) => hardwareClient.locoMove(vx, vy, omega, durationS),
  action: (name, args) => hardwareClient.locoAction(name, args),
  fsm: (id) => hardwareClient.locoFsm(id),
  standHeight: (preset) => hardwareClient.locoStandHeight(preset),
  odometry: () => hardwareClient.getLocoOdometry(),
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BlockExecutor {
  private readonly deps: BlockExecutorDeps;
  private readonly loco: NonNullable<BlockExecutorDeps['loco']>;
  private readonly range: RangeSensor;
  private readonly say: (text: string, language?: SpokenLanguage) => Promise<boolean>;
  private readonly language: () => SpokenLanguage | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly memory: Workspace | null;
  private readonly rememberTrust: () => TrustLevel;
  private readonly onDurableWrite: (ok: boolean, error: string | null) => void;
  private readonly snapshot: (cameraName: string) => Promise<string>;
  private readonly cameraName: string;
  private readonly leftTurnStrategy: LeftTurnStrategy;
  /**
   * `auto` has DECIDED that this base cannot turn left in place, from a measured
   * dead iteration. One executor is built per process (`AgentModeController`),
   * so this is the process-wide latch the strategy describes; keeping it on the
   * instance is what lets a test observe it without a global reset hook.
   */
  private mirrorLeftTurns = false;
  /**
   * How many separate turns have CONFIRMED a dead left (see
   * {@link DEAD_LEFT_TURNS_TO_LATCH}). Reset to zero by any left command that is
   * measured to rotate the base.
   */
  private deadLeftTurns = 0;
  /**
   * Running estimate of the fraction of a commanded rotation this base actually
   * performs, in (0, 1] — kept PER DIRECTION, because on this checkpoint the two
   * are not the same number and are not within an order of magnitude of each
   * other: `isaac_yaw_sweep.py` measures 0.26–0.53 turning right in place and
   * 0.01 turning left. One scalar updated from whichever direction turned last
   * meant a left turn's estimate sized the next RIGHT command — 45° right
   * divided by a left-derived 0.107 is a 420° request, clamped to
   * {@link MAX_TURN_STEP_DEG} and executed as a 150° spin for a 45° block.
   *
   * Both start at 1 — "it does what it is told" — and only measurement moves
   * them. Latched on the instance, like {@link mirrorLeftTurns} and for the same
   * reason: poor yaw tracking is a property of the checkpoint, not of one block,
   * so later turns start from what earlier ones learned instead of re-paying the
   * discovery every time. What a latched estimate may NOT do is size the first
   * command of a later turn — see {@link turnMeasured}.
   */
  private turnGain: { left: number; right: number } = { left: 1, right: 1 };

  constructor(deps: BlockExecutorDeps) {
    this.deps = deps;
    this.loco = deps.loco ?? defaultLoco;
    this.range = deps.range ?? new RangeSensor();
    this.say = deps.say ?? speakThroughVoiceService;
    this.language = deps.language ?? (() => undefined);
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? (() => Date.now());
    // `undefined` means "the real workspace"; an explicit `null` means "no
    // durable memory on this agent", which must stay expressible.
    this.memory = deps.memory === undefined ? getWorkspace() : deps.memory;
    this.rememberTrust = deps.rememberTrust ?? ((): TrustLevel => 'untrusted');
    this.onDurableWrite = deps.onDurableWrite ?? ((): void => {});
    this.snapshot = deps.snapshot ?? ((name) => hardwareClient.snapshot(name));
    this.cameraName = deps.cameraName ?? config.agentMode.cameraName;
    this.leftTurnStrategy = deps.leftTurnStrategy ?? config.agentMode.leftTurnStrategy;
  }

  /**
   * Run one block. Always resolves — a failure is a `{ok:false, message}`
   * outcome, never a thrown error, so the plan loop can decide what to do.
   *
   * `goto` is NOT handled here: it expands into visible blocks and is driven by
   * the Navigator, which calls back into this executor per generated block.
   */
  async execute(block: AgentBlock): Promise<BlockOutcome> {
    try {
      switch (block.kind) {
        case 'walk':
          return await this.walk(block);
        case 'turn':
          return await this.turn(block);
        case 'look':
          return await this.look(block);
        case 'scan_room':
          return await this.scanRoom(block);
        case 'wave':
          return await this.wave(block);
        case 'greet':
          return await this.greet(block);
        case 'posture':
          return await this.posture(block);
        case 'speak':
          return await this.speak(block);
        case 'wait':
          return await this.wait(block);
        case 'remember':
          return this.remember(block);
        case 'goto':
          return {
            ok: false,
            message: 'internal error: "goto" must be expanded by the navigator',
          };
        case 'capture':
          return await this.capture(block);
        case 'inspect':
          return await this.inspect(block);
        case 'patrol':
          return {
            ok: false,
            message: 'internal error: "patrol" is the run itself and is driven by PatrolRunner',
          };
        case 'present':
          return await this.present(block);
        case 'demo':
          return await this.demo(block);
        case 'vla_skill':
          return await runVlaSkillBlock(block, this.deps);
        case 'tour':
          return {
            ok: false,
            message: 'internal error: "tour" is the visit itself and is driven by TourRunner',
          };
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── motion ────────────────────────────────────────────────────────────────

  private async walk(block: AgentBlock): Promise<BlockOutcome> {
    const requestedM = Number(block.params.distanceM);
    const direction = (block.params.direction as WalkDirection) ?? 'forward';
    if (!Number.isFinite(requestedM)) return { ok: false, message: 'walk: distanceM is not a number' };

    // The measured clearance used to protect only the blocks the NAVIGATOR
    // generated — `getForwardClearanceM()` had exactly one caller. So a plan
    // the model wrote itself ("look, then walk 3 m") drove open-loop at a
    // surface the same look had measured at 1.20 m and printed into the very
    // prompt that produced the plan. Any walk is now clamped by whatever the
    // sensor last said, wherever the block came from.
    //
    // Three properties are deliberate. `null` is UNKNOWN and clamps nothing, so
    // this can never make the robot more timid than the sensor justifies.
    // Forward only, because `forwardClearance` measures the +x corridor and
    // nothing else. And the comparison is strict, so it is provably a no-op for
    // navigator stages, which already clamped themselves to the same number.
    let distanceM = requestedM;
    let clampNote = '';
    if (direction === 'forward') {
      const clearanceM = this.deps.scene.getForwardClearanceM();
      if (clearanceM !== null) {
        const allowedM = Math.max(0, clearanceM - CLEARANCE_MARGIN_M);
        if (allowedM < distanceM) {
          if (allowedM < MIN_STAGE_M) {
            return {
              ok: false,
              message:
                `walk: the lidar measures ${clearanceM.toFixed(2)} m straight ahead, inside the ` +
                `${CLEARANCE_MARGIN_M.toFixed(2)} m stopping margin — refusing to walk into it. ` +
                `Turn, or use goto so the approach is measured.`,
            };
          }
          distanceM = allowedM;
          // Say it in the result, not only in the log: the planner re-plans
          // from what the block reports, so a silent clamp would have it
          // believing a pose the robot never reached.
          clampNote =
            ` Shortened from the requested ${requestedM.toFixed(2)} m — the lidar measures ` +
            `${clearanceM.toFixed(2)} m straight ahead.`;
        }
      }
    }

    // The MAP's check (TASK-208): the whole straight segment, sampled every
    // 0.1 m, against the keepouts (at the geofence margin), the occupied cells
    // and the peers. This is what turns the keepout from a fence the robot
    // hits into a line it does not cross, and it protects EVERY forward walk,
    // not only the navigator's. Absent map/pose → `null` → nothing changes.
    let mapCheck: SegmentCheck | null = null;
    if (direction === 'forward' && this.deps.checkForwardPath) {
      mapCheck = await this.deps.checkForwardPath(distanceM);
      if (mapCheck?.blocker && mapCheck.allowedM < distanceM) {
        const what =
          mapCheck.blocker.kind === 'keepout'
            ? `${mapCheck.blocker.label} keepout`
            : mapCheck.blocker.label;
        if (mapCheck.allowedM < MIN_STAGE_M) {
          return {
            ok: false,
            message:
              `walk: ${what} is ${mapCheck.allowedM.toFixed(2)} m ahead on the map — refusing to walk into it. ` +
              `Turn, or use goto so the route is planned around it.`,
          };
        }
        // The map's stop is the tighter one and it names the reason, so it
        // replaces the lidar's note rather than being appended to it — one
        // sentence, measured against what was ASKED, not against the clamp.
        const shortM = requestedM - mapCheck.allowedM;
        distanceM = mapCheck.allowedM;
        clampNote =
          ` Stopped ${shortM.toFixed(2)} m short of the requested ${requestedM.toFixed(2)} m — ` +
          `${what} ahead at ${mapCheck.allowedM.toFixed(2)} m on the map.`;
      }
    }

    // The turn-expiry cap (TASK-208). "turn 45°, walk 3 m" used to escape the
    // clamp above: the turn retired the clearance, `null` clamped nothing, and
    // the walk ran open-loop down a heading nobody had measured. Now a
    // clearance the robot has turned away from means UNKNOWN AHEAD, and unknown
    // ahead is the blind stage — unless something else has checked the way: a
    // navigator segment planned on the map, or the map itself knowing the
    // floor to be free that far. A `null` that was never a measurement (no
    // lidar at all) still clamps nothing, exactly as before.
    if (
      direction === 'forward' &&
      block.params.planned !== true &&
      this.deps.scene.getForwardClearanceM() === null &&
      this.deps.scene.wasClearanceExpiredByTurn()
    ) {
      const capM = Math.max(UNKNOWN_DISTANCE_STAGE_M, mapCheck?.knownM ?? 0);
      if (capM < distanceM) {
        clampNote +=
          ` Shortened to ${capM.toFixed(2)} m of the requested ${requestedM.toFixed(2)} m — the lidar's clearance was ` +
          `measured on a heading the robot has since turned away from, so this heading is unmeasured; ` +
          `look, then walk on.`;
        distanceM = capM;
      }
    }

    const before = await this.loco.odometry();

    // ── no odometry: exactly the open-loop walk that shipped ──────────────
    //
    // Same rule as `turnMeasured`: a robot that cannot measure its heading has
    // nothing to hold it against, and segmenting a walk to compare dead-reckoned
    // yaw with itself would be guesswork dressed up as feedback. One command,
    // and the message says the walk is unverified — including, now, its heading,
    // because "I do not know where I am pointing" is exactly the thing this
    // block must never leave unsaid.
    if (!before) {
      const cmd = walkToCommand(distanceM, direction);
      const result = await this.driveFor(cmd);
      if (!result.ok) return { ok: false, message: `walk failed: ${locoError(result)}` };
      return {
        ok: true,
        message:
          `Commanded ${distanceM.toFixed(2)} m ${direction} ` +
          `(${cmd.durationS.toFixed(1)} s at ${config.agentMode.walkSpeedMps} m/s). ` +
          `No odometry available — distance travelled and heading held are unverified.${clampNote}`,
      };
    }

    // ── closed loop on HEADING (TASK-227) ─────────────────────────────────
    //
    // `walk` measured distance and nothing else, so a base that curves as it
    // walks reported a perfectly good number for a walk that went somewhere
    // else. The factory-scene measurement behind {@link MAX_WALK_SEGMENT_M} is
    // 2°/s of unbidden yaw; over one long command that is tens of degrees, and
    // the navigator's next stage is planned from a heading the robot left.
    //
    // The walk is therefore cut into segments, the yaw is re-measured at every
    // boundary, and an error beyond {@link WALK_HEADING_TOLERANCE_DEG} is
    // steered out with the SAME closed-loop turn the `turn` block uses — so the
    // measured tracking ratio in `this.turnGain` is shared, never re-estimated.
    //
    // Segmenting must not change how far the robot goes: the segments are equal
    // and sum to `distanceM`.
    const startYawDeg = normalizeDeg(before.yaw * RAD_TO_DEG);
    const segmentCount = Math.max(1, Math.ceil(Math.abs(distanceM) / MAX_WALK_SEGMENT_M));
    const segmentM = distanceM / segmentCount;

    let fix = before;
    let movedM = 0;
    let commandedS = 0;
    let commandedM = 0;
    let corrections = 0;
    let walkedSegments = 0;
    /**
     * How much of the commanded distance is still unspent.
     *
     * It exists because a heading correction is no longer necessarily a rotation
     * in place: an ARC (see {@link ArcOption}) covers ground while it turns, and
     * that ground is part of this walk, not extra. Every arc therefore DRAWS
     * FROM this budget and the following segments shrink by what it took, so
     * "walk 3 m" is still 3 m of commanded travel however many corrections it
     * spends — which is what the lidar clamp, the map check and the navigator's
     * stage arithmetic above all assumed when they sized `distanceM`.
     */
    let budgetM = Math.abs(distanceM);
    /** Corrections taken as arcs, and the distance they measurably covered. */
    let arcCorrections = 0;
    let arcMovedM = 0;
    /** Segments whose displacement was actually measured, not assumed. */
    let measuredSegments = 0;
    /** Odometry stopped answering part-way through — measured, then blind. */
    let lostFixAfter: number | null = null;
    /** A per-segment re-check, a dead segment or the duration cap stopped us. */
    let stopNote = '';

    for (let i = 0; i < segmentCount; i++) {
      let thisSegmentM = segmentM;

      // Arc corrections have already walked part of the way, so a segment may
      // only ask for what is LEFT of the commanded distance. Without this the
      // arcs would be distance ON TOP of the walk and the robot would overshoot
      // what it was told — past the lidar clearance the block clamped itself to.
      if (Math.abs(thisSegmentM) > budgetM) {
        if (budgetM <= ZERO_MOTION_M) {
          stopNote =
            ` Stopped after ${walkedSegments} of ${segmentCount} segments — the heading ` +
            `corrections arced through the rest of the commanded distance.`;
          break;
        }
        thisSegmentM = Math.sign(segmentM || 1) * budgetM;
      }

      // Re-run the SAME two checks `walk` opened with, from the pose the robot
      // is standing at now — a segmented walk that did not re-check would be
      // the old open-loop walk with extra steps. Skipped for i === 0, which the
      // block-level checks above already covered from this very pose, so no
      // check is paid for twice and `checkForwardPath` is not called twice for
      // an unsegmented walk. Sideways and backward walks are not re-checked for
      // the same reason they are not checked at all: `forwardClearance` and
      // `checkForwardPath` measure the +x corridor and nothing else.
      if (i > 0 && direction === 'forward') {
        const recheck = await this.checkSegmentAhead(thisSegmentM);
        if (recheck.reason !== null) {
          if (recheck.allowedM < MIN_STAGE_M) {
            stopNote =
              ` Stopped after ${walkedSegments} of ${segmentCount} segments — ` +
              `${recheck.reason}, inside the shortest useful stage.`;
            break;
          }
          // Something is in the way within this segment. Walk up to it and stop
          // there: the rest of the walk was aimed through whatever this is.
          thisSegmentM = recheck.allowedM;
          stopNote =
            ` Stopped after ${walkedSegments + 1} of ${segmentCount} segments — ${recheck.reason}.`;
        }
      }

      const cmd = walkToCommand(thisSegmentM, direction);
      // `walkToCommand` caps ONE command at MAX_DURATION_S, which is what used
      // to bound a hallucinated "walk 1000 m" to a minute of motion. Segmenting
      // would have turned that cap into `segments × MAX_DURATION_S` — 667
      // minutes for the same block — so it is applied to the WHOLE walk here.
      // The first segment always fits (it is at most MAX_WALK_SEGMENT_M), so
      // this can never refuse to take a step.
      if (i > 0 && commandedS + cmd.durationS > MAX_DURATION_S) {
        stopNote =
          ` Stopped after ${walkedSegments} of ${segmentCount} segments — ` +
          `${MAX_DURATION_S} s is the most one walk block may command.`;
        break;
      }

      commandedS += cmd.durationS;
      commandedM += Math.abs(thisSegmentM);
      budgetM = Math.max(0, budgetM - Math.abs(thisSegmentM));
      const result = await this.driveFor(cmd);
      if (!result.ok) return { ok: false, message: `walk failed: ${locoError(result)}` };
      walkedSegments++;

      const after = await this.loco.odometry();
      // Odometry that goes away mid-walk is not a measurement of zero — the
      // same rule the turn loop follows. Stop, and report what was measured up
      // to the last good fix rather than guessing at the rest.
      if (!after) {
        lostFixAfter = walkedSegments;
        break;
      }
      const stepM = Math.hypot(after.x - fix.x, after.y - fix.y);
      movedM += stepM;
      measuredSegments++;
      fix = after;

      // A segment that measurably did not move will not be fixed by sending it
      // again: stop, and let the zero-motion rule below decide what it means
      // for the walk as a whole.
      if (Math.abs(thisSegmentM) > ZERO_MOTION_M && stepM < ZERO_MOTION_M) {
        if (stopNote === '') {
          stopNote = ` Stopped after ${walkedSegments} of ${segmentCount} segments — the base stopped moving.`;
        }
        break;
      }
      if (stopNote !== '') break; // the re-check above shortened this segment

      // Steer the heading back. `allowMirror: false` deliberately: a base the
      // mirror strategy exists for would answer a 10° correction with 350° of
      // rotation in the middle of a walk, which is worse than the drift. If
      // this base cannot turn that way the correction measures nothing, the
      // loop stops correcting, and the residual is REPORTED — the honest
      // failure, not a spin.
      //
      // It is taken as an ARC whenever there is forward distance left to spend
      // (TASK-227 follow-up). This is the correction the whole feature is for:
      // the base drifts right at −0.90 °/s, so `-errorDeg` is almost always a
      // LEFT rotation, and a left rotation IN PLACE achieves 0.01 of what it is
      // told on this checkpoint. The mirror escape is disabled here for the
      // reason above, which left this loop with no working primitive at all —
      // every heading correction in every walk was a command the robot ignored.
      // An arc is measured to work, costs no extra distance (it comes out of
      // `budgetM`), and does not stop the gait to do it.
      //
      // Sideways and backward walks keep the in-place turn: `forwardMps` is a
      // +x velocity, and arcing a `walk left` would send the robot along an axis
      // nobody asked for.
      //
      // KNOWN LIMIT, stated rather than papered over: the correction after the
      // LAST segment has no budget left by construction — the segments have
      // spent the whole commanded distance — so it is always an in-place turn,
      // and on this checkpoint an in-place LEFT one does nothing. The walk then
      // ends up to one segment's drift off its line and SAYS SO (`headingNote`
      // prints "HEADING OFF"). Buying that correction an arc would mean either
      // walking further than commanded or holding metres back from the walk,
      // and both are worse lies than the residual. The heading that matters is
      // re-established at the top of the next navigator stage, which has its
      // own arc budget.
      const errorDeg = normalizeDeg(fix.yaw * RAD_TO_DEG - startYawDeg);
      if (Math.abs(errorDeg) > WALK_HEADING_TOLERANCE_DEG) {
        corrections++;
        const arc = direction === 'forward' ? this.arcFor(budgetM) : undefined;
        const { result: turnResult, arc: arcTravel } = await this.turnMeasured(-errorDeg, {
          allowMirror: false,
          ...(arc ? { arc } : {}),
        });
        // Booked BEFORE the failure check: a command that went out and then
        // failed still moved the robot, and a walk that dropped those metres
        // would under-report its own travel.
        if (arc) {
          arcCorrections++;
          arcMovedM += arcTravel.movedM;
          movedM += arcTravel.movedM;
          commandedM += arcTravel.commandedM;
          commandedS += arcTravel.durationS;
          budgetM = Math.max(0, budgetM - arcTravel.commandedM);
        }
        if (!turnResult.ok) {
          stopNote =
            ` Stopped after ${walkedSegments} of ${segmentCount} segments — the heading correction ` +
            `failed: ${locoError(turnResult)}.`;
          break;
        }
        const afterTurn = await this.loco.odometry();
        if (!afterTurn) {
          lostFixAfter = walkedSegments;
          break;
        }
        // From the post-correction pose, so the in-place turn's own wobble is
        // not counted as distance walked.
        fix = afterTurn;
      }
    }

    // Report what the robot ACHIEVED, not what it was told to do. The two differ
    // whenever the robot is slowed, blocked or the command expires early, and a
    // block that claims "walked 2.00 m" after moving 1.71 m makes the planner
    // re-plan from a pose that does not exist.
    if (measuredSegments === 0) {
      // The pose was there before the first command and gone after it, so
      // nothing about this walk was measured. Report the COMMAND, and do not
      // let the zero-motion rule below read an absent measurement as a zero.
      return {
        ok: true,
        message:
          `Commanded ${commandedM.toFixed(2)} m ${direction} ` +
          `(${commandedS.toFixed(1)} s at ${config.agentMode.walkSpeedMps} m/s). ` +
          `No odometry available — distance travelled and heading held are unverified.${clampNote}`,
      };
    }

    // Zero measured motion for a real command is a FAILURE, not a 100% short
    // success: the plan must stop here rather than keep issuing blocks against
    // a pose the robot never reached.
    if (Math.abs(distanceM) > ZERO_MOTION_M && movedM < ZERO_MOTION_M) {
      return {
        ok: false,
        message:
          `walk: the robot did not move (${movedM.toFixed(2)} m measured for a commanded ` +
          `${Math.abs(distanceM).toFixed(2)} m) — ${NO_MOTION_HINT}`,
        measured: { distanceM: movedM },
      };
    }

    const shortfall = distanceM > 0 ? 1 - movedM / distanceM : 0;
    const note =
      shortfall > SHORTFALL_TOLERANCE
        ? ` — ${(shortfall * 100).toFixed(0)}% short of the commanded ${distanceM.toFixed(2)} m` +
          ` (blocked, slowed, or the command expired early)`
        : '';
    const segmentNote = segmentCount > 1 ? ` over ${walkedSegments} of ${segmentCount} segments` : '';
    const lostNote =
      lostFixAfter === null
        ? ''
        : ` Odometry stopped answering after segment ${lostFixAfter} — the rest is unverified.`;
    // An arc moves the robot as well as turning it, so it is not the same event
    // as a turn in place and must not be reported as one. The metres it covered
    // are already inside `movedM`; this says where they came from.
    const arcNote =
      arcCorrections === 0
        ? ''
        : ` ${arcCorrections} of ${corrections} correction${corrections === 1 ? '' : 's'} arced — ` +
          `turned while still walking forward — covering ${arcMovedM.toFixed(2)} m of the walk.`;
    return {
      ok: true,
      message:
        `Walked ${movedM.toFixed(2)} m ${direction} in ${commandedS.toFixed(1)} s${segmentNote}${note}.` +
        `${this.headingNote(startYawDeg, fix.yaw * RAD_TO_DEG, corrections)}${arcNote}${stopNote}${clampNote}${lostNote}`,
      measured: { distanceM: movedM },
    };
  }

  /**
   * The heading the walk ended on against the one it set off on, in one
   * sentence, ALWAYS present.
   *
   * It is stated even when the heading held, because "the robot arrived
   * pointing where it meant to" is the fact the journal was missing: before
   * TASK-227 a walk that curved 60° off course and a walk that ran true
   * produced byte-identical block outcomes, so nothing downstream — planner,
   * operator, or the journal a failed mission is read back from — could tell
   * them apart.
   */
  private headingNote(startYawDeg: number, endYawDeg: number, corrections: number): string {
    const errorDeg = normalizeDeg(endYawDeg - startYawDeg);
    // `toFixed` renders −0.4 as "-0"; the magnitude plus a side word cannot.
    const magnitude = Math.abs(errorDeg).toFixed(0);
    const side = Math.abs(errorDeg) < 0.5 ? '' : errorDeg > 0 ? ' left' : ' right';
    // Same reason: a heading of −0.2° must read as "0°", not "-0°".
    const from = (Math.round(startYawDeg) === 0 ? 0 : startYawDeg).toFixed(0);
    const spent =
      corrections === 0
        ? 'no correction needed'
        : `${corrections} correction${corrections === 1 ? '' : 's'}`;
    return Math.abs(errorDeg) <= WALK_HEADING_TOLERANCE_DEG
      ? ` Heading held: ${magnitude}°${side} of the ${from}° it set off on (${spent}).`
      : ` HEADING OFF by ${magnitude}°${side} of the ${from}° it set off on ` +
          `(${spent}) — this walk did not go where it was aimed.`;
  }

  /**
   * The clearance and the map, re-asked for the next `segmentM` from the pose
   * the robot is standing at NOW.
   *
   * Same two checks, same margins and same fail-open rule as the block-level
   * ones at the top of {@link walk}: a `null` clearance and a `null` map answer
   * are UNKNOWN and shorten nothing, so this can never make the robot more
   * timid than the sensors justify. What it adds is that they are asked again
   * part-way through a long walk instead of once, before it — which is strictly
   * more checking than the single open-loop command it replaces.
   */
  private async checkSegmentAhead(
    segmentM: number
  ): Promise<{ allowedM: number; reason: string | null }> {
    let allowedM = segmentM;
    let reason: string | null = null;

    const clearanceM = this.deps.scene.getForwardClearanceM();
    if (clearanceM !== null) {
      const clearM = Math.max(0, clearanceM - CLEARANCE_MARGIN_M);
      if (clearM < allowedM) {
        allowedM = clearM;
        reason = `the lidar measures ${clearanceM.toFixed(2)} m straight ahead`;
      }
    }

    if (this.deps.checkForwardPath) {
      const check = await this.deps.checkForwardPath(allowedM);
      if (check?.blocker && check.allowedM < allowedM) {
        allowedM = check.allowedM;
        const what =
          check.blocker.kind === 'keepout'
            ? `${check.blocker.label} keepout`
            : check.blocker.label;
        reason = `${what} ahead at ${check.allowedM.toFixed(2)} m on the map`;
      }
    }

    return { allowedM, reason };
  }

  private async turn(block: AgentBlock): Promise<BlockOutcome> {
    const angleDeg = Number(block.params.angleDeg);
    if (!Number.isFinite(angleDeg)) return { ok: false, message: 'turn: angleDeg is not a number' };

    // ── where the boundary between a turn and an arc is drawn ─────────────
    //
    // A `turn` block a planner emitted, or a person asked for, means TURN IN
    // PLACE. Quietly answering it with a curve puts the robot metres from where
    // the asker pictured it — a different error from the one being fixed, and a
    // worse one, because nothing in the outcome would have warned them. So an
    // explicit `turn` stays in place and, when in-place is what this checkpoint
    // cannot do, FAILS AND SAYS WHY (see DEAD_LEFT_HINT below) rather than
    // curving on its own initiative.
    //
    // Automatic CORRECTIONS are the other case, and they arc. A navigator stage
    // alignment is not a destination, it is the first few degrees of a walk that
    // is about to happen anyway; ending it further along the route is what it
    // wanted. Those come in as `arcM` — the metres of the coming stage this
    // alignment may eat into — and the block reports back how many it used so
    // the navigator can take them off the stage.
    //
    // `arcM` is the NAVIGATOR'S private channel and cannot be forged: the
    // planner's zod schema (`PlannedBlockSchema` in planner.ts) is a closed list
    // of fields and `coerceParams` builds `params` from named ones only, so no
    // model output and no operator text can put `arcM` on a block. That is the
    // same mechanism `walk.planned` already relies on.
    const requestedArcM = Number(block.params.arcM);
    // AN ARC IS FORWARD MOTION, SO IT ANSWERS TO THE SAME OBSTACLES A WALK DOES.
    //
    // `walk` clamps to the lidar's forward clearance and runs the segment past
    // the keepouts and the occupancy grid before it moves. This block was doing
    // neither, on the reasoning that a turn does not travel — which stopped
    // being true the moment `arcM` existed. The navigator hands out up to
    // `navMaxSegmentM` of it and only clamps AFTER the turn, so an unchecked arc
    // could drive over a metre along the OLD heading, through a keepout or into
    // a surface the lidar had already measured, inside a block that calls itself
    // a turn.
    //
    // Clamping rather than refusing: an arc is a heading correction that may
    // travel, never one that must. Whatever ground it cannot have, it gives up,
    // and a budget below the navigator's minimum stage turns the block back into
    // the in-place turn it would have been before `arcM`.
    const allowedArcM = await this.arcClearanceM(
      Number.isFinite(requestedArcM) ? Math.max(0, requestedArcM) : 0
    );
    // 'travelled': `arcM` is metres of REAL ground out of the coming stage — see
    // {@link BlockExecutor.arcFor}.
    const arc = this.arcFor(allowedArcM, 'travelled');

    const {
      result,
      turnedDeg,
      mirrored,
      arc: travel,
    } = await this.turnMeasured(angleDeg, arc ? { allowMirror: false, arc } : {});
    // Reported on every path from here, including the failures: the robot
    // covered these metres whatever the rotation did, and the navigator deducts
    // them from the stage it was going to walk next.
    const arcedNote =
      arc === undefined || travel.commandedM <= 0
        ? ''
        : ` Arced ${travel.movedM.toFixed(2)} m forward while turning ` +
          `(${travel.commandedM.toFixed(2)} m commanded) — this base does not rotate CCW in place.`;
    const arcedMeasured = arc === undefined ? {} : { distanceM: travel.movedM };
    if (!result.ok) {
      return {
        ok: false,
        message: `turn failed: ${locoError(result)}${arcedNote}`,
        // Only when there is something to say: an empty `measured` on a block is
        // not "nothing moved", it is a shape the navigator has to read past.
        ...(arc === undefined ? {} : { measured: arcedMeasured }),
      };
    }

    const requestedSide = angleDeg >= 0 ? 'left' : 'right';
    // The side the base ACTUALLY rotated to, which is not always the one asked
    // for: `mirror` satisfies a left turn by going right the long way round, and
    // reporting that as "left" would be the same kind of lie as reporting the
    // commanded angle instead of the measured one.
    const side =
      turnedDeg === null || Math.abs(turnedDeg) < ZERO_MOTION_DEG
        ? requestedSide
        : turnedDeg > 0
          ? 'left'
          : 'right';
    if (turnedDeg === null) {
      return {
        ok: true,
        message:
          `Commanded ${normalizeDeg(angleDeg).toFixed(0)}° ${side}; heading now ` +
          `${Math.round(this.deps.scene.getYawDeg())}° by dead reckoning (no odometry).${arcedNote}`,
        ...(arc === undefined ? {} : { measured: arcedMeasured }),
      };
    }
    // Same reasoning as walk(): report the measured rotation, so a turn the
    // robot could not complete does not silently corrupt every later bearing.
    // Same rule as walk(): a commanded rotation that measurably did not happen
    // is a failed block, not a turn that fell short.
    if (didNotTurn(angleDeg, turnedDeg)) {
      // The one failure on this rig whose cause is neither a damped base nor an
      // obstacle gets named, loudly, instead of being filed under "nothing
      // moved": an in-place LEFT command that this locomotion checkpoint
      // accepts and ignores. Only for a left command that was actually taken in
      // place — an arc that measured nothing, or a right turn, really is the
      // damped-or-blocked case NO_MOTION_HINT describes.
      const deadLeft = arc === undefined && !mirrored && normalizeDeg(angleDeg) > 0;
      return {
        ok: false,
        message:
          `turn: the robot did not turn (${turnedDeg.toFixed(0)}° measured for a commanded ` +
          `${normalizeDeg(angleDeg).toFixed(0)}°) — ${deadLeft ? DEAD_LEFT_HINT : NO_MOTION_HINT}${arcedNote}`,
        measured: { angleDeg: turnedDeg, ...arcedMeasured },
      };
    }

    // Measured as the HEADING STILL TO GO, not as a fraction of the rotation
    // performed. For an ordinary turn the two are the same number — 30° of a
    // commanded 90° is 67% either way — but a mirrored turn rotates 270° for a
    // 90° request, and `1 − 270/90` would report a turn that stopped 11° short
    // as a 200% overshoot. What the planner needs to know is where the robot is
    // pointing, and that is the residual.
    //
    // Against the NORMALIZED angle, too, which is the rotation that was actually
    // asked for: `turnToCommand` takes the shorter way round, so a commanded
    // 270° is a −90° turn and measuring 90° of it is not a 67% shortfall.
    const target = normalizeDeg(angleDeg);
    const residualDeg = normalizeDeg(target - turnedDeg);
    // An OVERSHOOT is not a shortfall, and printing it as one was a lie the
    // planner acted on: a base that rotated 150° for a commanded 30° reported
    // "400% short of the commanded -30°", which reads as "it barely moved" and
    // invites the planner to command the same turn again. The residual is the
    // heading still to go; when its sign is opposite the target's, the robot went
    // PAST the target and the number is how far past.
    //
    // Nothing inside {@link TURN_TOLERANCE_DEG} is reported either way. That is
    // the loop's own definition of "landed" — it stops correcting there — and
    // {@link smallestCommandableDeg} is larger still, so a `turn +6` that
    // quantises to 9° of rotation is the shortest command this robot HAS, not a
    // "50% short" turn, and a `turn +1` is not "800% short".
    const overshot = Math.abs(residualDeg) > TURN_TOLERANCE_DEG && Math.sign(residualDeg) !== Math.sign(target);
    const shortfall = Math.abs(target) > 0 ? Math.abs(residualDeg) / Math.abs(target) : 0;
    let note = '';
    if (overshot) {
      note = ` — ${Math.abs(residualDeg).toFixed(0)}° PAST the commanded ${target.toFixed(0)}° (an overshoot, not a shortfall)`;
    } else if (Math.abs(residualDeg) > TURN_TOLERANCE_DEG && shortfall > SHORTFALL_TOLERANCE) {
      note = ` — ${(shortfall * 100).toFixed(0)}% short of the commanded ${target.toFixed(0)}°`;
    }
    // A mirrored turn ends on the requested heading by the long way round, so it
    // is a success — but the operator asked for 90° left and the robot spun 270°
    // right, and a message that did not say so would be a surprise, not a report.
    const mirrorNote = mirrored
      ? ` (a ${target.toFixed(0)}° ${requestedSide} turn taken the long way round — this base does not rotate ${requestedSide} in place)`
      : '';
    return {
      ok: true,
      message: `Turned ${turnedDeg.toFixed(0)}° (${side})${mirrorNote}; heading now ${Math.round(this.deps.scene.getYawDeg())}°${note}.${arcedNote}`,
      measured: { angleDeg: turnedDeg, ...arcedMeasured },
    };
  }

  /**
   * One measured rotation: issue it, CORRECT it against odometry until it
   * lands, keep the heading estimate current, and report how far the base
   * actually turned in total.
   *
   * EVERY rotation in Agent Mode goes through here, so the zero-motion rule has
   * exactly one place to live. It used to live inside `turn()` alone while
   * `scan_room` — which rotates `steps` times — called `driveFor` directly and
   * believed the sidecar's ACK. Observed live on a damped G1 in FSM 1: a
   * `scan_room` reported "Scanned the room in 8 steps; found: door, bed." while
   * sim odometry showed 0.00° of rotation across the entire block. Eight
   * identical frames of one heading were presented to the operator as a 360°
   * sweep, and the objects in front of the robot as the contents of the room.
   *
   * ## Why this is a loop and not one command (TASK-203)
   *
   * `turnToCommand` is open-loop on TIME: it holds a constant omega for
   * `|angle| / rate` seconds and calls it done. That is only a turn if the base
   * actually achieves the commanded yaw rate, and the G1 checkpoint measurably
   * does not — turning in place it reaches 0.26–0.53 of what it is told (right)
   * and 0.01 (left). Every Agent Mode turn was therefore under-rotating by two
   * to four times, in BOTH directions, while the shortfall report below said so
   * and nothing acted on it. The correction loop is what acts on it.
   *
   * The loop is skipped entirely when there is no odometry: a robot that cannot
   * measure its heading has nothing to correct against, and inventing an
   * iteration count would be dead reckoning dressed up as feedback. That path is
   * byte-for-byte the old one — a single open-loop command — and `turnedDeg` is
   * `null`, which is NOT "did not move" (see {@link didNotTurn}).
   *
   * `turnedDeg` is the TOTAL rotation over every iteration, accumulated as a sum
   * of per-iteration deltas and deliberately NOT normalized: a mirrored left 90°
   * really is −270° of rotation, and folding that to +90° would report a number
   * the base never turned. It is what was MEASURED and nothing else — a command
   * whose outcome odometry never reported is dead-reckoned into the scene
   * heading (below) but never into this number, which `didNotTurn` and the
   * compliance record both read as measurement.
   *
   * ## Why the first command of every turn is open-loop (TASK-203 follow-up)
   *
   * Gain compensation multiplies whatever is left by 1/gain, and a gain that is
   * stale by even one block is then a multiplier on a rotation the robot
   * performs for real. Latched at its {@link MIN_TURN_GAIN} floor of 0.05 it
   * turned ANY remainder of 7.5° or more into the full {@link MAX_TURN_STEP_DEG}
   * — a 30° request executed as a 150° spin on a plant whose tracking had since
   * recovered. So the first command in each direction of each turn is issued at
   * gain 1, exactly the rotation that remains, and compensation applies only
   * from the SECOND command in that direction, where the ratio it divides by was
   * measured in this very turn. A latched estimate still earns its keep — it is
   * the filter's memory, so the second command of a poorly-tracking base is
   * already compensated properly instead of rediscovering 0.1 from scratch — it
   * simply may not size a command on its own authority.
   */
  private async turnMeasured(
    angleDeg: number,
    options: { allowMirror?: boolean; arc?: ArcOption } = {}
  ): Promise<{
    result: LocoResult;
    turnedDeg: number | null;
    mirrored: boolean;
    arc: ArcTravel;
  }> {
    const target = normalizeDeg(angleDeg);
    // An arc with no forward speed is an in-place turn wearing a hat — and, on
    // this checkpoint, a dead one. Treated as "no arc" so the caller's own
    // fallback and reporting run, rather than issuing a command that cannot move.
    const arc = options.arc && options.arc.forwardMps > 1e-6 ? options.arc : undefined;
    /** Accumulated cost/coverage of the arc, reported to the caller. */
    const travel: ArcTravel = { ...NO_ARC_TRAVEL };
    /** The profile this turn's commands are issued under. */
    const profile = turnProfileFor(arc ? arc.forwardMps : 0);
    /**
     * Commanded arc metres that buy a rotation the odometry can actually READ:
     * {@link ZERO_MOTION_DEG} and half again, so a base turning somewhat worse
     * than its configured rate still clears the floor. Below this a command is
     * not a small correction — it is a sample the loop scores as "this base did
     * not move", and an arc whose first command is one of those ends there.
     */
    const measurableArcM = arc
      ? (arc.forwardMps * 1.5 * ZERO_MOTION_DEG) / achievedDpsFor(profile, target)
      : 0;
    /**
     * Seconds of arc the UNSPENT budget can still fund.
     *
     * The budget is a DISTANCE, and a distance is metres = m/s × seconds — so
     * seconds is what it actually bounds. It used to be converted into a
     * ceiling on the commanded ANGLE instead (metres ÷ m/s × °/s), which was
     * arithmetically the same thing only while the commanded omega and the
     * achieved rate were the same number. They are not: see {@link TurnProfile}.
     * Converting through the nominal rate would now bound neither the distance
     * nor the angle correctly, and — worse — it silently truncated the ROTATION
     * the closed loop had just sized, which is what made gain compensation inert
     * (it computed `remainingDeg / gain` and then clamped it straight back to
     * `AGENT_TURN_SPEED_DPS / AGENT_WALK_SPEED_MPS` = 90°/m of budget).
     *
     * The command is therefore built at full commanded omega and only its HOLD
     * is cut to what the budget affords; the angle it can honestly claim to have
     * asked for is recomputed from that hold, so the gain estimator downstream
     * still divides the measured rotation by the rotation actually requested.
     */
    const arcBudgetS = (): number => {
      if (!arc) return Infinity;
      let remainingM = arc.budgetM - travel.commandedM;
      if (arc.travelBudgetM !== undefined) {
        // The commanded budget was derived from a CONFIGURED gain, which is a
        // prior about the base and not a measurement of this arc. A base tuned
        // to walk better than that prior spends the whole commanded budget and
        // covers up to `1 / AGENT_ARC_TRAVEL_GAIN` times the real ground it was
        // promised — 3.2x at the documented 0.31 — which drives it clean past
        // the stage the alignment was for. So the arc re-derives the ratio from
        // what it has just measured and bounds the hold by the real metres it
        // has left.
        const measuredGain =
          travel.commandedM > 1e-6 && travel.movedM > 0 ? travel.movedM / travel.commandedM : null;
        // Nothing measured yet, so the only ratio the arc may assume is the one
        // no base beats: it does not travel further than it is told. The one
        // exception is a probe too short to measure — it would re-derive
        // nothing and be read as a dead base — and there the prior stands for
        // one command, which is why a budget under `measurableArcM` can still
        // overrun by up to that much. Never beyond the prior's own budget.
        remainingM = Math.min(
          remainingM,
          measuredGain === null
            ? Math.max(arc.travelBudgetM, measurableArcM)
            : (arc.travelBudgetM - travel.movedM) / measuredGain
        );
      }
      return remainingM / arc.forwardMps;
    };

    const before = await this.loco.odometry();

    // ── no odometry: exactly the old open-loop behaviour ──────────────────
    if (!before) {
      // The arc still applies here: the reason a left turn is dead is the
      // locomotion policy, not the odometry, so a blind robot that cannot see
      // its heading is no more able to rotate CCW in place than a sighted one.
      // Budget-clamped exactly as in the loop; an unfundable arc falls back to
      // the in-place command, which then reports honestly.
      const canArc = arc !== undefined && arcBudgetS() >= MIN_DURATION_S;
      const cmd = canArc
        ? turnToCommandExact(target, undefined, arc.forwardMps)
        : turnToCommand(target);
      let blindDeg = target;
      if (canArc) {
        const budgetS = arcBudgetS();
        if (cmd.durationS > budgetS) {
          cmd.durationS = budgetS;
          blindDeg = Math.sign(target) * achievedDpsFor(profile, target) * budgetS;
        }
      }
      const result = await this.driveFor(cmd);
      if (canArc) {
        travel.commandedM += cmd.vx * cmd.durationS;
        travel.durationS += cmd.durationS;
      }
      if (!result.ok) return { result, turnedDeg: null, mirrored: false, arc: travel };
      // `target` is what was COMMANDED here, not merely what was wanted: the one
      // command that went out asked for exactly it. Dead reckoning it is the
      // best this path can do and it is honest about being dead reckoning.
      this.deps.scene.advanceYawDeg(canArc ? blindDeg : target);
      await this.refreshYaw();
      return { result, turnedDeg: null, mirrored: false, arc: travel };
    }

    // ── closed loop ───────────────────────────────────────────────────────
    // An arc is never mirrored. Mirroring satisfies a left θ by rotating right
    // θ−360, and doing that at walking speed does not turn the robot on the
    // spot — it drives it three quarters of the way round a circle, metres from
    // where the caller budgeted for it to be. The arc IS the answer to the dead
    // left turn that mirroring exists for, so the two never both apply.
    const allowMirror = options.allowMirror !== false && arc === undefined;
    const deadline = this.now() + TURN_BUDGET_MS;
    let previousYawDeg = before.yaw * RAD_TO_DEG;
    /** Last fix's position, so an arc's translation can be measured per command. */
    let previousX = before.x;
    let previousY = before.y;
    let turnedDeg = 0;
    /**
     * Rotation this turn ISSUED and never got a measurement back for, estimated
     * at the tracking ratio measured in this turn. Non-zero only when odometry
     * disappeared with a command already executed; see the dead-reckoning note
     * where the scene heading is advanced.
     */
    let unmeasuredDeg = 0;
    let mirroring =
      allowMirror &&
      (this.leftTurnStrategy === 'mirror' ||
        (this.leftTurnStrategy === 'auto' && this.mirrorLeftTurns));
    /** Whether this turn is being taken the long way round. */
    let mirrored = false;
    /**
     * Rotation still to perform, SIGNED, in the direction this turn committed
     * to. Tracked as its own running number rather than recomputed as
     * `normalizeDeg(target - turnedDeg)` each iteration, because a mirrored turn
     * deliberately goes the long way: half way through a −270° plan the shortest
     * path back to the target points the other way, and a loop steering by that
     * would turn around in the middle of the rotation it is performing.
     */
    let remainingDeg = target;
    if (mirroring && remainingDeg > 0) {
      if (remainingDeg >= MIN_MIRROR_DEG) {
        remainingDeg -= 360;
        mirrored = true;
      } else {
        // Too small to be worth 360 − θ of extra rotation; see MIN_MIRROR_DEG.
        // The left command goes out directly, and if this base really cannot
        // turn left the block says "the robot did not turn" — which is a 6°
        // heading error rather than a 354° spin.
        mirroring = false;
      }
    }
    /** The direction of the plan. Every command and every stop rule follows it. */
    let planSign = Math.sign(remainingDeg) || 1;
    let result: LocoResult = { ok: true };
    /**
     * The tracking ratio measured IN THIS TURN, per direction, or null where
     * this turn has not commanded that direction yet. Two different jobs:
     * `turnGain` (safety-biased, see the update below) sizes the next command,
     * and this decides whether there is any in-turn measurement to size it from
     * at all — while the raw ratio itself is the honest estimator for a command
     * odometry never came back to confirm.
     */
    const observedHere: { left: number | null; right: number | null } = { left: null, right: null };
    /** Direction reversals spent correcting an overshoot; see MAX_TURN_REVERSALS. */
    let reversals = 0;
    /** Consecutive dead LEFT commands in this turn; see DEAD_LEFT_PROBES. */
    let deadLeftProbes = 0;

    for (let iteration = 0; iteration < MAX_TURN_ITERATIONS; iteration++) {
      // Every one of these stopping rules is for CORRECTIONS only — the first
      // command always goes out, so a rotation smaller than the tolerance is
      // still a rotation the robot performs, exactly as before this loop existed.
      if (iteration > 0) {
        if (Math.abs(remainingDeg) <= TURN_TOLERANCE_DEG) break;
        // The target has been reached or PASSED. An overshoot used to end the
        // turn here, which made it permanent — the block then reported ok:true
        // with the robot pointing somewhere nobody asked for. Turn back instead,
        // while two conditions hold: the error is bigger than the smallest
        // command that exists (below that a correction can only bounce, which is
        // the oscillation this break was written to avoid), and the turn has not
        // already reversed {@link MAX_TURN_REVERSALS} times.
        if (Math.sign(remainingDeg) !== planSign) {
          if (
            reversals >= MAX_TURN_REVERSALS ||
            Math.abs(remainingDeg) <= smallestCommandableDeg(remainingDeg, arc ? arc.forwardMps : 0)
          ) {
            break;
          }
          reversals += 1;
          planSign = Math.sign(remainingDeg);
        }
        if (this.now() >= deadline) break;
      }

      const side: 'left' | 'right' = planSign > 0 ? 'left' : 'right';
      // Ask for the rotation the base will actually PERFORM, not the one that is
      // left — but only once THIS turn has measured what this base does in this
      // direction. Until then the gain is 1 and the command is exactly the
      // remainder, which is the open-loop command and cannot overshoot a plant
      // that tracks at 1.0 or less. See the method docstring for why a latched
      // estimate is not allowed to size a command on its own.
      const gain = observedHere[side] === null ? 1 : this.turnGain[side];
      let commandDeg = Math.max(
        -MAX_TURN_STEP_DEG,
        Math.min(MAX_TURN_STEP_DEG, remainingDeg / gain)
      );
      if (arc && arcBudgetS() < MIN_DURATION_S) break; // budget spent — stop, do not fake it
      const cmd = arc
        ? turnToCommandExact(commandDeg, undefined, arc.forwardMps)
        : turnToCommandExact(commandDeg);
      if (arc) {
        // The arc spends the CALLER'S distance, so the budget bounds how long
        // this command may be HELD — the one thing that actually consumes
        // metres. The commanded omega is untouched: cutting it would take the
        // command back under the deadband and buy nothing at all.
        //
        // Note the gain compensation above has already multiplied the remainder
        // (a 10° correction at a measured gain of 0.1 is a 100° command), which
        // is why this is applied after it. What changed is that a truncated
        // command no longer pretends it asked for the full angle: `commandDeg`
        // is rewritten to the rotation the shortened hold can actually request,
        // so the tracking-ratio update below stays honest.
        const budgetS = arcBudgetS();
        if (cmd.durationS > budgetS) {
          cmd.durationS = budgetS;
          commandDeg = Math.sign(commandDeg) * achievedDpsFor(profile, commandDeg) * budgetS;
        }
      }
      result = await this.driveFor(cmd);
      if (arc) {
        travel.commandedM += cmd.vx * cmd.durationS;
        travel.durationS += cmd.durationS;
      }
      if (!result.ok) break;

      const after = await this.loco.odometry();
      // Odometry that goes away mid-turn is not a measurement of zero: stop
      // correcting and report what was measured up to the last good fix. The
      // command that has just been executed is the one thing no fix will ever
      // cover, so estimate it — at the ratio this turn measured in this
      // direction, or at the command itself when it measured none (which is the
      // case at iteration 0, where the command IS the rotation asked for).
      if (!after) {
        unmeasuredDeg = commandDeg * (observedHere[side] ?? 1);
        if (iteration === 0) {
          this.deps.scene.advanceYawDeg(unmeasuredDeg);
          await this.refreshYaw();
          return { result, turnedDeg: null, mirrored, arc: travel };
        }
        break;
      }

      // An arc TRANSLATES as well as rotating, and the caller has to be told how
      // far: it budgeted the metres, and whatever consumes the result (the
      // walk's own residual, the navigator's next stage) would otherwise assume
      // the robot stayed put. This is a base that achieves a fraction of a
      // commanded forward speed, so the two numbers differ — but only as far as
      // the odometry behind `after` is itself measured rather than dead reckoned
      // from the command. See {@link ArcTravel} and TASK-231.
      if (arc) travel.movedM += Math.hypot(after.x - previousX, after.y - previousY);
      previousX = after.x;
      previousY = after.y;

      const afterYawDeg = after.yaw * RAD_TO_DEG;
      // Per-iteration delta, SUMMED. Differencing only the first and last sample
      // would report a 270° turn as −90°; per-iteration it is unambiguous,
      // because no single command exceeds {@link MAX_TURN_STEP_DEG}.
      const deltaDeg = normalizeDeg(afterYawDeg - previousYawDeg);
      previousYawDeg = afterYawDeg;
      turnedDeg += deltaDeg;
      remainingDeg -= deltaDeg;

      // Update the tracking estimate from what this command actually bought.
      // Two things are deliberately NOT evidence of a tracking ratio:
      //   * a delta with the wrong sign — drift or a stumble, and folding it in
      //     would drive the estimate down and the next command to its cap;
      //   * a delta below ZERO_MOTION_DEG — that is a direction this base does
      //     not turn AT ALL, which the mirror strategy below exists to handle.
      //     Reading the dead left probe as "tracks at 0.01" would poison the
      //     estimate for the mirrored RIGHT commands that follow it, and they
      //     would then over-command and sail past the target.
      if (
        Math.sign(deltaDeg) === Math.sign(commandDeg) &&
        Math.abs(deltaDeg) >= ZERO_MOTION_DEG
      ) {
        const observed = Math.abs(deltaDeg) / Math.abs(commandDeg);
        // Asymmetric on purpose: the filter is for a plant that got WORSE, and
        // an estimate that lags there merely costs an extra correction. A plant
        // that got BETTER is the dangerous direction — the estimate is then a
        // multiplier on a rotation that really happens — so good news is
        // believed in full, immediately, and one honest command is enough to
        // undo an estimate the last block left too low.
        const filtered =
          (1 - TURN_GAIN_ALPHA) * this.turnGain[side] + TURN_GAIN_ALPHA * observed;
        this.turnGain[side] = Math.min(1, Math.max(MIN_TURN_GAIN, Math.max(observed, filtered)));
        observedHere[side] = observed;
        if (side === 'left') {
          // A left command that measurably rotated the base is proof the
          // asymmetry this latch encodes is not (or is no longer) true here.
          // Released immediately, and the confirmations start again from zero:
          // the latch exists to skip a dead command, never to keep a working
          // direction switched off until the process restarts.
          this.deadLeftTurns = 0;
          this.mirrorLeftTurns = false;
        }
      }

      if (Math.abs(deltaDeg) >= ZERO_MOTION_DEG) continue; // it moved — correct it again

      // It did not. Re-issuing the identical command would only burn the
      // budget, so either change strategy or stop and let the caller report a
      // rotation that measurably did not happen.
      //
      // `reversals === 0` keeps this out of the correction phase: a dead left
      // command while turning BACK from an overshoot is a 5° tidy-up going
      // missing, and answering it with three quarters of a revolution would be
      // a far larger error than the one being corrected.
      if (
        allowMirror &&
        !mirroring &&
        this.leftTurnStrategy === 'auto' &&
        commandDeg > 0 &&
        reversals === 0
      ) {
        deadLeftProbes += 1;
        if (deadLeftProbes < DEAD_LEFT_PROBES) {
          // One dead sample is not a dead direction — it is also exactly what a
          // one-second odometry hiccup looks like. Send the same command again
          // and let the second measurement decide; see DEAD_LEFT_PROBES.
          console.warn(
            `[AgentMode] left turn of ${commandDeg.toFixed(0)}° measured ${deltaDeg.toFixed(1)}° — ` +
              `re-issuing it once before believing this base cannot rotate CCW ` +
              `(a stale odometry fix looks identical to a dead turn).`
          );
          continue;
        }
        if (Math.abs(remainingDeg) < MIN_MIRROR_DEG) {
          // Confirmed dead, and still not worth the long way round: see
          // MIN_MIRROR_DEG. The caller reports a turn that did not happen.
          console.warn(
            `[AgentMode] left turn of ${commandDeg.toFixed(0)}° measured ${deltaDeg.toFixed(1)}° ` +
              `twice, but ${Math.abs(remainingDeg).toFixed(0)}° is too small to be worth ` +
              `${(360 - Math.abs(remainingDeg)).toFixed(0)}° the other way round. Reporting the ` +
              `turn as not performed instead of spinning the robot most of a circle.`
          );
          break;
        }
        mirroring = true;
        mirrored = true;
        this.deadLeftTurns += 1;
        if (this.deadLeftTurns >= DEAD_LEFT_TURNS_TO_LATCH) {
          // Process-wide, deliberately: the asymmetry is a property of the
          // checkpoint, not of this block, so every later left turn skips the
          // dead command instead of paying for the same discovery again. Only
          // after DEAD_LEFT_TURNS_TO_LATCH separate turns have confirmed it,
          // though — a latch this long-lived is not something one bad second of
          // odometry gets to set.
          this.mirrorLeftTurns = true;
        }
        // What is LEFT of the turn now goes the other way round the circle.
        remainingDeg -= 360;
        planSign = -1;
        console.warn(
          `[AgentMode] left turn of ${commandDeg.toFixed(0)}° measured ${deltaDeg.toFixed(1)}° on ` +
            `${DEAD_LEFT_PROBES} consecutive commands — this base does not rotate CCW in place. ` +
            `Switching to the mirror strategy (left θ executed as right θ−360) for this turn` +
            `${this.mirrorLeftTurns ? ' and every later one' : ''}. ` +
            `Set AGENT_LEFT_TURN_STRATEGY=direct to keep commanding it anyway.`
        );
        continue;
      }
      break;
    }

    // The scene heading advances by what the base is believed to have ROTATED —
    // never by what it was asked for. `refreshYaw` overwrites this with the
    // measured heading whenever there is still a fix, so it only decides
    // anything on the path where odometry is the thing that went away, and that
    // is precisely where advancing by `target` was worst: a mirrored turn plans
    // −270°, issues a clamped −150°, and used to advance the map by +90° — a
    // heading error of up to 240° reported as ok:true.
    this.deps.scene.advanceYawDeg(turnedDeg + unmeasuredDeg);
    await this.refreshYaw();
    return { result, turnedDeg, mirrored, arc: travel };
  }

  /**
   * The {@link ArcOption} for a heading correction that may be taken while
   * walking forward, or `undefined` when this correction has to be an in-place
   * turn after all.
   *
   * One gate: an arc must be able to fund at least one {@link MIN_DURATION_S}
   * command out of the distance budget it was given. Below that there is no arc
   * to issue — a shorter command does not exist — and pretending otherwise would
   * either overshoot the caller's distance or send a zero-length command.
   *
   * `budgetIn` is the CURRENCY of `budgetM`, and the two callers genuinely
   * differ:
   *
   *   - `'commanded'` — the `walk` loop. Its segments are commanded metres and
   *     its budget is `Math.abs(distanceM)`, so an arc that spends commanded
   *     metres is exactly what keeps "walk 3 m" at 3 m commanded.
   *   - `'travelled'` — the navigator's stage alignment. `arcM` is carved out of
   *     `stageM`, a MEASURED distance to the target, and the navigator then
   *     subtracts the arc's MEASURED displacement from it. That budget is real
   *     ground, and charging it in commanded metres over-charges every arc by
   *     `1 / AGENT_ARC_TRAVEL_GAIN` — 3.2× on a base that covers 31% of what it
   *     commands, which is why a 0.70 m alignment budget bought almost no turn.
   *
   * The conversion is the identity at the default gain of 1, so nothing about
   * the untuned behaviour changes. The gain only ever OPENS the budget, and
   * only as far as the arc's own odometry agrees: a travelled budget is carried
   * on the {@link ArcOption} as well, and `arcBudgetS` holds the measured
   * metres to it, so a base tuned better than its configured gain cannot arc
   * past the stage it is aligning for.
   */
  /**
   * How many of an arc's requested metres the robot is actually allowed to
   * travel — the two checks {@link BlockExecutor.walk} runs, applied to the
   * forward motion an arcing turn performs.
   *
   * Returns 0 when there is not enough room to be worth it, which
   * {@link BlockExecutor.arcFor} turns into `undefined` and the caller into a
   * plain in-place turn. Absent lidar or map → the check contributes nothing,
   * exactly as it does for a walk.
   */
  private async arcClearanceM(requestedM: number): Promise<number> {
    if (!(requestedM > 0)) return 0;
    let allowedM = requestedM;

    const clearanceM = this.deps.scene.getForwardClearanceM();
    if (clearanceM !== null) {
      allowedM = Math.min(allowedM, Math.max(0, clearanceM - CLEARANCE_MARGIN_M));
    }

    if (this.deps.checkForwardPath && allowedM > 0) {
      const check = await this.deps.checkForwardPath(allowedM);
      if (check?.blocker && check.allowedM < allowedM) allowedM = Math.max(0, check.allowedM);
    }

    // NOTHING IN THE WAY → the request passes through untouched. The floor
    // below is about obstacles, not about budget size: a caller that asks for a
    // deliberately tiny arc still gets it, and `arcFor` applies the only
    // minimum that is really structural (one MIN_DURATION_S command).
    if (allowedM >= requestedM) return requestedM;

    // Clamped. Below one navigator stage there is nothing useful left to spend,
    // and arcing a hand's width is worse than not arcing: it costs the same
    // minimum command and reports travel the navigator then deducts from the
    // stage. Give the metres up and turn in place.
    return allowedM < MIN_STAGE_M ? 0 : allowedM;
  }

  private arcFor(
    budgetM: number,
    budgetIn: 'commanded' | 'travelled' = 'commanded'
  ): ArcOption | undefined {
    if (!Number.isFinite(budgetM) || budgetM <= 0) return undefined;
    // The SAME velocity a `walk` would put on the wire — see
    // {@link commandedForwardMps} for why resolving it separately here was a
    // defect waiting on the first tuned rig.
    const forwardMps = commandedForwardMps(config.agentMode.walkSpeedMps);
    const gain = config.agentMode.arcTravelGain;
    const travelGain =
      budgetIn === 'travelled' && Number.isFinite(gain) && gain > 1e-6 && gain <= 1 ? gain : 1;
    const commandedBudgetM = budgetM / travelGain;
    // Gated on the budget AS THE CALLER DENOMINATED IT, never on the
    // gain-expanded one: the arc is held to its real metres by measurement (see
    // `arcBudgetS`), so what has to fit inside the ground the caller actually
    // promised is the shortest command that exists. Gating on the expanded
    // number admits budgets whose very first command overruns them.
    if (budgetM < forwardMps * MIN_DURATION_S) return undefined;
    return {
      forwardMps,
      budgetM: commandedBudgetM,
      ...(budgetIn === 'travelled' ? { travelBudgetM: budgetM } : {}),
    };
  }

  /**
   * Issue the velocity command and then wait out whatever part of the motion
   * the sidecar did not already block for. Correct whether `/loco/move` returns
   * immediately (SetVelocity is fire-and-forget) or blocks for the duration.
   */
  private async driveFor(cmd: WalkCommand): Promise<LocoResult> {
    const startedAt = this.now();
    const result = await this.loco.move(cmd.vx, cmd.vy, cmd.omega, cmd.durationS);
    // Every base motion in Agent Mode funnels through here, which makes this the
    // one place a cached point cloud is provably stale: it was taken at a pose
    // the robot has just left. Ranging the NEXT look's bearings against it would
    // aim each cone at whatever used to be in that direction. Unconditional
    // (even on a failed command) because a `move` that reports an error may
    // still have moved the robot before failing.
    this.range.invalidateAfterMotion();
    // And for the same reason, one level up: the DISTANCES in scene memory were
    // measured from the pose the robot is leaving. The commanded displacement is
    // what is known here — see SceneMemoryStore.noteTranslationM for why the
    // commanded number is the right one to hand over. A pure turn contributes
    // zero, which is correct: rotation is the yaw rule's business.
    //
    // Still needed now that `refreshYaw` feeds measured odometry in as well,
    // and not redundant with it: `walk` never calls `refreshYaw`, so between
    // two looks the commanded number is the only thing the store hears, and it
    // is the larger of the two whenever the base falls short of what it was
    // told. The store takes the larger and never the sum, so this cannot be
    // counted twice — see SceneMemoryStore.noteOdometryM.
    this.deps.scene.noteTranslationM(Math.hypot(cmd.vx, cmd.vy) * cmd.durationS);
    if (!result.ok) return result;
    const remainingMs = cmd.durationS * 1000 - (this.now() - startedAt);
    if (remainingMs > 0) await this.sleep(remainingMs);
    return result;
  }

  // ── perception ────────────────────────────────────────────────────────────

  private async look(block: AgentBlock): Promise<BlockOutcome> {
    const observation = await this.observeAndMerge();
    const labels = observation.entities.map((e) => e.label);
    const seen =
      labels.length > 0
        ? `Looked: ${observation.currentView} (entities: ${labels.join(', ')})`
        : `Looked: ${observation.currentView}`;
    if (block.params.speak !== true) return { ok: true, message: seen };
    // `speak: true` — the operator asked what the robot sees, so the
    // observation IS the answer. A degraded observation (VLM down) is still
    // spoken honestly: it says the model was unavailable, not something made up.
    const text = observation.currentView.trim();
    const spoken = text ? await this.say(text, this.language()) : false;
    return {
      ok: true,
      message: `${seen} — said${spoken ? '' : ' (text-only, voice service unreachable)'}: "${text}"`,
    };
  }

  private async scanRoom(block: AgentBlock): Promise<BlockOutcome> {
    const stepsRaw = Number(block.params.steps);
    const steps = Number.isFinite(stepsRaw) ? Math.round(Math.min(12, Math.max(4, stepsRaw))) : 8;
    /**
     * NEGATIVE: the sweep runs CLOCKWISE (TASK-203).
     *
     * A 360° sweep covers the same room whichever way it is walked round, so the
     * direction is free — and it is not free on the robot. The G1 locomotion
     * checkpoint achieves 0.01 of a commanded in-place LEFT yaw rate and
     * 0.26–0.53 of a RIGHT one, so a CCW sweep is `steps` dead turns: eight
     * copies of one frame presented as the contents of the room. Spending the
     * free choice on the direction that works costs nothing and fixes the block.
     *
     * The mirror strategy is deliberately NOT used here (`allowMirror: false`):
     * a left sweep mirrored is eight turns of 315°, which is nearly seven full
     * revolutions to look at one room.
     */
    const stepDeg = -360 / steps;
    /** The magnitude, for the operator-facing text — nobody reads "-45°". */
    const stepMagnitudeDeg = Math.round(Math.abs(stepDeg));

    const found = new Set<string>();
    // Look first, then turn — otherwise the starting heading is never observed.
    for (let i = 0; i < steps; i++) {
      const observation = await this.observeAndMerge();
      for (const e of observation.entities) found.add(e.label);

      if (i === steps - 1) break; // a final turn would just repeat step 0
      if (this.deps.isAborted()) {
        return { ok: false, message: `scan_room aborted after ${i + 1} of ${steps} steps` };
      }
      const { result, turnedDeg } = await this.turnMeasured(stepDeg, { allowMirror: false });
      if (!result.ok) {
        return { ok: false, message: `scan_room failed while turning: ${locoError(result)}` };
      }
      // The block as a whole claims a 360° sweep. On a base that does not
      // rotate that claim becomes `steps` copies of one frame, and the summary
      // below would report whatever happens to be in front of the robot as the
      // contents of the room. Fail, and name the one heading that WAS observed.
      if (turnedDeg !== null && didNotTurn(stepDeg, turnedDeg)) {
        return {
          ok: false,
          message:
            `scan_room: the robot did not turn (${turnedDeg.toFixed(0)}° measured for a ` +
            `commanded ${stepMagnitudeDeg}° clockwise) after ${i + 1} of ${steps} looks — only the ` +
            `starting heading was observed, so this is not a 360° scan. ${NO_MOTION_HINT}`,
          measured: { angleDeg: turnedDeg },
        };
      }
    }

    // Close the circle. The loop skips the last turn so the starting heading is
    // not observed twice, which leaves the robot one step (360/steps) short of
    // where it began — measured: 90° in, 44.9° out on an 8-step scan. A block
    // the operator reads as "look around" must not quietly leave the robot
    // facing somewhere else; every later `walk` would inherit the offset. The
    // closing turn continues clockwise for the same reason the sweep does.
    let headingNote = '';
    if (!this.deps.isAborted()) {
      const { result: closing, turnedDeg } = await this.turnMeasured(stepDeg, { allowMirror: false });
      if (!closing.ok) {
        // The scan itself succeeded — say what did not, rather than failing it.
        headingNote = ` Could not turn back to the starting heading (${locoError(closing)}), so the robot is ${stepMagnitudeDeg}° short of it.`;
      } else if (turnedDeg !== null && didNotTurn(stepDeg, turnedDeg)) {
        // Accepted and ignored: same shape as above, but the sidecar said yes.
        headingNote = ` The closing turn measured ${turnedDeg.toFixed(0)}° for a commanded ${stepMagnitudeDeg}° clockwise, so the robot is ${stepMagnitudeDeg}° short of the starting heading.`;
      }
    }

    const summary =
      found.size > 0
        ? `Scanned the room in ${steps} steps (clockwise); found: ${[...found].join(', ')}.`
        : `Scanned the room in ${steps} steps (clockwise); nothing recognisable found.`;
    return { ok: true, message: summary + headingNote };
  }

  /**
   * Take one frame, measure what it saw, merge it into scene memory at the
   * current heading.
   *
   * This is the ONE funnel every perception update passes through — `look` and
   * each step of `scan_room` — which is why the range enrichment lives here and
   * nowhere else. Vision stays vision (`vision.ts` knows nothing about LiDAR),
   * and scene memory stays a store.
   */
  private async observeAndMerge(): Promise<VisionObservation> {
    await this.refreshYaw();
    const observation = await this.deps.vision.observe();

    // ONE cloud per observation, ranged against the bearings that very frame
    // produced. `measure` never throws: no sidecar, a timed-out snapshot or an
    // empty cloud all come back as `ok:false` with every reading null, and the
    // merge below is then exactly what it was before LiDAR existed — the VLM's
    // own distance, now labelled as the guess it is.
    //
    // The bearings handed over are the RELATIVE ones (image centre = straight
    // ahead), because that is the frame the cloud is in: `base_link`, x forward.
    // The world conversion happens afterwards, in `scene.merge`. Adding the yaw
    // here would rotate every cone away from the thing it is aimed at.
    //
    // An entity the VLM could not place is NOT ranged. There is no cone to aim:
    // a missing bearing is not 0, and ranging it as 0 measures whatever the
    // robot happens to be facing and hands that metre back stamped 'lidar' —
    // the strongest provenance this system has, attached to a number about
    // something else entirely.
    const placedBearingsDeg = observation.entities
      .map((e) => e.bearingDeg)
      .filter((bearingDeg): bearingDeg is number => bearingDeg !== undefined);
    const measurement = await this.range.measure(placedBearingsDeg);
    // `readings` carries one entry per REQUESTED bearing, so the cursor walks
    // the placed entities only and the unplaced ones consume nothing.
    let placedIndex = 0;
    const entities: ObservedEntity[] = observation.entities.map((entity) => {
      const reading =
        entity.bearingDeg === undefined ? null : (measurement.readings[placedIndex++] ?? null);
      if (reading) {
        // The measurement REPLACES the model's guess. What it claims is exactly
        // "the nearest surface inside a ±cone around that bearing" — LiDAR
        // returns are unlabelled, so it is not provably the named object. It is
        // still the better number by a wide margin: the VLM's is 0.94 m MAE and
        // usually null, this one is a range measurement.
        return { ...entity, distanceEstM: reading.distanceM, distanceSource: 'lidar' };
      }
      return { ...entity, distanceSource: entity.distanceEstM === null ? null : 'vlm-estimate' };
    });

    const scene = this.deps.scene.merge({ ...observation, entities }, undefined, {
      // null when nothing was measured. Scene memory stores that as UNKNOWN and
      // the navigator refuses to read it as free space.
      forwardClearanceM: measurement.clearanceM,
    });
    this.deps.onScene?.(scene);
    // The patrol's en-route comparison (TASK-212) — awaited, so a confirmed
    // person's one spoken line lands before the next stage moves the robot.
    if (this.deps.onLook) {
      try {
        await this.deps.onLook(observation);
      } catch (err) {
        console.warn(`[AgentMode] onLook hook failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return observation;
  }

  // ── patrol (TASK-212) ─────────────────────────────────────────────────────

  /**
   * The control photo at a checkpoint.
   *
   * Aligns to the stored heading (a measured turn), takes ONE frame, and then
   * runs the cascade the task settled on: in patrol mode the perceptual-hash
   * gate against the baseline photo of this checkpoint × window first — a
   * frame that clears it is `unchanged`, stored, and costs no model call; only
   * otherwise ONE checklist call. The frame is stored ONLY when that answer
   * says no person is in it: data minimisation by not storing, which is
   * stronger and simpler than blurring. In baseline mode the checklist always
   * runs and photo + answers become the baseline (through the host).
   */
  private async capture(block: AgentBlock): Promise<BlockOutcome> {
    const host = this.deps.patrol?.() ?? null;
    const checkpointId = typeof block.params.checkpointId === 'string' ? block.params.checkpointId : '';
    if (!host || !checkpointId) {
      return { ok: false, message: 'capture: no patrol run is active for this checkpoint' };
    }
    const ctx = host.context(checkpointId);
    if (!ctx) return { ok: false, message: `capture: checkpoint "${checkpointId}" is not part of the active patrol` };
    const name = ctx.checkpoint.name;

    // Heading alignment: a MEASURED turn onto the stored world heading, so the
    // control photo frames the same view as the baseline. Skipped when the
    // checkpoint stores none or the robot is already within a few degrees.
    let alignNote = '';
    const headingDeg = Number(block.params.headingDeg);
    if (Number.isFinite(headingDeg)) {
      await this.refreshYaw();
      const delta = normalizeDeg(headingDeg - this.deps.scene.getYawDeg());
      if (Math.abs(delta) > 5) {
        const { result, turnedDeg } = await this.turnMeasured(delta);
        alignNote = result.ok
          ? ` Aligned to ${Math.round(headingDeg)}° (turned ${turnedDeg === null ? Math.round(delta) : Math.round(turnedDeg)}°).`
          : ` Could not align to ${Math.round(headingDeg)}° (${locoError(result)}) — photo taken as is.`;
      }
    }

    let b64: string;
    try {
      b64 = await this.snapshot(this.cameraName);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      host.recordCapture(checkpointId, { photo: null, photoDropped: 'error', answers: null, model: null, inspection: 'error', similarity: null, message: reason });
      return { ok: false, message: `capture at ${name}: no frame — ${reason}` };
    }
    const jpeg = Buffer.from(b64, 'base64');

    if (ctx.mode === 'patrol') {
      const gate = gateByHash(jpeg, host.baselinePhoto(checkpointId), host.hashGate);
      if (gate.unchanged) {
        // The baseline photo held no person (it was never stored otherwise)
        // and this frame hashes the same, so it is stored without asking.
        const { photoKey } = host.recordCapture(checkpointId, {
          photo: jpeg,
          photoDropped: null,
          answers: null,
          model: null,
          inspection: 'unchanged',
          similarity: gate.similarity,
        });
        return {
          ok: true,
          message:
            `Control photo at ${name}: unchanged against the baseline (similarity ${(gate.similarity ?? 0).toFixed(2)}) — ` +
            `no model call.${photoKey ? ` Stored as ${photoKey}.` : ''}${alignNote}`,
        };
      }
    }

    let answers: ChecklistAnswers;
    let model: string | null = null;
    try {
      const res = await host.checklist(b64, ctx.checkpoint.expectations ?? []);
      answers = res.answers;
      model = res.model;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // No answer means no `personPresent` verdict, and without that verdict
      // the frame is NOT stored — fail closed on the privacy side.
      host.recordCapture(checkpointId, { photo: null, photoDropped: 'error', answers: null, model: null, inspection: 'error', similarity: null, message: reason });
      return { ok: false, message: `capture at ${name}: the checklist model did not answer — ${reason}. The frame was not stored.` };
    }
    if (answers.degraded) {
      // A garbled / prose answer carries no `personPresent` verdict. The rule
      // is "store ONLY on personPresent === false", and a default is not a
      // verdict — so this is the same fail-closed path as no answer at all:
      // nothing on disk, nothing uploaded, nothing recorded as baseline.
      const reason = `checklist answer could not be parsed (${answers.oneLine})`;
      host.recordCapture(checkpointId, { photo: null, photoDropped: 'error', answers: null, model, inspection: 'error', similarity: null, message: reason });
      return { ok: false, message: `capture at ${name}: ${reason}. The frame was not stored.${alignNote}` };
    }
    const person = answers.personPresent;
    const { photoKey } = host.recordCapture(checkpointId, {
      photo: person ? null : jpeg,
      photoDropped: person ? 'person' : null,
      answers,
      model,
      // Baseline mode: a person shot records nothing (the host skips it), so
      // it must not be labelled `recorded`.
      inspection: ctx.mode === 'baseline' ? (person ? 'skipped' : 'recorded') : null,
      similarity: null,
    });
    return {
      ok: true,
      message:
        `Control photo at ${name}: ${answers.oneLine}.` +
        (person ? ' A person is in frame — the photo was NOT stored.' : photoKey ? ` Stored as ${photoKey}.` : '') +
        (ctx.mode === 'baseline' ? (person ? ' NOT recorded as baseline — retake this checkpoint.' : ' Recorded as baseline.') : '') +
        alignNote,
    };
  }

  /** Compare the checkpoint against its baseline (patrol mode) — the host does the diff. */
  private async inspect(block: AgentBlock): Promise<BlockOutcome> {
    const host = this.deps.patrol?.() ?? null;
    const checkpointId = typeof block.params.checkpointId === 'string' ? block.params.checkpointId : '';
    if (!host || !checkpointId) {
      return { ok: false, message: 'inspect: no patrol run is active for this checkpoint' };
    }
    const result = await host.inspect(checkpointId);
    return { ok: result.inspection !== 'error', message: result.message };
  }

  /**
   * Replace the dead-reckoned heading with the sidecar's measured yaw when it
   * has one, and hand the same fix's POSITION to scene memory. Absent odometry
   * is left as dead reckoning and labelled as such — never presented as a
   * measurement.
   *
   * The position half is TASK-221. `/loco/odom` has always answered
   * `{ x, y, yaw, source }` here and only the yaw was kept, which left scene
   * memory believing what Agent Mode had COMMANDED and nothing else: a Quest
   * teleop drive, a direct POST to the sidecar or a VLA rollout moved the robot
   * without a `walk` block, `hasMovedSinceObservation()` answered false, and a
   * `goto` could report "Arrived at table after 0 stages" from four metres away.
   *
   * It cannot double-count against `driveFor`'s commanded metres: the store
   * keeps the two as separate accounts of the same window and takes the larger
   * (see `SceneMemoryStore.noteOdometryM`), so a stage that was commanded AND
   * measured is one stage, not two.
   *
   * This alone does not close the hole, because it only fires while Agent Mode
   * is acting — a teleop drive with no block after it is still invisible here.
   * The other two halves are `AgentModeController.notePolledOdometry`, which
   * feeds the 2 s pose poll in while somebody else holds the lock, and the lock
   * hook that clears the scene outright when they take it.
   *
   * When `/loco/odom` answers nothing this hands over nothing, which is right —
   * a null is not a pose — but it leaves the merge that follows with no anchor
   * behind it. `SceneMemoryStore.noteOdometryM` picks that case up on the next
   * fix and calls the gap unmeasured rather than zero.
   */
  private async refreshYaw(): Promise<void> {
    const odom = await this.loco.odometry();
    if (!odom) return;
    this.deps.scene.setYawDeg(odom.yaw * RAD_TO_DEG, 'odometry');
    this.deps.scene.noteOdometryM(odom.x, odom.y);
  }

  // ── expression ────────────────────────────────────────────────────────────

  /**
   * The G1 wave is a fixed right-arm gesture: `WaveHand` (arm task 0/1) carries
   * no hand selector, and the sim drives the RIGHT shoulder, elbow and wrist
   * joints only (see `_wave_targets` in `hardware/sim_g1_dds/loco_state.py`).
   * Its ONE argument is `turn` — whether the torso turns toward the person being
   * greeted. A `hand` parameter was accepted here until this was fixed; the
   * sidecar silently dropped it and the block still reported "Waved with the
   * left hand", which put fabricated actuation data into the compliance record.
   */
  private async wave(block: AgentBlock): Promise<BlockOutcome> {
    const turn = block.params.turn === true;
    const result = await this.loco.action('wave', { turn });
    if (!result.ok) return { ok: false, message: `wave failed: ${locoError(result)}` };
    const held = await this.holdForGesture(WAVE_GESTURE_MS);
    if (!held.ok) return held;
    return {
      ok: true,
      message: turn
        ? 'Waved (right arm — the G1 wave gesture is right-arm only), turning the torso toward the person.'
        : 'Waved (right arm — the G1 wave gesture is right-arm only).',
    };
  }

  /**
   * Keep the block open while a canned gesture plays.
   *
   * `WaveHand` is `SetTaskId(0|1)` on the wire and returns as soon as the
   * request is accepted — the robot then plays a ~4 s animation on its own.
   * Without this hold a `wave` block finished in 2 ms (measured against the
   * sim, whose gesture is timed to the real G1's), the plan reported `done`
   * with the arm still in the air, and "wave, then walk" started walking
   * mid-wave. Interruptible in 100 ms slices like `wait`: an abort lets go of
   * the block, the gesture itself finishes on the robot either way.
   */
  private async holdForGesture(totalMs: number): Promise<BlockOutcome> {
    const sliceMs = 100;
    let elapsed = 0;
    while (elapsed < totalMs) {
      if (this.deps.isAborted()) {
        return { ok: false, message: `gesture aborted after ${(elapsed / 1000).toFixed(1)} s` };
      }
      const step = Math.min(sliceMs, totalMs - elapsed);
      await this.sleep(step);
      elapsed += step;
    }
    return { ok: true, message: '' };
  }

  private async greet(block: AgentBlock): Promise<BlockOutcome> {
    const text = typeof block.params.text === 'string' && block.params.text.trim()
      ? block.params.text.trim()
      : 'Hello! Good to see you.';
    const spoken = await this.say(text, this.language());
    // Recorded on the block, not only in the prose: host mode's AI disclosure
    // rides this block, and whether it was actually PLAYED is the one fact its
    // compliance record has to be able to prove. A caller reading it back out
    // of the message string would be parsing English to answer a legal
    // question (TASK-213).
    block.params.spoken = spoken;
    // Default `turn: false` — the torso turn is only correct when we know
    // where the person is, and `greet` carries no bearing of its own. The
    // planner sets `turn` here when it folded a `wave {turn:true}` into this
    // greet (see mergeAdjacentWaveIntoGreet).
    const turn = block.params.turn === true;
    const result = await this.loco.action('wave', { turn });
    if (!result.ok) {
      return {
        ok: false,
        message: `greet: said "${text}"${spoken ? '' : ' (text-only, voice service unreachable)'} but the wave failed: ${locoError(result)}`,
      };
    }
    const held = await this.holdForGesture(WAVE_GESTURE_MS);
    if (!held.ok) return held;
    return {
      ok: true,
      message: `Greeted: "${text}"${spoken ? '' : ' (text-only, voice service unreachable)'} + right-arm wave.`,
    };
  }

  private async posture(block: AgentBlock): Promise<BlockOutcome> {
    const pose = block.params.pose as PostureName | undefined;

    // "high"/"low" are NOT FSM ids — there is no high-stand/low-stand entry in
    // the FSM table. Standing height is its own RPC (SetStandHeight, api 7104),
    // so these two route to /loco/stand-height instead of /loco/fsm.
    if (pose === 'high' || pose === 'low') {
      const result = await this.loco.standHeight(pose);
      if (!result.ok) {
        return { ok: false, message: `posture "${pose}" failed: ${locoError(result)}` };
      }
      return { ok: true, message: `Stand height set to "${pose}".` };
    }

    const fsmId = pose ? G1_FSM_IDS[pose] : undefined;
    if (fsmId === undefined) {
      // Honest refusal beats a guessed FSM id on a 43-DOF humanoid.
      const known = [...Object.keys(G1_FSM_IDS), 'high', 'low'].join(', ');
      return {
        ok: false,
        message: `posture: unknown pose "${String(block.params.pose)}". Supported: ${known}.`,
      };
    }
    const result = await this.loco.fsm(fsmId);
    if (!result.ok) return { ok: false, message: `posture "${pose}" failed: ${locoError(result)}` };
    return { ok: true, message: `Posture set to "${pose}" (FSM ${fsmId}).` };
  }

  private async speak(block: AgentBlock): Promise<BlockOutcome> {
    const text = typeof block.params.text === 'string' ? block.params.text.trim() : '';
    if (!text) return { ok: false, message: 'speak: empty text' };
    const spoken = await this.say(text, this.language());
    block.params.spoken = spoken;
    // A missing voice service is explicitly a degraded success, not a failure:
    // the utterance still reaches the operator as text in the block result.
    return {
      ok: true,
      message: spoken ? `Said: "${text}"` : `Said (text-only, voice service unreachable): "${text}"`,
    };
  }

  // ── memory ────────────────────────────────────────────────────────────────

  /**
   * Write one line into durable memory (TASK-197).
   *
   * The only write path the planner has, and it does NOT decide whether the
   * line may be stored — {@link Workspace.promote} does, from the record's
   * `trust`. That separation is the point: a prompt can be talked into calling
   * this block, and no prompt can talk the chokepoint into accepting an
   * `untrusted` record.
   *
   * Overflow comes back as `ok: false` carrying the entries already on disk, so
   * the operator (and the model, on the next turn) can consolidate. The file is
   * left exactly as it was — see the cap handling in `promote`.
   *
   * The `try` around `promote` is not decoration: the write itself is
   * `atomicWrite`, which THROWS when the rename cannot land (a virus scanner or
   * a second process holding the file open — this box has produced orphaned
   * `*.tmp-*` files for real). Without it the failure became one red block and
   * nothing else: `workspaceWriteFailedAtMs` stayed null, the heartbeat kept
   * reporting a healthy workspace, and memory could stop recording indefinitely
   * with nobody noticing. Every durable write reports through
   * {@link BlockExecutorDeps.onDurableWrite} now, in both directions.
   */
  private remember(block: AgentBlock): BlockOutcome {
    const text = oneLine(typeof block.params.text === 'string' ? block.params.text : '');
    if (!text) return { ok: false, message: 'remember: empty text' };
    if (!this.memory) {
      return { ok: false, message: 'remember: this robot has no memory workspace configured.' };
    }

    const scope = block.params.scope === 'global' ? 'global' : 'place';
    const place = this.deps.scene.getPlace()?.id ?? null;
    // A `place` scope with no place is refused by `promote` with a message the
    // operator can act on, rather than being quietly re-routed into MEMORY.md —
    // "remember that THIS aisle is blocked" filed under nowhere is a fact about
    // the wrong world.
    const record: JournalRecord = {
      t: new Date(this.now()).toISOString(),
      bootId: null,
      kind: 'note',
      place,
      trust: this.rememberTrust(),
      msg: text,
    };

    let result: PromoteResult;
    try {
      result = this.memory.promote(record, scope === 'global' ? 'memory' : 'place');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.onDurableWrite(false, `remember: ${reason}`);
      return { ok: false, message: `remember: the write to durable memory failed: ${reason}` };
    }
    // Only a write that actually reached the disk clears the flag. A refusal
    // touched nothing, so it must neither raise nor clear it.
    if (result.ok) this.onDurableWrite(true, null);
    return { ok: result.ok, message: result.ok ? result.message : `remember: ${result.message}` };
  }

  /**
   * One chunk of a stop's authored talk track (TASK-213). Not `speak` with a
   * different name: the chunk counter is what makes a cut-short stop visible
   * in the timeline ("said 2 of 3") instead of silently ending early, and the
   * text is authored by an operator rather than by the planner — a distinction
   * a reviewer of the timeline has to be able to see.
   */
  private async present(block: AgentBlock): Promise<BlockOutcome> {
    const text = typeof block.params.text === 'string' ? block.params.text.trim() : '';
    const chunk = Number(block.params.chunk);
    const of = Number(block.params.of);
    const where = Number.isFinite(chunk) && Number.isFinite(of) ? `part ${chunk} of ${of}` : 'part';
    if (!text) return { ok: false, message: `present: empty text (${where})` };
    const spoken = await this.say(text, this.language());
    block.params.spoken = spoken;
    return {
      ok: true,
      message: spoken
        ? `Said ${where}: "${text}"`
        : `Said ${where} (text-only, voice service unreachable): "${text}"`,
    };
  }

  /**
   * The stop's VLA skill (TASK-213), run or described.
   *
   * `narrate` is a FULL outcome, not a fallback that got away with it: the
   * apple scene is a fixed-base G1, so in simulation the robot that can walk a
   * tour physically cannot also pick the apple. The result string says
   * "described, not executed" in that case, and the leg records `narrated` —
   * a timeline that implies a grasp happened when the robot only talked is the
   * one lie this feature must not tell.
   */
  private async demo(block: AgentBlock): Promise<BlockOutcome> {
    const skillId = typeof block.params.skillId === 'string' ? block.params.skillId : '';
    const skillName = typeof block.params.skillName === 'string' && block.params.skillName ? block.params.skillName : skillId;
    const mode = block.params.mode === 'execute' ? 'execute' : 'narrate';
    if (!skillId) return { ok: false, message: 'demo: no skillId' };

    if (mode === 'narrate') {
      const line = demoNarration(skillName, this.language() ?? 'en');
      const spoken = await this.say(line, this.language());
      return {
        ok: true,
        message: `Described "${skillName}" — not executed${spoken ? '' : ' (voice service unreachable)'}.`,
      };
    }

    if (!this.deps.runSkill) {
      // Say it out loud too: a visitor watching a robot that promised a
      // demonstration is owed the reason it did not happen.
      const line = demoNarration(skillName, this.language() ?? 'en');
      await this.say(line, this.language());
      return { ok: false, message: `demo: this agent cannot run skills, so "${skillName}" was only described.` };
    }

    const timeoutMs = Number.isFinite(Number(block.params.expectSeconds))
      ? Math.max(5_000, Number(block.params.expectSeconds) * 2_000)
      : undefined;
    const result = await this.deps.runSkill({
      skillId,
      skillName,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    // Carried on the block so the runner can read the numbers back off it.
    if (typeof result.steps === 'number') block.params.steps = result.steps;
    return { ok: result.ok, message: result.message };
  }

  private async wait(block: AgentBlock): Promise<BlockOutcome> {
    const seconds = Number(block.params.seconds);
    if (!Number.isFinite(seconds)) return { ok: false, message: 'wait: seconds is not a number' };
    const totalMs = Math.min(30_000, Math.max(100, seconds * 1000));

    // The one place an abort may cut a block short: sleeping is interruptible,
    // stopping a motion mid-stride is not.
    const sliceMs = 100;
    let elapsed = 0;
    while (elapsed < totalMs) {
      if (this.deps.isAborted()) {
        return { ok: false, message: `wait aborted after ${(elapsed / 1000).toFixed(1)} s` };
      }
      const step = Math.min(sliceMs, totalMs - elapsed);
      await this.sleep(step);
      elapsed += step;
    }
    return { ok: true, message: `Waited ${(totalMs / 1000).toFixed(1)} s.` };
  }
}
