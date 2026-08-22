/**
 * @file keyboard-teleop.ts
 * @description WebSocket endpoint for keyboard-based teleoperation of the
 *              simulated robot. Embodiment-aware: drives the active robot's
 *              joints (SO-101, G1, G1-EDU, …) through the RobotStateManager's
 *              simulated joint state — no hardware sidecar required.
 * @feature teleop
 * @status live
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { RobotStateManager } from '../robot/state.js';
import { controlOwnerLock } from '../agent-mode/control-owner.js';
import { hardwareClient } from '../hardware/HardwareClient.js';
import { config } from '../config/config.js';

/** How fast a held joint moves, in radians per second. */
const SLEW_RATE_RAD_PER_S = 0.8;
/** Integration tick for held-key motion (~30 Hz). */
const TICK_MS = 33;
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
 */
export type TeleopErrorCode =
  | 'loco_unavailable'
  | 'loco_disabled'
  | 'action_rejected'
  | 'sidecar_down'
  | 'estop_latched'
  | 'unknown_joints';

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
type TeleopMessage =
  | DirectionMessage
  | DeltaMessage
  | PositionMessage
  | PoseMessage
  | PresetMessage
  | MoveMessage
  | EStopMessage;

export function createKeyboardTeleopWebSocket(
  robotStateManager: RobotStateManager
): WebSocketServer {
  // noServer: upgrades are routed by the shared dispatcher in index.ts.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  console.log('[KeyboardTeleop] WebSocket server ready on path: /ws/keyboard-teleop');

  wss.on('connection', (ws: WebSocket) => {
    console.log('[KeyboardTeleop] Client connected');

    // TASK-194 arbitration: a human at the controls outranks every autonomous
    // owner. The claim always succeeds; Agent Mode reacts to the preemption by
    // aborting its running plan.
    const claim = controlOwnerLock.claim('teleop');
    if (claim.preempted) {
      console.warn(`[KeyboardTeleop] Preempted ${claim.preempted} — human teleop takes over`);
    }

    // Enter teleop mode — joints now follow operator input instead of animation.
    const positions = robotStateManager.enableTeleop();
    const joints = robotStateManager.getActiveJointConfig();

    // Advertise the embodiment so the client can build controls for any robot.
    ws.send(JSON.stringify({
      type: 'config',
      robotType: robotStateManager.getState().robotType,
      joints: joints.map((j) => ({
        name: j.name,
        limitLower: j.limitLower,
        limitUpper: j.limitUpper,
        defaultPosition: j.defaultPosition,
      })),
      positions,
    }));

    // The claim result used to be computed, logged and dropped. The operator
    // who just took the robot away from Agent Mode is entitled to know they
    // did — and to know they hold it, rather than inferring ownership from the
    // robot happening to respond.
    ws.send(JSON.stringify({
      type: 'control',
      owner: controlOwnerLock.get(),
      preempted: claim.preempted ?? null,
    }));

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

    const drive = async (vx: number, vy: number, omega: number, ttlS: number): Promise<void> => {
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
        if (next && !(stillMotion && (cleanedUp || robotStateManager.isEStopTriggered()))) {
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
      sendError('estop_latched', 'an emergency stop is latched — reset it before driving');
      return true;
    };

    const sendState = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'state', positions: robotStateManager.getTeleopPositions() }));
      }
    };

    // Integrate held-key motion, and advance the base ramp, at a fixed tick.
    const timer = setInterval(() => {
      // Edge-detect the latch in both directions, so a client that is sitting
      // still still learns the robot stopped, and learns when it may drive
      // again without having to poke it to find out.
      const latched = robotStateManager.isEStopTriggered();
      if (latched !== wasEStopped) {
        wasEStopped = latched;
        sendEStopState(latched);
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
      let moved = false;
      for (const [joint, vel] of velocity) {
        if (vel !== 0) {
          robotStateManager.applyTeleopDelta(joint, vel * dt);
          moved = true;
        }
      }
      if (moved) sendState();

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
        // DIRECT, deliberately bypassing `drive`'s in-flight guard and its
        // pending slot. Everything else may be coalesced; this may not be
        // delayed behind an RPC that is allowed to block for seconds, and it is
        // the one message that must never be dropped.
        void hardwareClient.locoMove(0, 0, 0, 0);
        // `triggeredBy: 'remote'` — the human is at a headset somewhere else,
        // the same source the fleet's `POST /safety/estop` records. This is the
        // durable latch: it survives a reboot and needs a deliberate reset.
        robotStateManager.triggerEmergencyStop('remote', reason);
        robotStateManager.disableTeleop();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'estop', active: true, reason }));
        }
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

      if ('positions' in msg && msg.positions && typeof msg.positions === 'object') {
        if (refusedByEStop()) return;
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
        sendState();
        return;
      }

      if ('position' in msg && typeof msg.position === 'number') {
        if (refusedByEStop()) return;
        // Absolute target for a single joint (radians).
        robotStateManager.setTeleopJoint(msg.joint, msg.position);
        sendState();
        return;
      }

      if ('direction' in msg && typeof msg.direction === 'number') {
        if (refusedByEStop()) return;
        // Held-key motion: set (or clear) the joint's velocity.
        velocity.set(msg.joint, msg.direction * SLEW_RATE_RAD_PER_S);
        return;
      }

      if ('delta' in msg && typeof msg.delta === 'number') {
        if (refusedByEStop()) return;
        // One-shot nudge (radians).
        robotStateManager.applyTeleopDelta(msg.joint, msg.delta);
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
      clearInterval(keepalive);
      unsubscribeTeleopErrors();
      // Stop the base before anything else. `MOVE_TTL_S` would get there on its
      // own, but only after a walking robot has covered another third of a
      // second of floor — and the socket closing is exactly the case where
      // nobody is watching any more. Direct, for the same reason the E-Stop is:
      // this must not sit in the pending slot behind a blocked RPC.
      if (hasDriven) void hardwareClient.locoMove(0, 0, 0, 0);
      controlOwnerLock.release('teleop');
      // Teleop is active only while an operator is connected — but "an
      // operator" can be several sockets at once (keyboard tab + VR view +
      // gamepad). Only the LAST one leaves teleop mode and resumes the idle
      // animation; otherwise one closing view yanks the joints out from under
      // a human still driving from another.
      if (!controlOwnerLock.isOwnedBy('teleop')) {
        robotStateManager.disableTeleop();
      }
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
