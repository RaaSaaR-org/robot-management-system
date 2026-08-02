/**
 * @file block-executor.ts
 * @description One handler per block kind, dispatching through HardwareClient's
 *              `/loco/*` LocoClient facade. A running block is NEVER interrupted
 *              mid-flight: the abort flag is checked between blocks, and inside
 *              `wait`'s sleep (which may exit early).
 * @feature agentmode
 * @status live
 */

import { config } from '../config/config.js';
import { hardwareClient, type LocoActionName, type LocoResult } from '../hardware/HardwareClient.js';
// The two clamp constants live in navigator.ts because that is where they are
// justified (the 0.45 m comment is the reason the number exists). Importing
// them is acyclic: navigator.ts imports only config, scene-memory and types.
import { CLEARANCE_MARGIN_M, MIN_STAGE_M } from './navigator.js';
import { RangeSensor } from './range.js';
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

/** Why a motion command can be accepted and still move nothing. */
const NO_MOTION_HINT =
  'the command was accepted but nothing moved — the base is most likely in a ' +
  'non-locomoting FSM (damp/sit, e.g. after an E-Stop) or physically blocked. ' +
  'Send a `posture` block with pose "stand" before moving again.';

const MIN_DURATION_S = 0.2;
/** Cap so a hallucinated distance cannot produce a minutes-long command. */
const MAX_DURATION_S = 60;

export interface WalkCommand {
  vx: number;
  vy: number;
  omega: number;
  durationS: number;
}

/**
 * distance (m) → (vx, vy, duration) at AGENT_WALK_SPEED_MPS. Speed is held
 * constant and the DURATION carries the distance; that is what LocoClient's
 * `SetVelocity(vx, vy, omega, duration)` expects.
 */
export function walkToCommand(
  distanceM: number,
  direction: WalkDirection,
  speedMps: number = config.agentMode.walkSpeedMps
): WalkCommand {
  const speed = Math.abs(speedMps) > 1e-6 ? Math.abs(speedMps) : 0.4;
  const distance = Math.abs(distanceM);
  const axes = WALK_AXES[direction] ?? WALK_AXES.forward;
  const durationS = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, distance / speed));
  return { vx: axes.fx * speed, vy: axes.fy * speed, omega: 0, durationS };
}

/**
 * angle (deg, + = left/CCW) → (omega, duration) at AGENT_TURN_SPEED_DPS. omega
 * is rad/s because that is LocoClient's unit; its SIGN carries the direction and
 * the duration carries the magnitude.
 */
