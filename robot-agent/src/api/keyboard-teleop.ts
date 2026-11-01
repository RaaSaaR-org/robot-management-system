/**
 * @file keyboard-teleop.ts
 * @description WebSocket endpoint for keyboard-based teleoperation of the
 *              simulated robot. Embodiment-aware: drives the active robot's
 *              joints (SO-101, G1, G1-EDU, …) through the RobotStateManager's
 *              simulated joint state — no hardware sidecar required.
 * @feature teleop
 * @status live
 */

import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { RobotStateManager } from '../robot/state.js';
import { controlOwnerLock } from '../agent-mode/control-owner.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
import type { BaseModeName } from '../hardware/base-mode.js';
import { config } from '../config/config.js';
import { WristTeleop, parseWristPose } from '../teleop/wrist-teleop.js';
import { FingerRetargeter, gripPose, type HandKeypoints } from '../teleop/dexpilot.js';
import { G1_ARM_CHAINS, G1_FINGER_CHAINS, type Side } from '../teleop/g1-chains.generated.js';
import { markTeleopMode } from '../teleop/teleop-mode.js';
import { controlLease, type ControlLeaseRegistry, type LeaseEvent } from '../control-lease/control-lease.js';
import { adjustBoundCount } from '../control-lease/socket-binding.js';
import { armRegistry as defaultArmRegistry, type ArmRegistry } from '../teleop/arm-registry.js';
import { ReengageLatch, parseClutch, type ReengageState } from '../teleop/reengage.js';
import { isG1Family, isG1ForwardableJoint } from '../teleop/forward-joints.js';

/** How fast a held joint moves, in radians per second. */
const SLEW_RATE_RAD_PER_S = 0.8;
/** The socket's housekeeping tick: dead-man, latch edges, base ramp (~30 Hz). */
const TICK_MS = 33;
/**
 * Integration tick for held-key JOINT motion (50 Hz), TASK-421.
 *
 * The same rate as the forwarder (`TELEOP_FORWARD_MS`) and the sidecar's
 * publisher, so every target step (0.8 rad/s × 20 ms = 16 mrad) fits inside one
 * sidecar slew step (1.0 rad/s × 20 ms). Integrated on the 33 ms tick instead,
 * the target jumped 26 mrad every 33 ms against a 20 mrad-per-frame slew: the
 * commanded joint velocity alternated between the slew limit and a fraction of
 * it at the 30/50 Hz beat, which a stiff arm feels as a buzz.
 */
const JOINT_TICK_MS = 20;
/**
 * How long a held key keeps moving its joint without a fresh clutch-closed
 * heartbeat, in ms (TASK-421). A client that reports its clutch (the keyboard
 * does, at 10 Hz) and goes quiet stops its joint after three missed beats
 * instead of after the full arm dead-man: the arm then HOLDS where it is until
 * the heartbeat dead-man hands it back. Clients that never report a clutch
 * (the sim, scripts) are not affected.
 */
const HELD_KEY_TTL_MS = 300;
/** How often a moving joint's pose is echoed to the client, in ms. */
const STATE_ECHO_MS = 33;
/**
 * How long a base-velocity command stays alive on the robot, in seconds.
 *
 * This is the DEAD MAN. `SetVelocity` expires on its own, so a client that
 * stops sending — headset taken off, tab closed, Wi-Fi gone, browser tab
 * throttled in the background — leaves a robot that coasts to a stop within
 * this window instead of one that keeps walking. Deliberately a little longer
 * than the client's send interval, so ordinary jitter never makes it stutter.
 */
const MOVE_TTL_S = 0.35;
/**
 * Ceilings for operator-driven motion, taken from the SAME config the
 * autonomous planner walks at. A human at the controls is a reason to preempt
 * Agent Mode (see `controlOwnerLock`), not a reason to move faster than the
 * robot is configured to move.
 */
const MAX_LINEAR_MPS = Math.abs(config.agentMode.walkSpeedMps) || 0.4;
const MAX_ANGULAR_RAD_S = ((Math.abs(config.agentMode.turnSpeedDps) || 45) * Math.PI) / 180;
/**
 * How fast the commanded planar speed is allowed to RISE, in m/s².
 *
 * 0.8 takes a G1 from standing to the configured 0.4 m/s in ~0.5 s, which is
 * roughly the wind-up its gait needs anyway.
 *
 * Why this exists at all: on the VR controller the SAME stick is elbow-pitch
 * while the grip is held and base-drive while it is free. An operator who
 * releases the grip in order to start walking almost always releases it with
 * the stick already deflected — so the first `{move}` of the burst is not a
 * gentle push from centre, it is a step straight to full speed with no
 * wind-up. Watching for that in the sim looks like the robot being shoved.
 */
const MAX_LINEAR_ACCEL_MPS2 = 0.8;
/** Ping interval for the socket's own liveness probe, in ms. */
const KEEPALIVE_MS = 15_000;
/**
 * The ARM dead-man (TASK-393), in ms.
 *
 * A client that sends `{hb}` frames (the VR rig does, at 10 Hz, from its render
 * loop) promises to keep sending them while it drives. One second without one —
 * the headset's render loop stalled, the tab was backgrounded, Wi-Fi went — and
 * this socket's motion is halted and its arm claim given back, which disarms the
 * sidecar when it was the last one. The 15 s ping above cannot do this job: it
 * never checks the pong, and fifteen seconds is a long time for an arm.
 */
const HEARTBEAT_TIMEOUT_MS = 1_000;
/**
 * Largest teleop frame we will accept, in bytes. A 43-joint G1 EDU pose is
 * ~1.5 KB; `ws` defaults to 100 MiB, i.e. an unauthenticated socket on the
 * robot could be asked to buffer a hundred megabytes per frame.
 */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/** A planar base velocity in the robot frame: +vx forward, +vy left, +omega CCW. */
export interface BaseVelocity {
  vx: number;
  vy: number;
  omega: number;
}

const ZERO_VELOCITY: BaseVelocity = { vx: 0, vy: 0, omega: 0 };

/**
 * One step of the base-velocity ramp: move `from` toward `to`, limiting only
 * how fast the PLANAR SPEED rises.
 *
 * Pure and exported so the ramp can be tested without timers or a socket.
 *
 * Asymmetric on purpose — increases are slewed, decreases and zeros are handed
 * through byte-for-byte:
 *
 * - The dead man (`MOVE_TTL_S`) and the release-stop both depend on a zero
 *   being a zero. A ramp that also smoothed the way DOWN would turn "the
 *   operator let go" into "the robot decelerates over half a second", which is
 *   the one moment they are most likely to be stopping for a reason.
 * - `omega` is never slewed: the wind-up problem is the linear gait, and a
 *   turn-in-place that lagged the stick would feel broken rather than safe.
 *
 * A direction change at equal-or-lower speed is not an increase and therefore
 * passes straight through — the ramp limits how fast the robot speeds UP, it
 * does not own where the operator points.
 */
export function slewBaseVelocity(
  from: BaseVelocity,
  to: BaseVelocity,
  dtS: number,
  maxAccelMps2: number = MAX_LINEAR_ACCEL_MPS2,
): BaseVelocity {
  const speedFrom = Math.hypot(from.vx, from.vy);
  const speedTo = Math.hypot(to.vx, to.vy);
  if (speedTo <= speedFrom) return { ...to };
  const capped = speedFrom + Math.max(0, maxAccelMps2) * Math.max(0, dtS);
  if (capped >= speedTo) return { ...to };
  const k = capped / speedTo;
  return { vx: to.vx * k, vy: to.vy * k, omega: to.omega };
}

/**
 * Scale a planar velocity so its MAGNITUDE respects `limit`, preserving the
 * direction the operator asked for.
 *
 * Was a per-axis clamp, which quietly broke this file's own invariant: vx and
 * vy each clamped to 0.4 let a diagonal stick push out at hypot(0.4, 0.4) =
 * 0.566 m/s — 41% faster than the robot is configured to walk, in exactly the
 * direction an operator is least able to judge. Clamping the vector instead
 * keeps the heading and only takes the speed away.
 */
export function clampPlanar(vx: number, vy: number, limit: number): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (speed <= limit || speed === 0) return { vx, vy };
  const k = limit / speed;
  return { vx: vx * k, vy: vy * k };
}

/**
 * Why the socket is telling the operator something is wrong. Stable strings —
 * the client renders them, it does not parse `message`.
 *
 * - `loco_unavailable` — the locomotion RPC was refused or unreachable.
 * - `loco_disabled` — the sidecar answered 403: locomotion is switched off.
 * - `action_rejected` — the sidecar refused the joint pose (read-only, or an
 *   unknown joint name).
 * - `sidecar_down` — nothing answered the pose stream at all.
 * - `estop_latched` — the input was DISCARDED because an E-Stop is latched.
 * - `unknown_joints` — the pose named joints this embodiment does not have.
 * - `ik_unsupported` — a wrist pose arrived for an embodiment with no arm chain
 *   to solve. Sent ONCE, because a client that keeps streaming would otherwise
 *   be told 20 times a second, and because the honest answer is "this robot is
 *   not a G1", which does not change while the socket is open.
 * - `bad_posture` — `{posture}` named something other than `stand`.
 * - `stand_unavailable` — this agent was built with no base-posture path.
 * - `stand_failed` — the FSM change was attempted and refused.
 * - `lease_required` — (`CONTROL_LEASE_REQUIRED` only) a motion frame arrived
 *   on a socket that is not bound to the installed control lease, and was
 *   DISCARDED. Once per socket, reset by a successful `{bind}`.
 * - `lease_invalid` — a `{bind}` named a secret or generation the registry
 *   does not hold. Sent for EVERY failed bind: a bind is a deliberate act, not
 *   a stream.
 * - `heartbeat_lost` — (TASK-393) this socket sends `{hb}` and stopped for
 *   longer than HEARTBEAT_TIMEOUT_MS: its motion was halted and its arm claim
 *   released. Cleared by the next heartbeat.
 * - `arm_requires_lease` — the sidecar writes to a real robot's arms
 *   (`write_mode: arm_sdk`) and this socket is not bound to the control lease.
 *   The frame was DISCARDED.
 * - `arm_requires_heartbeat` — same, but the socket sends no live heartbeat.
 * - `arm_estop_latched` — the sidecar's own E-stop is latched.
 * - `arm_failed` — the sidecar refused `/arm`; the message carries its words.
 * - `arm_requires_clutch` — this socket heartbeats but never reported a clutch
 *   (`{hb, clutch}`), so it can never make the rising edge arming needs. An
 *   older app or a script: fail closed.
 * - `arm_reengage_required` — the arms are not this socket's and its clutch
 *   has not been seen OPEN and then CLOSED since the last disarm the operator
 *   did not cause (or since the socket opened). See `teleop/reengage.ts`.
 *   Re-sent after each change of that state.
 * - `arm_side_unclutched` — a wrist or finger pose arrived for a side whose
 *   clutch is open. On a real robot that side is not driven: a tracked hand has
 *   no clutch, so hand tracking never drives the real arms.
 * - `home_unavailable` — `{preset:'home'}` on an arm-only sidecar. Home is the
 *   all-zeros pose, which on a real G1 swings both arms forward; the robot's
 *   own controller is the home there, reached by ending teleop (disarm). Sent
 *   for every refused press: it is a deliberate act, not a stream.
 * - `joint_not_drivable` — (TASK-421) a single-joint frame (`direction`,
 *   `position`, `delta`) named a joint the arm-only write path never commands:
 *   a leg, the waist, or a finger of a hand the sidecar does not command. It is
 *   refused BEFORE arming — arming for it would blend the arms in with nothing
 *   to stream, and the sidecar's dead-man would blend them straight back out.
 */
