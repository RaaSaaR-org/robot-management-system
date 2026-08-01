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
import { RangeSensor } from './range.js';
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
  say?: (text: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultLoco: NonNullable<BlockExecutorDeps['loco']> = {
  move: (vx, vy, omega, durationS) => hardwareClient.locoMove(vx, vy, omega, durationS),
  action: (name, args) => hardwareClient.locoAction(name, args),
  fsm: (id) => hardwareClient.locoFsm(id),
  standHeight: (preset) => hardwareClient.locoStandHeight(preset),
  odometry: () => hardwareClient.getLocoOdometry(),
};

async function defaultSay(text: string): Promise<boolean> {
  try {
    const res = await fetch(`${config.agentMode.voiceServiceUrl}/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BlockExecutor {
  private readonly deps: BlockExecutorDeps;
  private readonly loco: NonNullable<BlockExecutorDeps['loco']>;
  private readonly range: RangeSensor;
  private readonly say: (text: string) => Promise<boolean>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(deps: BlockExecutorDeps) {
    this.deps = deps;
    this.loco = deps.loco ?? defaultLoco;
    this.range = deps.range ?? new RangeSensor();
    this.say = deps.say ?? defaultSay;
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? (() => Date.now());
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
    const distanceM = Number(block.params.distanceM);
    const direction = (block.params.direction as WalkDirection) ?? 'forward';
    if (!Number.isFinite(distanceM)) return { ok: false, message: 'walk: distanceM is not a number' };

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
          `No odometry available — distance travelled is unverified.`,
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
      message: `Walked ${moved.toFixed(2)} m ${direction} in ${cmd.durationS.toFixed(1)} s${note}.`,
      measured: { distanceM: moved },
    };
  }

  private async turn(block: AgentBlock): Promise<BlockOutcome> {
    const angleDeg = Number(block.params.angleDeg);
    if (!Number.isFinite(angleDeg)) return { ok: false, message: 'turn: angleDeg is not a number' };

    const cmd = turnToCommand(angleDeg);
    const before = await this.loco.odometry();
    const result = await this.driveFor(cmd);
    if (!result.ok) return { ok: false, message: `turn failed: ${locoError(result)}` };

    // Keep the heading estimate current even without odometry; refreshYaw()
    // replaces it with a measured value whenever the sidecar has one.
    this.deps.scene.advanceYawDeg(normalizeDeg(angleDeg));
    await this.refreshYaw();
    const after = await this.loco.odometry();

    const side = angleDeg >= 0 ? 'left' : 'right';
    if (!before || !after) {
      return {
        ok: true,
        message:
          `Commanded ${normalizeDeg(angleDeg).toFixed(0)}° ${side}; heading now ` +
          `${Math.round(this.deps.scene.getYawDeg())}° by dead reckoning (no odometry).`,
      };
    }
    // Same reasoning as walk(): report the measured rotation, so a turn the
    // robot could not complete does not silently corrupt every later bearing.
    const turned = normalizeDeg((after.yaw - before.yaw) * RAD_TO_DEG);
    // Same rule as walk(): a commanded rotation that measurably did not happen
    // is a failed block, not a turn that fell short.
    if (Math.abs(normalizeDeg(angleDeg)) > ZERO_MOTION_DEG && Math.abs(turned) < ZERO_MOTION_DEG) {
      return {
        ok: false,
        message:
          `turn: the robot did not turn (${turned.toFixed(0)}° measured for a commanded ` +
          `${normalizeDeg(angleDeg).toFixed(0)}°) — ${NO_MOTION_HINT}`,
        measured: { angleDeg: turned },
      };
    }

    const shortfall = Math.abs(angleDeg) > 0 ? 1 - Math.abs(turned) / Math.abs(angleDeg) : 0;
    const note =
      shortfall > SHORTFALL_TOLERANCE
        ? ` — ${(shortfall * 100).toFixed(0)}% short of the commanded ${normalizeDeg(angleDeg).toFixed(0)}°`
        : '';
    return {
      ok: true,
      message: `Turned ${turned.toFixed(0)}° (${side}); heading now ${Math.round(this.deps.scene.getYawDeg())}°${note}.`,
      measured: { angleDeg: turned },
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
      const cmd = turnToCommand(stepDeg);
      const result = await this.driveFor(cmd);
      if (!result.ok) {
        return { ok: false, message: `scan_room failed while turning: ${locoError(result)}` };
      }
      this.deps.scene.advanceYawDeg(stepDeg);
      await this.refreshYaw();
    }

    // Close the circle. The loop skips the last turn so the starting heading is
    // not observed twice, which leaves the robot one step (360/steps) short of
    // where it began — measured: 90° in, 44.9° out on an 8-step scan. A block
    // the operator reads as "look around" must not quietly leave the robot
    // facing somewhere else; every later `walk` would inherit the offset.
    let headingNote = '';
    if (!this.deps.isAborted()) {
      const closing = await this.driveFor(turnToCommand(stepDeg));
      if (closing.ok) {
        this.deps.scene.advanceYawDeg(stepDeg);
        await this.refreshYaw();
      } else {
        // The scan itself succeeded — say what did not, rather than failing it.
        headingNote = ` Could not turn back to the starting heading (${locoError(closing)}), so the robot is ${Math.round(stepDeg)}° short of it.`;
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
    const spoken = await this.say(text);
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
    const spoken = await this.say(text);
    // A missing voice service is explicitly a degraded success, not a failure:
    // the utterance still reaches the operator as text in the block result.
    return {
      ok: true,
      message: spoken ? `Said: "${text}"` : `Said (text-only, voice service unreachable): "${text}"`,
    };
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
