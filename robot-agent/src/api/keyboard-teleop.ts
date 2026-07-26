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

/** How fast a held joint moves, in radians per second. */
const SLEW_RATE_RAD_PER_S = 0.8;
/** Integration tick for held-key motion (~30 Hz). */
const TICK_MS = 33;

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
type TeleopMessage =
  | DirectionMessage
  | DeltaMessage
  | PositionMessage
  | PoseMessage
  | PresetMessage;

export function createKeyboardTeleopWebSocket(
  robotStateManager: RobotStateManager
): WebSocketServer {
  // noServer: upgrades are routed by the shared dispatcher in index.ts.
  const wss = new WebSocketServer({ noServer: true });

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

    // Per-joint angular velocity (rad/s) for currently-held keys.
    const velocity = new Map<string, number>();
    const dt = TICK_MS / 1000;

    const sendState = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'state', positions: robotStateManager.getTeleopPositions() }));
      }
    };

    // Integrate held-key motion at a fixed tick.
    const timer = setInterval(() => {
      let moved = false;
      for (const [joint, vel] of velocity) {
        if (vel !== 0) {
          robotStateManager.applyTeleopDelta(joint, vel * dt);
          moved = true;
        }
      }
      if (moved) sendState();
    }, TICK_MS);

    ws.on('message', (data: Buffer) => {
      let msg: TeleopMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if ('preset' in msg) {
        velocity.clear();
        if (msg.preset === 'home') robotStateManager.homeTeleopJoints();
        sendState();
        return;
      }

      if ('positions' in msg && msg.positions && typeof msg.positions === 'object') {
        // Pose stream (e.g. WebXR / Meta Quest): absolute targets for many joints.
        for (const [joint, position] of Object.entries(msg.positions)) {
          if (typeof position === 'number') robotStateManager.setTeleopJoint(joint, position);
        }
        sendState();
        return;
      }

      if ('position' in msg && typeof msg.position === 'number') {
        // Absolute target for a single joint (radians).
        robotStateManager.setTeleopJoint(msg.joint, msg.position);
        sendState();
        return;
      }

      if ('direction' in msg && typeof msg.direction === 'number') {
        // Held-key motion: set (or clear) the joint's velocity.
        velocity.set(msg.joint, msg.direction * SLEW_RATE_RAD_PER_S);
        return;
      }

      if ('delta' in msg && typeof msg.delta === 'number') {
        // One-shot nudge (radians).
        robotStateManager.applyTeleopDelta(msg.joint, msg.delta);
        sendState();
      }
    });

    // 'error' is normally followed by 'close', and a socket must never release
    // more holders of the lock than the one it claimed — that is what let a
    // second view's disconnect free a lock a live operator was still holding.
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(timer);
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