export type TeleopErrorCode =
  | 'loco_unavailable'
  | 'loco_disabled'
  | 'action_rejected'
  | 'sidecar_down'
  | 'estop_latched'
  | 'unknown_joints'
  | 'ik_unsupported'
  | 'bad_posture'
  | 'stand_unavailable'
  | 'stand_failed'
  | 'lease_required'
  | 'lease_invalid'
  | 'heartbeat_lost'
  | 'arm_requires_lease'
  | 'arm_requires_heartbeat'
  | 'arm_estop_latched'
  | 'arm_failed'
  | 'arm_requires_clutch'
  | 'arm_reengage_required'
  | 'arm_side_unclutched'
  | 'home_unavailable'
  | 'joint_not_drivable';

interface DirectionMessage {
  joint: string;
  /** -1, 0, or +1 — sign of motion while a key is held (0 = stop). */
  direction: number;
}
interface DeltaMessage {
  joint: string;
  /** One-shot nudge in radians. */
  delta: number;
}
interface PositionMessage {
  joint: string;
  /** Absolute target angle in radians (clamped to the joint's limits). */
  position: number;
}
interface PoseMessage {
  /** Absolute target angles (radians) for many joints at once. */
  positions: Record<string, number>;
}
interface PresetMessage {
  preset: 'home' | 'stop';
}
interface MoveMessage {
  /** Planar base velocity in the robot frame: +vx forward, +vy left, +omega CCW. */
  move: { vx?: number; vy?: number; omega?: number };
}
interface EStopMessage {
  /** Latch the robot's emergency stop. The one message that is never gated. */
  estop: { reason?: string };
}
interface WristsMessage {
  /**
   * Where the operator's hands are RELATIVE TO THE ROBOT'S EYE POINT, in the
   * robot's axes: `p` in metres (+x forward, +y left, +z up), `q` as
   * (x, y, z, w).
   *
   * Head-relative because that is what a headset measures. The wearer's height,
   * where they are standing in their room and how the XR origin was placed all
   * cancel in the subtraction, which is why this rig needs no calibration step.
   *
   * A side that is absent, null, or unusable is left alone — that is how one
   * hand drives while the other rests, and how a hand whose tracking is lost
   * holds its pose instead of snapping somewhere.
   */
  wrists: {
    left?: { p?: unknown; q?: unknown; grip?: unknown } | null;
    right?: { p?: unknown; q?: unknown; grip?: unknown } | null;
  };
}
interface HandsMessage {
  /**
   * Tracked fingertips, in the robot's own HAND frame (+x along the fingers,
   * +z toward the index side, metres, origin at the wrist).
   *
   * Independent of `wrists`: an operator can have finger tracking without arm
   * IK and the reverse. Send them as SEPARATE messages, though — this socket
   * dispatches on the first key it recognises and returns, for all ten
   * message kinds, so a frame carrying both silently drops the second. The
   * browser sends two `send()` calls for exactly this reason.
   */
  hands: {
    left?: { wrist?: unknown; thumb?: unknown; index?: unknown; middle?: unknown } | null;
    right?: { wrist?: unknown; thumb?: unknown; index?: unknown; middle?: unknown } | null;
  };
}
interface PostureMessage {
  /**
   * Re-arm the base out of a damped FSM.
   *
   * Only `stand`. The other postures Agent Mode knows (`damp`, `sit`, and the
   * two stand HEIGHTS, which are a different RPC entirely) are deliberately not
   * offered on a teleop socket: an operator in a headset has no view of the
   * robot's surroundings and no business folding it up from in there, and the
   * one direction that matters here is OUT of a state that silently swallows
   * every walk command.
   */
  posture: 'stand';
}
interface BindMessage {
  /**
   * Bind this socket to the installed control lease. `leaseId` is the RAW
   * secret the server handed the lease holder; the registry compares only its
   * hash.
   *
   * Honoured whether or not `CONTROL_LEASE_REQUIRED` is set (TASK-393). The
   * server hands leases out by default and the app binds whenever it holds one;
   * an agent that ignored the frame unless the env flag was on never answered
   * `bound`, so "Take control" timed out on every robot that had not opted in.
   * The flag now only decides whether an UNBOUND socket may drive.
   */
  bind: { leaseId?: unknown; generation?: unknown };
}
interface HeartbeatMessage {
  /** Application-level liveness (TASK-393); any value. See HEARTBEAT_TIMEOUT_MS. */
  hb: unknown;
  /**
   * The client's clutch, as it is NOW: `{left, right}` for the VR rig's two
   * grips, a boolean for a one-clutch client (the keyboard: a move key held).
   * A tracked hand is never reported clutched. Sent on every beat and at once
   * on every change. A real robot's arms arm only on a rising edge of it —
   * see `teleop/reengage.ts`. Absent: the client cannot arm a real robot.
   */
  clutch?: unknown;
}
type TeleopMessage =
  | BindMessage
  | HeartbeatMessage
  | DirectionMessage
  | DeltaMessage
  | PositionMessage
  | PoseMessage
  | PresetMessage
  | MoveMessage
  | EStopMessage
  | WristsMessage
  | HandsMessage
  | PostureMessage;

/**
 * One hand's four DexPilot keypoints off the wire, in the robot's hand frame.
 *
 * All four or none: a partial hand would have the retargeter matching three
 * vectors against a fourth point that is a stale frame old, which shows up as a
 * finger that lags the others rather than as an error anybody would notice.
 */
function parseHandKeypoints(value: unknown): HandKeypoints | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const point = (key: string): [number, number, number] | null => {
    const v = raw[key];
    if (!Array.isArray(v) || v.length !== 3) return null;
    if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const p = v as [number, number, number];
    // A fingertip half a metre from the wrist is not a fingertip.
    if (Math.hypot(p[0], p[1], p[2]) > 0.5) return null;
    return p;
  };
  const wrist = point('wrist');
  const thumb = point('thumb');
  const index = point('index');
  const middle = point('middle');
  if (!wrist || !thumb || !index || !middle) return null;
  return { wrist, thumb, index, middle };
}

/**
 * The frames that move something. Everything else — `estop`, `bind`, and any
 * frame this socket does not recognise — is never lease-gated.
 */
const MOTION_KEYS = [
  'posture', 'preset', 'move', 'wrists', 'hands', 'positions', 'position', 'direction', 'delta',
] as const;

/** A `{move}` of all zeros, or `{preset:'stop'}` — a stop is never gated. */
function isStopFrame(msg: object): boolean {
  const m = msg as { move?: { vx?: unknown; vy?: unknown; omega?: unknown }; preset?: unknown };
  if (m.preset === 'stop') return true;
  if (!m.move || typeof m.move !== 'object') return false;
  const zero = (v: unknown): boolean => v === undefined || v === 0;
  return zero(m.move.vx) && zero(m.move.vy) && zero(m.move.omega);
}

/**
 * Why a pose frame moved nothing (TASK-407). Every `{wrists}` / `{positions}`
 * frame is answered — with `{type:'state', positions}` when an arm followed, or
 * with `{type:'state', held:true, side, reason}` when none did.
 *
 * WHY EVERY FRAME. The client measures its LINK from the answers, and every
 * refusal path used to return in silence: an unclutched side, a closed arm gate,
 * a side the re-engage latch had not released, an IK solve that held. A refused
 * arm therefore read as a dead network in the headset — LINK stale, LINK lost,
 * the link-lost buzz — for as long as the operator held a grip the robot was
 * refusing. A refusal is an answer, so it is sent as one.
 *
 * - `unclutched` — the pose named only sides whose clutch is open (real robot).
 * - `arm_gate` — the arm gate is closed: no heartbeat, the clutch never
 *   reported, or the sidecar refused the claim.
 * - `not_armed` — the gate is open but this console has not made the clutch
 *   rising edge the re-engage latch needs.
 * - `side_refused` — the offered side may not drive (its clutch is not engaged).
 * - `ik_held` — the solver held the previous pose (unusable or unseeded target),
 *   or this robot has no arm chain to solve.
 * - `estop` — an E-stop is latched.
 * - `lease` — this socket is not bound to the control lease.
 */
export type TeleopHeldReason =
  | 'unclutched'
  | 'arm_gate'
  | 'not_armed'
  | 'side_refused'
  | 'ik_held'
  | 'estop'
  | 'lease';

export type TeleopHeldSide = 'left' | 'right' | 'both';

/** `{type:'state', held:true, ...}` — the answer to a pose frame that moved nothing. */
export interface TeleopHeldFrame {
  type: 'state';
  held: true;
  side: TeleopHeldSide;
  reason: TeleopHeldReason;
}

/**
 * The fastest the held answers go out, per socket, in ms (20 Hz).
 *
 * The rig streams at 20 Hz, so this is one answer per pose frame in steady
 * state. A burst faster than that (two pose frames in one tick) is coalesced:
 * the newest refusal waits for the slot and goes out on the next tick, so no
 * frame is left without an answer for longer than one tick.
 */