export function turnToCommand(
  angleDeg: number,
  turnSpeedDps: number = config.agentMode.turnSpeedDps
): WalkCommand {
  const rate = Math.abs(turnSpeedDps) > 1e-6 ? Math.abs(turnSpeedDps) : 45;
  const angle = normalizeDeg(angleDeg);
  const durationS = Math.min(MAX_DURATION_S, Math.max(MIN_DURATION_S, Math.abs(angle) / rate));
  const omega = Math.sign(angle) * rate * DEG_TO_RAD;
  return { vx: 0, vy: 0, omega, durationS };
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
  /** Called after every scene merge so the controller can mirror it. */
  onScene?: (scene: SceneMemory) => void;
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
          return await this.look();
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

    const cmd = walkToCommand(distanceM, direction);
    const before = await this.loco.odometry();
    const result = await this.driveFor(cmd);
    if (!result.ok) return { ok: false, message: `walk failed: ${locoError(result)}` };
    const after = await this.loco.odometry();

    // Report what the robot ACHIEVED, not what it was told to do. The two differ
    // whenever the robot is slowed, blocked or the command expires early, and a
    // block that claims "walked 2.00 m" after moving 1.71 m makes the planner
    // re-plan from a pose that does not exist. Without odometry we say so.
    if (!before || !after) {
      return {
        ok: true,
        message:
          `Commanded ${distanceM.toFixed(2)} m ${direction} ` +
          `(${cmd.durationS.toFixed(1)} s at ${config.agentMode.walkSpeedMps} m/s). ` +
          `No odometry available — distance travelled is unverified.${clampNote}`,
      };
    }

    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    // Zero measured motion for a real command is a FAILURE, not a 100% short
    // success: the plan must stop here rather than keep issuing blocks against
    // a pose the robot never reached.
    if (Math.abs(distanceM) > ZERO_MOTION_M && moved < ZERO_MOTION_M) {
      return {
        ok: false,
        message:
          `walk: the robot did not move (${moved.toFixed(2)} m measured for a commanded ` +
          `${Math.abs(distanceM).toFixed(2)} m) — ${NO_MOTION_HINT}`,
        measured: { distanceM: moved },
      };
    }

    const shortfall = distanceM > 0 ? 1 - moved / distanceM : 0;
    const note =
      shortfall > SHORTFALL_TOLERANCE
        ? ` — ${(shortfall * 100).toFixed(0)}% short of the commanded ${distanceM.toFixed(2)} m` +
          ` (blocked, slowed, or the command expired early)`
        : '';
    return {
      ok: true,
      message: `Walked ${moved.toFixed(2)} m ${direction} in ${cmd.durationS.toFixed(1)} s${note}.${clampNote}`,
      measured: { distanceM: moved },
    };
  }

  private async turn(block: AgentBlock): Promise<BlockOutcome> {
    const angleDeg = Number(block.params.angleDeg);
    if (!Number.isFinite(angleDeg)) return { ok: false, message: 'turn: angleDeg is not a number' };

    const { result, turnedDeg } = await this.turnMeasured(angleDeg);
    if (!result.ok) return { ok: false, message: `turn failed: ${locoError(result)}` };

    const side = angleDeg >= 0 ? 'left' : 'right';
    if (turnedDeg === null) {
      return {
        ok: true,
        message:
          `Commanded ${normalizeDeg(angleDeg).toFixed(0)}° ${side}; heading now ` +
          `${Math.round(this.deps.scene.getYawDeg())}° by dead reckoning (no odometry).`,
      };
    }
    // Same reasoning as walk(): report the measured rotation, so a turn the
    // robot could not complete does not silently corrupt every later bearing.
    // Same rule as walk(): a commanded rotation that measurably did not happen
    // is a failed block, not a turn that fell short.
    if (didNotTurn(angleDeg, turnedDeg)) {
      return {
        ok: false,
        message:
          `turn: the robot did not turn (${turnedDeg.toFixed(0)}° measured for a commanded ` +
          `${normalizeDeg(angleDeg).toFixed(0)}°) — ${NO_MOTION_HINT}`,
        measured: { angleDeg: turnedDeg },
      };
    }

    const shortfall = Math.abs(angleDeg) > 0 ? 1 - Math.abs(turnedDeg) / Math.abs(angleDeg) : 0;
    const note =
      shortfall > SHORTFALL_TOLERANCE
        ? ` — ${(shortfall * 100).toFixed(0)}% short of the commanded ${normalizeDeg(angleDeg).toFixed(0)}°`
        : '';
    return {
      ok: true,
      message: `Turned ${turnedDeg.toFixed(0)}° (${side}); heading now ${Math.round(this.deps.scene.getYawDeg())}°${note}.`,
      measured: { angleDeg: turnedDeg },
    };
  }

  /**
   * One measured rotation: issue it, keep the heading estimate current, and
   * report how far the base ACTUALLY turned.
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
   * `turnedDeg` is null when the rotation cannot be measured — see
   * {@link didNotTurn} for why that must not be read as "did not move".
   */
  private async turnMeasured(
    angleDeg: number
  ): Promise<{ result: LocoResult; turnedDeg: number | null }> {
    const before = await this.loco.odometry();
    const result = await this.driveFor(turnToCommand(angleDeg));
    if (!result.ok) return { result, turnedDeg: null };

    // Keep the heading estimate current even without odometry; refreshYaw()
    // replaces it with a measured value whenever the sidecar has one.
    this.deps.scene.advanceYawDeg(normalizeDeg(angleDeg));
    await this.refreshYaw();
    const after = await this.loco.odometry();
    if (!before || !after) return { result, turnedDeg: null };

    return { result, turnedDeg: normalizeDeg((after.yaw - before.yaw) * RAD_TO_DEG) };
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
    this.deps.scene.noteTranslationM(Math.hypot(cmd.vx, cmd.vy) * cmd.durationS);
    if (!result.ok) return result;
    const remainingMs = cmd.durationS * 1000 - (this.now() - startedAt);
    if (remainingMs > 0) await this.sleep(remainingMs);
    return result;
  }

  // ── perception ────────────────────────────────────────────────────────────

  private async look(): Promise<BlockOutcome> {
    const observation = await this.observeAndMerge();
    const labels = observation.entities.map((e) => e.label);
    return {
      ok: true,
      message:
        labels.length > 0
          ? `Looked: ${observation.currentView} (entities: ${labels.join(', ')})`
          : `Looked: ${observation.currentView}`,
    };
  }

  private async scanRoom(block: AgentBlock): Promise<BlockOutcome> {
    const stepsRaw = Number(block.params.steps);
    const steps = Number.isFinite(stepsRaw) ? Math.round(Math.min(12, Math.max(4, stepsRaw))) : 8;
    const stepDeg = 360 / steps;

    const found = new Set<string>();
    // Look first, then turn — otherwise the starting heading is never observed.
    for (let i = 0; i < steps; i++) {
      const observation = await this.observeAndMerge();
      for (const e of observation.entities) found.add(e.label);

      if (i === steps - 1) break; // a final turn would just repeat step 0
      if (this.deps.isAborted()) {
        return { ok: false, message: `scan_room aborted after ${i + 1} of ${steps} steps` };
      }
      const { result, turnedDeg } = await this.turnMeasured(stepDeg);
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
            `commanded ${Math.round(stepDeg)}°) after ${i + 1} of ${steps} looks — only the ` +
            `starting heading was observed, so this is not a 360° scan. ${NO_MOTION_HINT}`,
          measured: { angleDeg: turnedDeg },
        };
      }
    }

    // Close the circle. The loop skips the last turn so the starting heading is
    // not observed twice, which leaves the robot one step (360/steps) short of
    // where it began — measured: 90° in, 44.9° out on an 8-step scan. A block
    // the operator reads as "look around" must not quietly leave the robot
    // facing somewhere else; every later `walk` would inherit the offset.
    let headingNote = '';
    if (!this.deps.isAborted()) {
      const { result: closing, turnedDeg } = await this.turnMeasured(stepDeg);
      if (!closing.ok) {
        // The scan itself succeeded — say what did not, rather than failing it.
        headingNote = ` Could not turn back to the starting heading (${locoError(closing)}), so the robot is ${Math.round(stepDeg)}° short of it.`;
      } else if (turnedDeg !== null && didNotTurn(stepDeg, turnedDeg)) {
        // Accepted and ignored: same shape as above, but the sidecar said yes.
        headingNote = ` The closing turn measured ${turnedDeg.toFixed(0)}° for a commanded ${Math.round(stepDeg)}°, so the robot is ${Math.round(stepDeg)}° short of the starting heading.`;
      }
    }

    const summary =
      found.size > 0
        ? `Scanned the room in ${steps} steps; found: ${[...found].join(', ')}.`
        : `Scanned the room in ${steps} steps; nothing recognisable found.`;
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
    const measurement = await this.range.measure(observation.entities.map((e) => e.bearingDeg));
    const entities: ObservedEntity[] = observation.entities.map((entity, index) => {
      const reading = measurement.readings[index] ?? null;
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
    return observation;
  }

  /**
   * Replace the dead-reckoned heading with the sidecar's measured yaw when it
   * has one. Absent odometry is left as dead reckoning and labelled as such —
   * never presented as a measurement.
   */
  private async refreshYaw(): Promise<void> {
    const odom = await this.loco.odometry();
    if (odom) this.deps.scene.setYawDeg(odom.yaw * RAD_TO_DEG, 'odometry');
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
    return {
      ok: true,
      message: turn
        ? 'Waved (right arm — the G1 wave gesture is right-arm only), turning the torso toward the person.'
        : 'Waved (right arm — the G1 wave gesture is right-arm only).',
    };
  }

  private async greet(block: AgentBlock): Promise<BlockOutcome> {
    const text = typeof block.params.text === 'string' && block.params.text.trim()
      ? block.params.text.trim()
      : 'Hello! Good to see you.';
    const spoken = await this.say(text, this.language());
    // `turn: false` — the same gesture the robot has always performed here. The
    // torso turn is only correct when we know where the person is, and `greet`
    // carries no bearing; the planner can ask for it explicitly via `wave`.
    const result = await this.loco.action('wave', { turn: false });
    if (!result.ok) {
      return {
        ok: false,
        message: `greet: said "${text}"${spoken ? '' : ' (text-only, voice service unreachable)'} but the wave failed: ${locoError(result)}`,
      };
    }
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