export const HELD_ANSWER_MIN_INTERVAL_MS = 50;

/** Which sides a pose frame offered: the non-null keys, or `both`. */
export function offeredSide(sides: Record<string, unknown> | null | undefined): TeleopHeldSide {
  const left = sides?.left != null;
  const right = sides?.right != null;
  if (left && !right) return 'left';
  if (right && !left) return 'right';
  return 'both';
}

/** Which sides a `{positions}` frame touches, from its joint names. */
export function positionsSide(positions: Record<string, unknown>): TeleopHeldSide {
  const names = Object.keys(positions);
  const left = names.some((n) => n.startsWith('left_'));
  const right = names.some((n) => n.startsWith('right_'));
  if (left && !right) return 'left';
  if (right && !left) return 'right';
  return 'both';
}

/** The `{type:'base'}` frame (TASK-398 adds the measured mode and the gate). */
export interface BaseFrame {
  type: 'base';
  /** The base is in a non-locomoting FSM — measured when fresh, else commanded. */
  damped: boolean;
  fsmId: number | null;
  /** The measured mode, `unknown` when the sidecar has no fresh reading. */
  mode: BaseModeName;
  /** `mode`/`fsmId` come from a fresh sidecar reading, not from a command. */
  measured: boolean;
  /** The sidecar would execute `{move}`; false = do not send it at all. */
  moveEnabled: boolean;
  /** Whether the robot's mode can be changed from NeoDEM (`off` when not). */
  modeControl: 'off' | 'fsm' | 'full';
}

/** Build the base frame from the measured mode, the gate and the agent's record. */
export function baseFrame(agent: { damped: boolean; lastFsmId: number | null }): BaseFrame {
  const capability = hardwareClient.getLocoCapability();
  const measuredId = hardwareClient.getMeasuredFsmId();
  const reading = hardwareClient.getBaseState();
  const measured = measuredId !== null && reading !== null;
  const mode: BaseModeName = measured ? reading.mode : 'unknown';
  return {
    type: 'base',
    damped: measured ? mode === 'limp' || mode === 'zero_torque' : agent.damped,
    fsmId: measured ? measuredId : agent.lastFsmId,
    mode,
    measured,
    moveEnabled: hardwareClient.mayMoveBase(),
    modeControl: capability.gate === 'fsm' || capability.gate === 'full' ? capability.gate : 'off',
  };
}

/** What makes two base frames different enough to send again. */
function baseFrameKey(f: BaseFrame): string {
  return `${f.damped}|${f.fsmId}|${f.mode}|${f.measured}|${f.moveEnabled}|${f.modeControl}`;
}

/** Injected so this module does not import the Agent Mode controller. */
export interface KeyboardTeleopDeps {
  /**
   * Re-arm a damped base, on behalf of the operator who already holds control.
   *
   * Optional because three of the four test harnesses build this server with a
   * state manager alone; a socket without it answers `{posture:'stand'}` with
   * `stand_unavailable` rather than pretending.
   */
  standBase?: () => Promise<{ ok: boolean; error?: string }>;
  /** The control-lease registry (TASK-314). Defaults to the process singleton. */
  controlLease?: ControlLeaseRegistry;
  /**
   * Whether motion needs a bound control lease (`CONTROL_LEASE_REQUIRED`).
   * Read once per connection; defaults to `config.controlLease.required`.
   */
  leaseRequired?: () => boolean;
  /** Who holds the sidecar armed (TASK-393). Defaults to the process singleton. */
  armRegistry?: ArmRegistry;
  /** The arm dead-man, in ms. Defaults to HEARTBEAT_TIMEOUT_MS. */
  heartbeatTimeoutMs?: number;
}

export function createKeyboardTeleopWebSocket(
  robotStateManager: RobotStateManager,
  deps: KeyboardTeleopDeps = {},
): WebSocketServer {
  // noServer: upgrades are routed by the shared dispatcher in index.ts.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  console.log('[KeyboardTeleop] WebSocket server ready on path: /ws/keyboard-teleop');

  wss.on('connection', (ws: WebSocket) => {
    console.log('[KeyboardTeleop] Client connected');

    /**
     * TASK-315: with `CONTROL_LEASE_REQUIRED` on, a socket is an OBSERVER until
     * it binds to the installed control lease — it claims nothing, preempts
     * nobody and enables no teleop on connect. Read once: a flag that flipped
     * under an open socket would leave it half in each world.
     */
    const leaseRequired = (deps.leaseRequired ?? (() => config.controlLease.required))();
    const leases = deps.controlLease ?? controlLease;
    const arms = deps.armRegistry ?? defaultArmRegistry;
    const heartbeatTimeoutMs = deps.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
    /** This socket's name in the arm registry. */
    const armClaimId = `keyboard-teleop:${randomUUID()}`;
    /**
     * Whether this socket has ever bound a lease. A socket that took the lease
     * stays lease-gated after losing it, flag or no flag: an operator whose
     * control was revoked must not keep driving just because the agent was
     * started without `CONTROL_LEASE_REQUIRED`.
     */
    let everBound = false;
    const leaseGated = (): boolean => leaseRequired || everBound;
    /** Whether THIS socket holds one `teleop` holder on `controlOwnerLock`. */
    let holdsTeleop = false;

    let positions: Record<string, number>;
    let claim: { preempted?: string } = {};
    if (!leaseRequired) {
      // TASK-194 arbitration: a human at the controls outranks every autonomous
      // owner. The claim always succeeds; Agent Mode reacts to the preemption by
      // aborting its running plan.
      claim = controlOwnerLock.claim('teleop');
      holdsTeleop = true;
      if (claim.preempted) {
        console.warn(`[KeyboardTeleop] Preempted ${claim.preempted} — human teleop takes over`);
      }
      // Enter teleop mode — joints now follow operator input instead of animation.
      positions = robotStateManager.enableTeleop();
    } else {
      positions = robotStateManager.getTeleopPositions();
    }
    const joints = robotStateManager.getActiveJointConfig();
    /**
     * Whether a single-joint frame for `name` can reach the robot (TASK-421).
     * Everything can where nothing needs arming; on an arm-only G1 sidecar
     * only the arms and the fingers of a hand it commands.
     */
    const jointDrivable = (name: string): boolean =>
      !arms.requiresArming()
      || !isG1Family(robotStateManager.getState().robotType)
      || isG1ForwardableJoint(name, arms.view().hands);
    /**
     * The drivable set as last told to this client. It changes under an open
     * socket: the readiness panel takes control (opening this socket) while the
     * sidecar is still read-only, and only then switches it to arm control, so
     * the `config` frame alone would advertise all 43 joints as drivable for
     * the whole session (TASK-421 review).
     */
    let drivableKey = '';
    const drivableMap = (): Record<string, boolean> =>
      Object.fromEntries(joints.map((j) => [j.name, jointDrivable(j.name)]));
    /** Push `{type:'drivable'}` when the set differs from what the client has. */
    const sendDrivableIfChanged = (): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const map = drivableMap();
      const key = JSON.stringify(map);
      if (key === drivableKey) return;
      drivableKey = key;
      ws.send(JSON.stringify({ type: 'drivable', joints: map }));
    };

    // Advertise the embodiment so the client can build controls for any robot.
    drivableKey = JSON.stringify(drivableMap());
    ws.send(JSON.stringify({
      type: 'config',
      robotType: robotStateManager.getState().robotType,
      joints: joints.map((j) => ({
        name: j.name,
        limitLower: j.limitLower,
        limitUpper: j.limitUpper,
        defaultPosition: j.defaultPosition,
        // TASK-421: false for a joint the arm-only write path never commands,
        // so the console can start on (and steer to) one that moves.
        drivable: jointDrivable(j.name),
      })),
      positions,
    }));

    if (!leaseRequired) {
      // The claim result used to be computed, logged and dropped. The operator
      // who just took the robot away from Agent Mode is entitled to know they
      // did — and to know they hold it, rather than inferring ownership from
      // the robot happening to respond.
      ws.send(JSON.stringify({
        type: 'control',
        owner: controlOwnerLock.get(),
        preempted: claim.preempted ?? null,
      }));
    } else {
      // `observe()` carries no secret — it is what `GET …/control-lease` shows.
      ws.send(JSON.stringify({
        type: 'lease',
        state: 'unbound',
        required: true,
        holder: leases.observe(),
      }));
    }

    /**
     * Whether the latch was set the last time the tick looked, so the transition
     * can be pushed rather than polled.
     *
     * The `{type:'estop'}` reply used to be sent from ONE place: the handler for
     * this socket's own `{estop}` message. So a console only ever learned about
     * a latch it had caused itself. Every other way a robot latches — the fleet
     * console, a zone trigger, another operator, or the safety monitor deciding
     * on its own (a flat battery raises 'Critical battery level', which
     * `checkSystemHealth` treats as a system failure) — left this client
     * displaying "Stream armed" over a robot that was discarding its every
     * command. That is the precise failure this whole channel exists to
     * prevent, so the state is now sent on connect and on both edges.
     */
    let wasEStopped = robotStateManager.isEStopTriggered();
    const sendEStopState = (latched: boolean): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const state = robotStateManager.getEStopState();
      ws.send(JSON.stringify({
        type: 'estop',
        active: latched,
        reason: latched ? state.reason ?? 'an emergency stop is latched' : null,
      }));
    };
    sendEStopState(wasEStopped);

    /**
     * Whether the base is sitting in a non-locomoting FSM, on the same
     * connect-and-both-edges contract as the E-Stop above and for the same
     * reason.
     *
     * An E-Stop DAMPS the base (`agentModeController.estop()` sends
     * `SetFsmId(1)` after StopMove), and clearing the latch deliberately does
     * not undo that — standing a collapsed humanoid back up is an explicit
     * operator action, never a side effect of a UI click. So the state after
     * every stop-and-reset is: arms work, base does not. The arms work because
     * they are joint targets and never touch the loco FSM.
     *
     * Nothing said so. `SetVelocity` answers RPC_OK in a damped FSM and the
     * base simply does not integrate it, so no error reached the client, the
     * HUD went on reading `SPEED 0.00`, and the operator was left pushing a
     * stick at a robot that had no intention of walking.
     */
    //
    // TASK-398: the frame also carries the MEASURED mode and what the sidecar
    // allows — `moveEnabled: false` tells the client to stop sending `{move}`
    // at all (head turns, thumbsticks) on a robot whose sidecar only changes
    // modes, and `modeControl` whether the mode panel applies.
    let lastBaseKey = '';
    const sendBaseState = (): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const frame = baseFrame(robotStateManager.getAgentSafetyState());
      lastBaseKey = baseFrameKey(frame);
      ws.send(JSON.stringify(frame));
    };
    sendBaseState();

    // Per-joint angular velocity (rad/s) for currently-held keys.
    const velocity = new Map<string, number>();

    /**
     * Codes already pushed on THIS socket. Generalises the old single
     * `moveFailedOnce` latch: a robot with no locomotion sidecar would
     * otherwise emit ten frames a second for as long as someone leans on the
     * stick, but two DIFFERENT failures must not hide each other the way one
     * boolean made them.
     */
    const errorsSent = new Set<TeleopErrorCode>();
    const sendError = (code: TeleopErrorCode, message: string): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (errorsSent.has(code)) return;
      errorsSent.add(code);
      ws.send(JSON.stringify({ type: 'error', code, message, at: new Date().toISOString() }));
    };

    // Failures on the 50 Hz pose stream happen inside the state manager, which
    // has no socket. This is how they reach the person wearing the headset.
    const unsubscribeTeleopErrors = robotStateManager.onTeleopError((err) => {
      sendError(err.code, err.message);
    });

    // ---- the arm write path (TASK-393) -------------------------------------
    /**
     * When this socket last sent `{hb}`, as `Date.now()`. `null` until the
     * first one: a client that never heartbeats (an older app, a script) keeps
     * the behaviour it always had — but it cannot ARM a real robot's arms.
     */
    let lastHeartbeatAt: number | null = null;
    /** The dead-man fired and no heartbeat has arrived since. */
    let heartbeatLost = false;
    const heartbeatFresh = (): boolean =>
      lastHeartbeatAt !== null && !heartbeatLost && Date.now() - lastHeartbeatAt <= heartbeatTimeoutMs;

    /**
     * The clutch rising edge arming needs (see `teleop/reengage.ts`). Every
     * disarm this socket did not ask for — E-stop, heartbeat loss, lease loss,
     * the sidecar's own dead-man or 409, a refused `/arm` — sends it back to
     * `need_release`, so the arms never come back on a grip that was already
     * held. Enforced HERE, on the agent's side of the socket: a client cannot
     * talk its way past it by streaming harder.
     */
    const reengage = new ReengageLatch();
    /** Arming is impossible right now; an edge seen meanwhile does not count. */
    const armBlocked = (): boolean =>
      robotStateManager.isEStopTriggered()
      || arms.view().estopLatched
      || boundGeneration === null
      || !heartbeatFresh();
    /** React to a change of the latch: give the arms back, tell the client. */
    const onEngageChange = (before: ReengageState, reason: string): void => {
      if (before === 'holding') {
        // An `/arm` the sidecar refused lands here too (the claim went dead
        // without arming): its words are the one thing the operator can act on.
        const refused = arms.view().lastError;
        if (refused && !arms.isLive()) sendError('arm_failed', `the sidecar refused to arm: ${refused}`);
        arms.release(armClaimId, reason);
        console.warn(`[KeyboardTeleop] arms handed back (${reason}) — a fresh clutch press is needed to re-arm`);
      }
      // Re-sent per state: "release first" and "now squeeze" are two messages.
      errorsSent.delete('arm_reengage_required');
      sendArmState(arms.view());
    };
    /** Advance the latch on the current facts. True when it changed. */
    const syncEngage = (): boolean => {
      if (!arms.requiresArming()) return false;
      const before = reengage.update(armBlocked(), arms.has(armClaimId) && arms.isLive());
      if (before === null) return false;
      onEngageChange(before, 'the arms were handed back without the operator letting go');
      return true;
    };
    /** A disarm the operator did not cause, raised by a path that knows why. */
    const latchReengage = (reason: string): void => {
      const before = reengage.latch();
      if (before !== null) onEngageChange(before, reason);
    };

    /**
     * May a JOINT frame be applied? On a sidecar that needs no arming (the sim,
     * SO-101, an older sidecar) always yes. On an arm-only sidecar the socket
     * must hold the control lease, be heartbeating, and have made a clutch
     * rising edge since the last disarm it did not cause; then it claims the
     * arms — the first claim arms the sidecar, ramping in from the measured
     * pose. A refused frame is DISCARDED, not applied to the view: a target
     * that drifted away while nothing could move the robot would be the first
     * thing the robot was sent once something could.
     */
    /**
     * Why `armGate` last returned false — what the held answer to that frame
     * says (TASK-407). Only read right after a false return.
     */
    let gateRefusal: TeleopHeldReason = 'arm_gate';
    const armGate = (): boolean => {
      gateRefusal = 'arm_gate';
      if (!arms.requiresArming()) return true;
      if (boundGeneration === null) {
        gateRefusal = 'lease';
        sendError(
          'arm_requires_lease',
          'this robot\'s arms only take commands from the console that holds its control lease — take control first',
        );
        return false;
      }
      if (!heartbeatFresh()) {
        sendError(
          'arm_requires_heartbeat',
          'this console sends no live heartbeat, so it may not drive the real arms — reload the app (or check the link)',
        );
        return false;
      }
      // Said as itself rather than as "release the grip": no grip fixes a latch.
      if (arms.view().estopLatched) {
        gateRefusal = 'estop';
        sendError(
          'arm_estop_latched',
          'the sidecar\'s E-stop is latched — reset the E-stop before driving the arms',
        );
        return false;
      }
      syncEngage();
      if (reengage.state === 'holding') {
        // Already this socket's: a map lookup on an armed sidecar.
        const result = arms.claim(armClaimId, boundGeneration);
        if (result.state === 'refused') {
          sendError(result.code, result.message);
          latchReengage(`arm refused: ${result.code}`);
          return false;
        }
        return true;
      }
      if (reengage.clutch === null) {
        sendError(
          'arm_requires_clutch',
          'this console does not report its grip clutch, so it may not arm the real robot\'s arms — reload the app',
        );
        return false;
      }
      if (!reengage.mayArm()) {
        gateRefusal = 'not_armed';
        sendError(
          'arm_reengage_required',
          reengage.state === 'need_release'
            ? 'release the grip, then squeeze it again to arm — the arms never re-arm on a grip that was already held'
            : 'squeeze the grip to arm the robot\'s arms',
        );
        return false;
      }
      const result = arms.claim(armClaimId, boundGeneration);
      if (result.state === 'refused') {
        sendError(result.code, result.message);
        latchReengage(`arm refused: ${result.code}`);
        return false;
      }
      reengage.held();
      errorsSent.delete('arm_reengage_required');
      sendArmState(arms.view());
      return true;
    };

    /**
     * Refuse a single-joint frame for a joint the arm-only write path never
     * commands (TASK-421), before it can arm anything. Answered on every
     * refused press, like `home_unavailable`: a press is a deliberate act.
     */
    const refuseUndrivable = (joint: unknown): boolean => {
      if (typeof joint !== 'string' || jointDrivable(joint)) return false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'joint_not_drivable' satisfies TeleopErrorCode,
          message: `${joint} is not driven on this robot — only the arms and the fingers of a hand `
            + 'with live state take commands; select an arm joint',
          at: new Date().toISOString(),
        }));
      }
      return true;
    };

    /**
     * On a real robot only a side whose clutch is closed is driven. A tracked
     * hand reports no clutch, so it never drives the real arms or fingers.
     * Returns whether ANY offered side may drive; tells the client once about a
     * side that may not.
     */
    const clutchedSideOffered = (frame: Record<string, unknown>): boolean => {
      if (!arms.requiresArming()) return true;
      const offered = (['left', 'right'] as const).filter((side) => frame[side] != null);
      if (offered.some((side) => !reengage.sideEngaged(side))) {
        sendError(
          'arm_side_unclutched',
          'a pose arrived for a hand whose grip is not held — tracked hands cannot drive the real robot; use the controllers',
        );
      }
      return offered.some((side) => reengage.sideEngaged(side));
    };
    const sideMayDrive = (side: 'left' | 'right'): boolean =>
      !arms.requiresArming() || reengage.sideEngaged(side);

    /** Push the arm path's state to this client: armed, weight, which hands, its latch. */
    const sendArmState = (view: ReturnType<ArmRegistry['view']>): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // A refusal is a past fact once the arms are actually up.
      if (view.armed) {
        errorsSent.delete('arm_failed');
        errorsSent.delete('arm_estop_latched');
      }
      ws.send(JSON.stringify({
        type: 'arm',
        ...view,
        mine: arms.has(armClaimId),
        engage: reengage.state,
        clutch: reengage.clutch,
      }));
      // The write mode or the commanded hands may have changed what moves.
      sendDrivableIfChanged();
    };
    const unsubscribeArm = arms.subscribe(sendArmState);
    sendArmState(arms.view());

    // --- base motion -------------------------------------------------------
    // One in-flight `SetVelocity` at a time. The sidecar call is an RPC that can
    // block for the duration of the motion, and a 10 Hz stick would otherwise
    // stack requests until the queue, not the operator, decided where the robot
    // went.
    /** Set by `cleanup`. Declared here because `drive`'s drain guard reads it. */
    let cleanedUp = false;
    /**
     * When the client last asked for motion, as `Date.now()`. `0` means never.
     *
     * The ramp below refreshes the dead-man TTL ON ITS OWN, so without this the
     * agent kept accelerating a robot whose operator had already gone quiet.
     */
    let lastMoveAt = 0;
    let moveInFlight = false;
    /**
     * Latest-wins slot for a command that arrived while one was in flight.
     *
     * Dropping the tick outright (what this replaced) is harmless for a
     * MID-stream sample — the next one carries the current stick position. It
     * is not harmless for the LAST one, and the last one of a burst is the
     * STOP: the client sends exactly one zero and then goes quiet, so a zero
     * dropped here is never re-sent by anybody, and `locoMove`'s own timeout is
     * `duration + 5 s`. The robot kept walking until the TTL expired.
     *
     * Exactly one slot, overwritten: the newest command always eventually goes
     * out, and the intermediates are discarded rather than replayed — replaying
     * them would let a queue decide where the robot goes, which is the thing
     * the in-flight guard exists to prevent.
     */
    let pendingMove: { velocity: BaseVelocity; ttlS: number } | null = null;
    // Whether THIS socket has ever commanded motion. Only a driver's departure
    // stops the robot — a keyboard tab closing must not halt a VR operator
    // mid-stride.
    let hasDriven = false;
    /** Last velocity handed to the sidecar — where the ramp starts from. */
    let commanded: BaseVelocity = ZERO_VELOCITY;
    /** Where the stick is, while the ramp is still catching up to it. */
    let rampTarget: BaseVelocity | null = null;

    /** True when a velocity would actually move the robot. */
    const isMoving = (v: BaseVelocity): boolean => v.vx !== 0 || v.vy !== 0 || v.omega !== 0;

    /** Wire values are never trusted: anything non-finite is a zero, not a NaN. */
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const clamp = (v: unknown, limit: number): number =>
      Math.max(-limit, Math.min(limit, num(v)));

    /** Once per socket, not once per tick — see `errorsSent`. */
    let errorsWarned = false;

    // ---- inverse kinematics (TASK-216) ------------------------------------
    // Per socket, not module-level: the warm start and the rate limiter are one
    // operator's arm state, and a second console connecting must not inherit a
    // stranger's. `controlOwnerLock` already decides who is allowed to drive.
    const wristTeleop = new WristTeleop(robotStateManager);
    const fingers = new Map<Side, FingerRetargeter>();
    const fingerSeed = new Map<Side, number[]>();
    /**
     * When tracked fingers last drove each hand.
     *
     * A TIMESTAMP and not "is there a retargeter for this side", which is what
     * this was first written as. The retargeter is created on the first
     * `{hands}` message and never destroyed, so an operator who tried hand
     * tracking once — found it dropped out, as Quest hand tracking does, and
     * went back to the controllers — had the trigger silently ignored on that
     * hand for the rest of the session, with the fingers frozen wherever the
     * last tracked frame left them. The condition is meant to be live.
     */
    const handsSeenAt = new Map<Side, number>();
    /**
     * How long a hand goes on counting as tracked, in ms.
     *
     * Comfortably more than the 50 ms stream interval, so ordinary jitter never
     * hands the fingers back and forth, and short enough that letting go of
     * hand tracking gives the trigger back within a couple of frames.
     */
    const HANDS_STALE_MS = 500;
    const handsDriving = (side: Side): boolean => {
      const at = handsSeenAt.get(side);
      return at !== undefined && Date.now() - at < HANDS_STALE_MS;
    };
    /** Cached per socket: the embodiment does not change mid-session. */
    let armCapable: boolean | null = null;
    let handCapable: boolean | null = null;

    const hasJoints = (names: readonly string[]): boolean => {
      const config = new Set(robotStateManager.getActiveJointConfig().map((j) => j.name));
      return names.every((n) => config.has(n));
    };
    /**
     * Whether this robot has arms the chain table describes.
     *
     * Asked of the JOINT CONFIG rather than of the robot type, so an embodiment
     * that grows G1 arms under another name works and one that calls itself a
     * G1 without them is refused instead of being sent commands for joints it
     * does not have.
     */
    const canSolveArms = (): boolean => {
      if (armCapable === null) {
        armCapable = (['left', 'right'] as const).every(
          (side) => hasJoints(G1_ARM_CHAINS[side].links.map((l) => l.joint)),
        );
      }
      return armCapable;
    };
    const canSolveFingers = (): boolean => {
      if (handCapable === null) {
        handCapable = (['left', 'right'] as const).every((side) =>
          (['thumb', 'index', 'middle'] as const).every(
            (f) => hasJoints(G1_FINGER_CHAINS[side][f].links.map((l) => l.joint)),
          ),
        );
      }
      return handCapable;
    };

    // ---- control lease (TASK-315) ------------------------------------------
    // Everything below is inert while `leaseRequired` is false: `mayDrive`
    // answers true, nothing subscribes, and a `{bind}` frame is ignored.

    /** The lease generation this socket is bound to, or null while unbound. */
    let boundGeneration: number | null = null;
    /** The raw secret it bound with — kept in memory only, to re-`verify`. */
    let boundLeaseId: string | null = null;
    /** A bind awaiting its preemption stop; a second one meanwhile is dropped. */
    let binding = false;

    /**
     * Whether a motion frame may be processed NOW.
     *
     * Asked at processing time, not cached at bind time: `verify` is also the
     * registry's lazy expiry check, so a lease past its deadline flips to
     * `expired` right here, the listener below unbinds this socket, and the
     * frame that asked is discarded.
     */
    const mayDrive = (): boolean => {
      if (!leaseGated()) return true;
      if (boundGeneration === null || boundLeaseId === null) return false;
      return leases.verify(boundLeaseId, boundGeneration);
    };

    /**
     * Keep the registry's `bound` count equal to the sockets bound to
     * `generation` — every window the holder has open, keyboard AND bilateral
     * (the counter is shared through `socket-binding.ts`, TASK-316).
     */
    const adjustBound = (generation: number, delta: number): void =>
      adjustBoundCount(leases, generation, delta);

    /** Give back THIS socket's `teleop` holder, if it has one. */
    const releaseHolder = (): void => {
      if (!holdsTeleop) return;
      holdsTeleop = false;
      controlOwnerLock.release('teleop');
      if (!controlOwnerLock.isOwnedBy('teleop')) {
        robotStateManager.disableTeleop();
      }
    };

    /** Forget every motion this socket had queued or was integrating. */
    const haltMotion = (): void => {
      velocity.clear();
      rampTarget = null;
      commanded = ZERO_VELOCITY;
      pendingMove = null;
      wristTeleop.reset();
      for (const retargeter of fingers.values()) retargeter.reset();
      fingerSeed.clear();
      handsSeenAt.clear();
    };

    /** Drop the binding; `state` is what the client is told, null to say nothing. */
    const unbind = (state: 'revoked' | 'expired' | null): void => {
      if (boundGeneration === null) return;
      const generation = boundGeneration;
      boundGeneration = null;
      boundLeaseId = null;
      haltMotion();
      // Lease lost: the arms go back to the robot's own controller (TASK-393).
      arms.release(armClaimId, state ? `lease ${state}` : 'lease replaced');
      adjustBound(generation, -1);
      releaseHolder();
      if (state && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'lease', state, generation }));
      }
    };

    /** One zero-TTL stop, fire-and-forget; a failure is logged, never thrown. */
    const stopBase = (): void => {
      const fail = (err: unknown): void => {
        console.warn(`[KeyboardTeleop] fence stop failed: ${err instanceof Error ? err.message : String(err)}`);
      };
      // Issued synchronously, inside the fence event, so it is on the wire
      // before anything the successor sends.
      try {
        void hardwareClient.locoMove(0, 0, 0, 0).catch(fail);
      } catch (err) {
        fail(err);
      }
    };

    /**
     * Fence: the lease this socket drives under was replaced, released or ran
     * out. Stop the base now — the pending slot is already cleared by
     * `unbind`, so a `move` queued behind an in-flight RPC never goes out —
     * and do NOT rebind: the client has to present the new lease itself.
     */
    // Subscribed whatever the flag says: a socket that bound voluntarily is
    // fenced exactly like one that had to (TASK-393). Inert while unbound.
    const unsubscribeLease = leases.subscribe((event: LeaseEvent) => {
      if (event.type !== 'fenced' && event.type !== 'expired') return;
      if (boundGeneration === null || event.generation !== boundGeneration) return;
      stopBase();
      unbind(event.type === 'fenced' ? 'revoked' : 'expired');
    });

    const sendLeaseInvalid = (message: string): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: 'error',
        code: 'lease_invalid' satisfies TeleopErrorCode,
        message,
        at: new Date().toISOString(),
      }));
    };

    /**
     * `{bind:{leaseId, generation}}`: become a driver under the installed lease.
     *
     * Several sockets may bind the same generation (the holder's other
     * windows); each is one `teleop` holder. Binding is what preempts Agent
     * Mode or a VLA rollout — and when it does, the zero-velocity stop is
     * AWAITED before `bound` is sent, so the operator's first `move` never
     * races the autonomous owner's last one.
     */
    const handleBind = async (raw: BindMessage['bind']): Promise<void> => {
      const leaseId = raw && typeof raw === 'object' ? raw.leaseId : undefined;
      const generation = raw && typeof raw === 'object' ? raw.generation : undefined;
      if (typeof leaseId !== 'string' || typeof generation !== 'number' || !Number.isInteger(generation)) {
        sendLeaseInvalid('bind needs {leaseId: string, generation: integer}');
        return;
      }
      if (binding) return;
      if (!leases.verify(leaseId, generation)) {
        sendLeaseInvalid('that lease is not the installed, held control lease for this robot');
        return;
      }
      if (boundGeneration === generation && boundLeaseId === leaseId) {
        // Already bound to exactly this lease — idempotent, no second holder.
        ws.send(JSON.stringify({ type: 'lease', state: 'bound', generation }));
        return;
      }
      // A different, valid generation while bound means the old one is gone.
      unbind(null);

      binding = true;
      try {
        // Without `CONTROL_LEASE_REQUIRED` the socket already took a `teleop`
        // holder on connect; a second one would leave the lock held after it
        // closes.
        const bindClaim: { preempted?: string } = holdsTeleop ? {} : controlOwnerLock.claim('teleop');
        holdsTeleop = true;
        if (bindClaim.preempted) {
          console.warn(`[KeyboardTeleop] Bind preempted ${bindClaim.preempted} — human teleop takes over`);
          try {
            await hardwareClient.locoMove(0, 0, 0, 0);
          } catch (err) {
            console.warn(`[KeyboardTeleop] preemption stop failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // The socket closed, or the lease was fenced, while the stop was out.
        if (cleanedUp || !leases.verify(leaseId, generation)) {
          releaseHolder();
          if (!cleanedUp) sendLeaseInvalid('the control lease changed while binding');
          return;
        }
        boundGeneration = generation;
        boundLeaseId = leaseId;
        everBound = true;
        adjustBound(generation, +1);
        const bindPositions = robotStateManager.enableTeleop();
        errorsSent.delete('lease_required');
        errorsSent.delete('arm_requires_lease');
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'lease', state: 'bound', generation }));
        ws.send(JSON.stringify({
          type: 'control',
          owner: controlOwnerLock.get(),
          preempted: bindClaim.preempted ?? null,
        }));
        ws.send(JSON.stringify({ type: 'state', positions: bindPositions }));
      } finally {
        binding = false;
      }
    };

    const drive = async (vx: number, vy: number, omega: number, ttlS: number): Promise<void> => {
      // TASK-398: a sidecar that only changes modes (G1_LOCO_ENABLED=fsm) or
      // has locomotion off refuses every velocity. Treat it as idle: no HTTP
      // call, no log line, one sticky error per socket — head turns and
      // thumbsticks in a headset would otherwise post ten refusals a second.
      if (!hardwareClient.mayMoveBase()) {
        sendError(
          'loco_disabled',
          'base walking is disabled on this robot (the sidecar changes modes only) — head turns and thumbsticks do not move it',
        );
        return;
      }
      if (moveInFlight) {
        pendingMove = { velocity: { vx, vy, omega }, ttlS };
        return;
      }
      moveInFlight = true;
      try {
        const res = await hardwareClient.locoMove(vx, vy, omega, ttlS);
        if (!res.ok) {
          sendError(
            res.locoDisabled ? 'loco_disabled' : 'loco_unavailable',
            res.error ?? 'the locomotion sidecar refused the command',
          );
          if (!errorsWarned) {
            errorsWarned = true;
            console.warn(`[KeyboardTeleop] base motion unavailable: ${res.error ?? 'refused'}`);
          }
        }
      } finally {
        moveInFlight = false;
        const next = pendingMove;
        pendingMove = null;
        // A PENDING VELOCITY IS A PAST INTENT, AND `locoMove` MAY BLOCK FOR
        // SECONDS (the sidecar's timeout is `duration + 5s`). Everything that
        // cancels motion — the latch, the socket closing — could therefore be
        // OVERTAKEN by a walk command that was already in the slot when it
        // happened, re-armed with a fresh TTL. Two real shapes:
        //
        //   1. The latch goes up somewhere else (fleet console, safety monitor,
        //      a second operator) while an RPC is stalled. Later `{move}`s are
        //      correctly refused — and then the stalled call returns and this
        //      drain issues the walk anyway.
        //   2. The socket closes. `cleanup` sends its zero, then this drain
        //      re-commands the walk behind it — the dead-man defeated at the
        //      exact moment nobody is watching.
        //
        // A pending ZERO is always delivered: that is a stop, and a stop is
        // never stale. Only motion is dropped.
        const stillMotion = next !== null && isMoving(next.velocity);
        if (next && !(stillMotion && (cleanedUp || robotStateManager.isEStopTriggered() || !mayDrive()))) {
          void drive(next.velocity.vx, next.velocity.vy, next.velocity.omega, next.ttlS);
        }
      }
    };

    /** Record what we are commanding, then send it. */
    const issueBase = (v: BaseVelocity, ttlS: number): void => {
      commanded = v;
      void drive(v.vx, v.vy, v.omega, ttlS);
    };

    const dt = TICK_MS / 1000;

    /**
     * True when the input must be thrown away because the robot is latched.
     * Sends the reason once, so the client can grey its controls out instead of
     * showing an operator a robot that ignores them for no visible reason.
     */
    const refusedByEStop = (): boolean => {
      if (!robotStateManager.isEStopTriggered()) return false;
      // Anything still held would resume the instant the latch cleared.
      velocity.clear();
      rampTarget = null;
      // `commanded` too, and this is the half that was missing. Only the
      // socket's own `{estop}` handler used to zero it, so an E-Stop raised
      // ANYWHERE ELSE — the fleet console, the safety monitor, a zone trigger,
      // another teleop socket — left `commanded` holding the pre-stop velocity
      // for the whole latch. The first `{move}` after the reset then hit
      // `slewBaseVelocity`'s `speedTo <= speedFrom` shortcut and went out at the
      // full pre-stop speed in one step, bypassing MAX_LINEAR_ACCEL_MPS2
      // entirely. The robot is standing still during a latch; `commanded` has to
      // say so, or the ramp starts from a speed that no longer exists.
      commanded = ZERO_VELOCITY;
      // And the pending slot, for the same reason: a velocity queued behind a
      // blocked RPC is a past intent, and the drain would otherwise deliver it
      // after the stop.
      pendingMove = null;
      // The solver's warm start and rate limiter describe an arm that is about
      // to be stopped where it stands. Keeping them would let the first pose
      // after the reset resume a trajectory the operator abandoned during the
      // latch, at the full rate allowance, from a stale seed.
      wristTeleop.reset();
      for (const retargeter of fingers.values()) retargeter.reset();
      fingerSeed.clear();
      handsSeenAt.clear();
      sendError('estop_latched', 'an emergency stop is latched — reset it before driving');
      return true;
    };

    // ---- held answers (TASK-407) -------------------------------------------
    /** When the last held answer went out, as `Date.now()`. */
    let lastHeldAt = -Infinity;
    /** A refusal waiting for the 20 Hz slot; flushed by the tick. */
    let pendingHeld: TeleopHeldFrame | null = null;

    const sendState = () => {
      // A real answer supersedes a refusal still waiting for its slot.
      pendingHeld = null;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'state', positions: robotStateManager.getTeleopPositions() }));
      }
    };

    const flushHeld = (frame: TeleopHeldFrame): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      lastHeldAt = Date.now();
      ws.send(JSON.stringify(frame));
    };
    /**
     * Answer a pose frame that moved nothing. See `TeleopHeldReason`: without
     * this the client cannot tell a refused arm from a dead link.
     */
    const answerHeld = (side: TeleopHeldSide, reason: TeleopHeldReason): void => {
      const frame: TeleopHeldFrame = { type: 'state', held: true, side, reason };
      if (Date.now() - lastHeldAt >= HELD_ANSWER_MIN_INTERVAL_MS) {
        pendingHeld = null;
        flushHeld(frame);
        return;
      }
      pendingHeld = frame;
    };

    // Integrate held-key motion, and advance the base ramp, at a fixed tick.
    const timer = setInterval(() => {
      // A coalesced held answer goes out as soon as its slot opens (TASK-407).
      if (pendingHeld && Date.now() - lastHeldAt >= HELD_ANSWER_MIN_INTERVAL_MS) {
        const frame = pendingHeld;
        pendingHeld = null;
        flushHeld(frame);
      }
      // The arm dead-man runs before everything else in the tick, latch or not.
      if (lastHeartbeatAt !== null && !heartbeatLost && Date.now() - lastHeartbeatAt > heartbeatTimeoutMs) {
        heartbeatLost = true;
        haltMotion();
        arms.release(armClaimId, 'heartbeat lost');
        if (hasDriven) stopBase();
        console.warn(`[KeyboardTeleop] no heartbeat for ${heartbeatTimeoutMs} ms — motion halted, arm claim released`);
        sendError(
          'heartbeat_lost',
          `no heartbeat from this console for ${(heartbeatTimeoutMs / 1000).toFixed(1)} s — the arms were handed back `
            + 'to the robot. Once the link is back, release the grip and squeeze it again to re-arm.',
        );
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat', state: 'lost' }));
      }
      // Edge-detect the latch in both directions, so a client that is sitting
      // still still learns the robot stopped, and learns when it may drive
      // again without having to poke it to find out.
      const latched = robotStateManager.isEStopTriggered();
      if (latched !== wasEStopped) {
        wasEStopped = latched;
        sendEStopState(latched);
        // Stopped from anywhere: this socket no longer holds the arms.
        if (latched) arms.release(armClaimId, 'E-stop latched');
      }
      // The re-engage latch (TASK-393): every blocker and every disarm the
      // operator did not cause lands here within one tick.
      syncEngage();
      // Read every tick, not only around `{posture}`: the base can be damped by
      // an E-Stop raised anywhere, by Agent Mode, or by another console, and a
      // client that only learned about its own commands would show a stale
      // "walking is fine" to an operator whose robot had been damped from the
      // fleet page.
      if (baseFrameKey(baseFrame(robotStateManager.getAgentSafetyState())) !== lastBaseKey) {
        sendBaseState();
      }
      if (latched) {
        velocity.clear();
        rampTarget = null;
        // See `refusedByEStop`: a latched robot is a stopped robot, so the ramp
        // must start from zero when it is cleared.
        commanded = ZERO_VELOCITY;
        return;
      }
      // The latch has cleared. `estop_latched` is the one code in `errorsSent`
      // that describes a TRANSIENT condition, and leaving it in the set meant a
      // second latch on the same long-lived VR session — latch, reset, latch —
      // produced no frame at all, so the client had no signal whatsoever that
      // its input was being discarded the second time. The genuinely sticky
      // codes (`loco_disabled`, `unknown_joints`) stay latched for the socket.
      errorsSent.delete('estop_latched');
      // A held key or a ramp still catching up is motion too: under a lease
      // it runs only while the binding still verifies (lazy expiry included).
      if (leaseGated() && (velocity.size > 0 || rampTarget) && !mayDrive()) {
        haltMotion();
        return;
      }
      // Held-key joint motion is integrated by `jointTimer` below (TASK-421).

      // The ramp rides the tick that already exists rather than a second timer.
      // It runs only while the commanded speed is still below the stick — at
      // steady state `rampTarget` is null and the client's own ~10 Hz `{move}`
      // stream is the only thing refreshing the TTL, so this adds no RPC rate.
      if (rampTarget) {
        // THE RAMP MUST NOT OUTLIVE THE OPERATOR. `issueBase` refreshes
        // `MOVE_TTL_S` on every tick it runs, so a single `{move}` from a
        // hard-pushed stick followed by silence — Wi-Fi gone, headset off, tab
        // throttled, which are the exact cases `MOVE_TTL_S` exists for — had the
        // agent accelerating the robot to full walk speed BY ITSELF for half a
        // second, then coasting the TTL on top. Roughly a quarter of a metre of
        // unattended travel, against a documented promise that the robot coasts
        // to a stop within the window.
        //
        // A ramp is only ever the tail of a live stick, so once the client has
        // gone quiet for longer than the dead-man, abandon it: the sidecar's own
        // TTL has already stopped the robot, and `commanded` has to agree or the
        // next ramp starts from a speed that no longer exists.
        if (Date.now() - lastMoveAt > MOVE_TTL_S * 1000) {
          rampTarget = null;
          commanded = ZERO_VELOCITY;
        } else {
          const next = slewBaseVelocity(commanded, rampTarget, dt);
          if (next.vx === rampTarget.vx && next.vy === rampTarget.vy) rampTarget = null;
          issueBase(next, MOVE_TTL_S);
        }
      }
    }, TICK_MS);

    /** When the client last reported a CLOSED clutch, as `Date.now()` (TASK-421). */
    let lastClutchClosedAt = 0;
    /** When a moving joint's pose was last echoed to the client. */
    let lastEchoAt = -Infinity;

    /**
     * Integrate held-key joint motion at the forwarder's rate (TASK-421, see
     * JOINT_TICK_MS). Every gate the housekeeping tick enforces is checked here
     * as well, because this runs between its beats; the housekeeping tick
     * remains the one that clears state and tells the client.
     */
    const jointTimer = setInterval(() => {
      if (velocity.size === 0) return;
      if (robotStateManager.isEStopTriggered() || heartbeatLost) return;
      if (lastHeartbeatAt !== null && Date.now() - lastHeartbeatAt > heartbeatTimeoutMs) return;
      if (leaseGated() && !mayDrive()) return;
      // A held key on an arm-only sidecar that disarmed itself (its dead-man,
      // a 409 `not_armed`) would keep integrating a target nothing is sending,
      // and the next frame's re-arm would ship the whole drift at once — the
      // arm swinging toward a joint limit after the key was let go. The key is
      // dropped instead; pressing it again re-arms from the measured pose.
      if (!arms.isLive()) {
        velocity.clear();
        return;
      }
      // A client that reports its clutch moves a joint only while it keeps
      // saying the key is held: a tab that froze or a link that dropped stops
      // the joint after HELD_KEY_TTL_MS, and the arm holds where it is.
      if (reengage.clutch !== null
        && (!reengage.engaged || Date.now() - lastClutchClosedAt > HELD_KEY_TTL_MS)) return;
      let moved = false;
      for (const [joint, vel] of velocity) {
        if (vel !== 0) {
          robotStateManager.applyTeleopDelta(joint, (vel * JOINT_TICK_MS) / 1000);
          moved = true;
        }
      }
      if (moved && Date.now() - lastEchoAt >= STATE_ECHO_MS) {
        lastEchoAt = Date.now();
        sendState();
      }
    }, JOINT_TICK_MS);

    /**
     * Liveness probe. Nothing is sent while an operator holds still, so without
     * this a dead NAT binding and a motionless operator look identical from
     * both ends — the socket stays "open" for minutes while the robot has no
     * driver. Unref'd: a teleop ping must never hold the process open.
     */
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, KEEPALIVE_MS);
    keepalive.unref?.();

    ws.on('message', (data: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      // A SYNTACTICALLY VALID FRAME IS NOT AN OBJECT. `null`, `123` and `"x"`
      // all parse cleanly, and every branch below reaches for `'key' in msg` —
      // which throws `TypeError: Cannot use 'in' operator` on any of them. The
      // try/catch above only guards the parse, the throw escaped the
      // `ws.on('message')` handler, and nothing in this process installs an
      // `uncaughtException` handler: one three-byte frame on an unauthenticated
      // socket killed the agent that is driving the robot.
      if (typeof parsed !== 'object' || parsed === null) return;
      const msg = parsed as TeleopMessage;

      // FIRST, and never gated: an E-Stop request is honoured even when one is
      // already latched.
      if ('estop' in msg) {
        const reason = typeof msg.estop?.reason === 'string' && msg.estop.reason.trim()
          ? msg.estop.reason.trim()
          : 'operator E-Stop from the teleop client';
        velocity.clear();
        rampTarget = null;
        commanded = ZERO_VELOCITY;
        // Anything already queued behind a blocked RPC is cancelled here too,
        // rather than left for the drain to deliver after the stop.
        pendingMove = null;
        // TASK-398 order. FIRST the latch, whose actuation sends the sidecar's
        // `/estop` synchronously — the sidecar latches, starts the arm disarm
        // ramp and THEN damps the robot, in one process. `triggeredBy:
        // 'remote'` — the human is at a headset somewhere else, the same source
        // the fleet's `POST /safety/estop` records. This is the durable latch:
        // it survives a reboot and needs a deliberate reset.
        void robotStateManager.triggerEmergencyStop('remote', reason);
        // Zero the base velocity only where the sidecar walks (the sim): DIRECT,
        // bypassing `drive`'s in-flight guard and its pending slot, because it
        // must not wait behind an RPC that may block for seconds. A sidecar
        // that only changes modes gets no call.
        if (hardwareClient.mayMoveBase()) void hardwareClient.locoMove(0, 0, 0, 0);
        // Then this agent's own arm bookkeeping (the sidecar is already
        // disarming): the registry drops every holder.
        arms.releaseAll('operator E-stop');
        robotStateManager.disableTeleop();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'estop', active: true, reason }));
        }
        return;
      }

      if ('bind' in msg) {
        void handleBind(msg.bind);
        return;
      }

      // Never gated: liveness is what un-gates everything else.
      if ('hb' in msg) {
        lastHeartbeatAt = Date.now();
        errorsSent.delete('arm_requires_heartbeat');
        if (heartbeatLost) {
          heartbeatLost = false;
          errorsSent.delete('heartbeat_lost');
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat', state: 'live' }));
        }
        const clutch = parseClutch((msg as HeartbeatMessage).clutch);
        if (clutch !== null && (clutch.left || clutch.right)) lastClutchClosedAt = Date.now();
        // A clutch reported open lets go of every held joint (TASK-421 review):
        // a key-up that named the wrong joint, or never arrived, must not leave
        // a velocity behind for the next press to set moving again.
        if (clutch !== null && !clutch.left && !clutch.right) velocity.clear();
        const clutchChanged = clutch !== null && reengage.report(clutch);
        if (clutch !== null) errorsSent.delete('arm_requires_clutch');
        // A beat that recovers a lost link is not an edge: `syncEngage` saw the
        // stale heartbeat as a blocker, so the latch is already `need_release`.
        if (!syncEngage() && clutchChanged && arms.requiresArming()) sendArmState(arms.view());
        return;
      }

      // Admission (TASK-315): every motion frame is checked HERE, when it is
      // processed — never against a binding cached at some earlier point.
      const isMotion = MOTION_KEYS.some((k) => k in msg);
      // The side a pose frame offered, for its held answer (TASK-407).
      const poseSide: TeleopHeldSide | null =
        'wrists' in msg && msg.wrists && typeof msg.wrists === 'object'
          ? offeredSide(msg.wrists as Record<string, unknown>)
          : 'positions' in msg && msg.positions && typeof msg.positions === 'object'
            ? positionsSide(msg.positions as Record<string, unknown>)
            : null;
      if (leaseGated() && isMotion && !mayDrive()) {
        sendError('lease_required', 'this socket is not bound to the robot\'s control lease — acquire one and send {bind}');
        if (poseSide) answerHeld(poseSide, 'lease');
        return;
      }
      // A heartbeating client that went quiet does not get to drive on the
      // frames that still trickle in (TASK-393). A `move` zero is a stop and is
      // let through below like it always was.
      if (isMotion && heartbeatLost && !isStopFrame(msg)) {
        if (poseSide) answerHeld(poseSide, 'arm_gate');
        return;
      }

      // ---- stand the base back up ------------------------------------------
      // A LOCOMOTION command, so it lives on the socket that carries the other
      // ones rather than behind a REST call. That is not a style choice: the
      // only other route to this FSM is Agent Mode's `posture stand`, and Agent
      // Mode refuses every command while `controlOwnerLock` is held by teleop —
      // which it is, for as long as this socket is open. An operator in a
      // headset therefore had to LEAVE the session to re-arm the base and then
      // come back, and nothing in the headset told them so.
      //
      // Gated by the latch like every other motion command: a robot is damped
      // after an E-Stop precisely because somebody stopped it.
      if ('posture' in msg) {
        if (msg.posture !== 'stand') {
          sendError('bad_posture', `unknown posture ${JSON.stringify(msg.posture)}; only "stand" is offered here`);
          return;
        }
        if (refusedByEStop()) return;
        if (!deps.standBase) {
          sendError('stand_unavailable', 'this agent was built without a base-posture path');
          return;
        }
        void deps.standBase().then((result) => {
          if (!result.ok) {
            sendError('stand_failed', result.error ?? 'the locomotion sidecar refused to stand the base');
            return;
          }
          // Report the OUTCOME, not the request. `lastBaseKey` is updated here
          // so the tick's edge detector does not send a second, identical frame.
          sendBaseState();
        }).catch((error: unknown) => {
          sendError('stand_failed', error instanceof Error ? error.message : String(error));
        });
        return;
      }

      if ('preset' in msg) {
        velocity.clear();
        if (msg.preset === 'stop') {
          // `stop` used to clear the held-key map and nothing else, so the
          // panic button on a WALKING robot left it walking — the base was
          // never told, and the next `{move}` re-armed the TTL. It stops the
          // base now, with a zero TTL like the release-stop.
          rampTarget = null;
          issueBase(ZERO_VELOCITY, 0);
          sendState();
          return;
        }
        // ONLY `home` HOMES. This was `if (preset === 'stop') … else home`, so
        // every other value on an unauthenticated socket — `{preset:'reset'}`,
        // `{preset:''}`, `{preset:42}` — commanded a full-body move of all 43
        // joints to their default pose. The declared type is `'home' | 'stop'`;
        // a wire value is not a type.
        if (msg.preset !== 'home') return;
        if (refusedByEStop()) return;
        // A real G1's arms (TASK-393): the all-zeros "home" is a large swing
        // forward, not a rest pose. Refused on every press, never deduplicated.
        if (arms.requiresArming()) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              code: 'home_unavailable',
              message: 'Home is disabled on the real robot\'s arms — end teleop to hand them back to the robot\'s own controller',
              at: new Date().toISOString(),
            }));
          }
          return;
        }
        if (!armGate()) return;
        // Homing is a large commanded motion, so it is gated like any other.
        robotStateManager.homeTeleopJoints();
        sendState();
        return;
      }

      if ('move' in msg && msg.move && typeof msg.move === 'object') {
        const planar = clampPlanar(num(msg.move.vx), num(msg.move.vy), MAX_LINEAR_MPS);
        const omega = clamp(msg.move.omega, MAX_ANGULAR_RAD_S);
        const target: BaseVelocity = { vx: planar.vx, vy: planar.vy, omega };
        const stopping = target.vx === 0 && target.vy === 0 && target.omega === 0;
        // The stop half runs BEFORE the latch check: a zero is always allowed
        // through, latched or not.
        if (!stopping && refusedByEStop()) return;
        // A stick returning to centre is sent as zeros and forwarded as zeros,
        // rather than left to expire: waiting out MOVE_TTL_S would let the robot
        // drift on after the operator let go, which is the one moment they are
        // most likely to be stopping for a reason.
        if (!stopping) {
          hasDriven = true;
          lastMoveAt = Date.now();
        }
        const next = slewBaseVelocity(commanded, target, dt);
        rampTarget = next.vx === target.vx && next.vy === target.vy ? null : target;
        issueBase(next, stopping ? 0 : MOVE_TTL_S);
        return;
      }

      // ---- wrist poses: solve arm IK here (TASK-216) ----------------------
      if ('wrists' in msg && msg.wrists && typeof msg.wrists === 'object') {
        const offered = poseSide ?? 'both';
        if (refusedByEStop()) {
          answerHeld(offered, 'estop');
          return;
        }
        if (!clutchedSideOffered(msg.wrists as Record<string, unknown>)) {
          answerHeld(offered, 'unclutched');
          return;
        }
        if (!armGate()) {
          answerHeld(offered, gateRefusal);
          return;
        }
        if (!canSolveArms()) {
          sendError(
            'ik_unsupported',
            'this robot has no G1 arm chain — stream {positions} instead of {wrists}',
          );
          answerHeld(offered, 'ik_held');
          return;
        }
        let solved = false;
        /** Sides that moved nothing, and why — for the held answer. */
        const refusedSides: Array<{ side: 'left' | 'right'; reason: TeleopHeldReason }> = [];
        for (const side of ['left', 'right'] as const) {
          const target = parseWristPose(msg.wrists[side]);
          // A missing side is a hand that is not driving, and an UNUSABLE side
          // is a hand whose tracking just dropped. Both hold: the arm stays
          // where it is rather than snapping to a default or to the other
          // hand's pose. Decision 4 of TASK-216 — a failed solve holds the
          // previous pose, and never quietly reverts to orientation mapping
          // in the middle of a recorded demonstration.
          if (!target) continue;
          // A real robot's arm follows only a clutched side (TASK-393).
          if (!sideMayDrive(side)) {
            refusedSides.push({ side, reason: 'side_refused' });
            continue;
          }
          const report = wristTeleop.solve(side, target);
          if (!report.held) solved = true;
          else refusedSides.push({ side, reason: 'ik_held' });

          // The trigger, as one grasp axis. Only when finger tracking is not
          // driving this hand — otherwise the two would fight over the same
          // seven joints at the stream rate, and the loser would be whichever
          // message happened to arrive second.
          const grip = (msg.wrists[side] as { grip?: unknown } | null)?.grip;
          if (typeof grip === 'number' && Number.isFinite(grip) && !handsDriving(side)
            && canSolveFingers()) {
            for (const [joint, angle] of Object.entries(gripPose(side, grip))) {
              robotStateManager.setTeleopJoint(joint, angle);
            }
          }
        }
        if (solved) {
          markTeleopMode('ik');
          sendState();
        } else {
          // Nothing moved: say why rather than going silent (TASK-407).
          const side: TeleopHeldSide = refusedSides.length === 1 ? refusedSides[0]!.side : offered;
          const reason: TeleopHeldReason = refusedSides.some((r) => r.reason === 'side_refused')
            ? 'side_refused'
            : 'ik_held';
          answerHeld(side, reason);
        }
        return;
      }

      // ---- tracked fingertips: DexPilot retargeting here -------------------
      if ('hands' in msg && msg.hands && typeof msg.hands === 'object') {
        if (refusedByEStop()) return;
        if (!clutchedSideOffered(msg.hands as Record<string, unknown>)) return;
        if (!armGate()) return;
        if (!canSolveFingers()) {
          sendError(
            'ik_unsupported',
            'this robot has no Dex3 hands — finger retargeting has nothing to drive',
          );
          return;
        }
        let moved = false;
        for (const side of ['left', 'right'] as const) {
          const keypoints = parseHandKeypoints(msg.hands[side]);
          if (!keypoints) continue;
          if (!sideMayDrive(side)) continue;
          let retargeter = fingers.get(side);
          if (!retargeter) {
            retargeter = new FingerRetargeter(side);
            fingers.set(side, retargeter);
          }
          const result = retargeter.solve(keypoints, fingerSeed.get(side) ?? null);
          if (!result.q.every((v) => Number.isFinite(v))) continue;
          fingerSeed.set(side, result.q);
          handsSeenAt.set(side, Date.now());
          const names = retargeter.jointNames();
          for (let i = 0; i < names.length; i++) {
            // Same clamp as every other path: `setTeleopJoint` owns the limits.
            robotStateManager.setTeleopJoint(names[i]!, result.q[i]!);
          }
          moved = true;
        }
        if (moved) {
          markTeleopMode('hand-tracking');
          sendState();
        }
        return;
      }

      if ('positions' in msg && msg.positions && typeof msg.positions === 'object') {
        const offered = poseSide ?? 'both';
        if (refusedByEStop()) {
          answerHeld(offered, 'estop');
          return;
        }
        if (!armGate()) {
          answerHeld(offered, gateRefusal);
          return;
        }
        // Pose stream (e.g. WebXR / Meta Quest): absolute targets for many joints.
        const unknown: string[] = [];
        for (const [joint, position] of Object.entries(msg.positions)) {
          if (typeof position !== 'number') continue;
          if (robotStateManager.setTeleopJoint(joint, position) === null) unknown.push(joint);
        }
        if (unknown.length > 0) {
          // Worth a frame of its own: the sim rejects the WHOLE pose over one
          // unknown name, so a client built against the wrong embodiment gets a
          // robot that never moves and no explanation anywhere.
          sendError(
            'unknown_joints',
            `this robot has no joint(s): ${unknown.join(', ')}`,
          );
        }
        // Joint angles the CLIENT computed. For the VR rig that is the
        // orientation mapping in `vrRetarget.ts`; the recorder needs to be able
        // to tell those demonstrations apart from IK-solved ones.
        markTeleopMode('orientation');
        sendState();
        return;
      }

      if ('position' in msg && typeof msg.position === 'number') {
        if (refusedByEStop()) return;
        if (refuseUndrivable(msg.joint)) return;
        if (!armGate()) return;
        // Absolute target for a single joint (radians).
        robotStateManager.setTeleopJoint(msg.joint, msg.position);
        markTeleopMode('manual');
        sendState();
        return;
      }

      if ('direction' in msg && typeof msg.direction === 'number') {
        if (refusedByEStop()) return;
        // A key let go is a stop, and a stop never needs the arms.
        if (msg.direction !== 0 && refuseUndrivable(msg.joint)) return;
        if (msg.direction !== 0 && !armGate()) return;
        // Held-key motion: set (or clear) the joint's velocity.
        markTeleopMode('manual');
        if (msg.direction === 0) {
          velocity.delete(msg.joint);
        } else {
          // A clutch-reporting console (the keyboard) holds one key on one
          // joint (TASK-421 review): a press drops whatever an earlier press
          // left moving, whose key-up may have named another joint after the
          // selection moved mid-hold. A console without a clutch (the gamepad)
          // drives several joints at once and keeps them.
          if (reengage.clutch !== null) velocity.clear();
          velocity.set(msg.joint, msg.direction * SLEW_RATE_RAD_PER_S);
        }
        return;
      }

      if ('delta' in msg && typeof msg.delta === 'number') {
        if (refusedByEStop()) return;
        if (refuseUndrivable(msg.joint)) return;
        if (!armGate()) return;
        // One-shot nudge (radians).
        robotStateManager.applyTeleopDelta(msg.joint, msg.delta);
        markTeleopMode('manual');
        sendState();
      }
    });

    // 'error' is normally followed by 'close', and a socket must never release
    // more holders of the lock than the one it claimed — that is what let a
    // second view's disconnect free a lock a live operator was still holding.
    // (`cleanedUp` is declared with the rest of this socket's lifetime state
    // above, because `drive`'s drain guard reads it.)
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(timer);
      clearInterval(jointTimer);
      clearInterval(keepalive);
      unsubscribeTeleopErrors();
      // Stop the base before anything else. `MOVE_TTL_S` would get there on its
      // own, but only after a walking robot has covered another third of a
      // second of floor — and the socket closing is exactly the case where
      // nobody is watching any more. Direct, for the same reason the E-Stop is:
      // this must not sit in the pending slot behind a blocked RPC.
      if (hasDriven) void hardwareClient.locoMove(0, 0, 0, 0);
      // The arms too: the last socket out hands them back to the robot.
      arms.release(armClaimId, 'teleop socket closed');
      unsubscribeArm();
      unsubscribeLease();
      if (boundGeneration !== null) {
        const generation = boundGeneration;
        boundGeneration = null;
        boundLeaseId = null;
        adjustBound(generation, -1);
      }
      // Only a holder this socket actually took: an unbound observer under
      // `CONTROL_LEASE_REQUIRED` claimed nothing and must release nothing.
      // Teleop is active only while an operator is connected — but "an
      // operator" can be several sockets at once (keyboard tab + VR view +
      // gamepad). Only the LAST one leaves teleop mode and resumes the idle
      // animation; otherwise one closing view yanks the joints out from under
      // a human still driving from another.
      releaseHolder();
    };

    ws.on('close', () => {
      console.log('[KeyboardTeleop] Client disconnected');
      cleanup();
    });

    ws.on('error', (error) => {
      console.error('[KeyboardTeleop] WebSocket error:', error);
      cleanup();
    });
  });

  return wss;
}
