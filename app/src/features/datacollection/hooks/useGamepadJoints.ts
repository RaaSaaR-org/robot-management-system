/**
 * @file useGamepadJoints.ts
 * @description Browser Gamepad API → keyboard-teleop WS forwarder for the
 *              SO-101 record page. Provides a controller fallback for
 *              operators who don't have a leader arm or want to drive the
 *              follower with a gamepad while recording. Uses the same
 *              `/ws/keyboard-teleop` velocity-mode protocol as
 *              `KeyboardTeleopSection` so the sidecar handles both inputs
 *              identically.
 * @feature datacollection
 */

import { useEffect, useRef } from 'react';
import type { Robot } from '../../robots/types/robots.types';

interface UseGamepadJointsArgs {
  robot: Robot | null;
  enabled: boolean;
}

/** Stick deadzone — anything below this magnitude is treated as zero. */
const DEADZONE = 0.25;

/**
 * Map a normalised stick axis (-1..1) to a velocity-mode direction.
 * The sidecar's keyboard-teleop loop expects -1, 0, or +1 (it ramps the
 * actual joint position internally at 20 Hz).
 */
function axisToDirection(value: number): -1 | 0 | 1 {
  if (value > DEADZONE) return 1;
  if (value < -DEADZONE) return -1;
  return 0;
}

interface JointDirections {
  shoulder_pan: -1 | 0 | 1;
  shoulder_lift: -1 | 0 | 1;
  elbow_flex: -1 | 0 | 1;
  wrist_flex: -1 | 0 | 1;
  wrist_roll: -1 | 0 | 1;
  gripper: -1 | 0 | 1;
}

const ZERO: JointDirections = {
  shoulder_pan: 0,
  shoulder_lift: 0,
  elbow_flex: 0,
  wrist_flex: 0,
  wrist_roll: 0,
  gripper: 0,
};

/**
 * Standard XInput-style mapping (Xbox / PS layouts via the browser remap):
 *
 *   Left stick   X → shoulder_pan
 *   Left stick   Y → shoulder_lift  (inverted: pushing up = positive lift)
 *   Right stick  X → wrist_roll
 *   Right stick  Y → elbow_flex     (inverted)
 *   Left/Right trigger → wrist_flex (LT = -1, RT = +1)
 *   A button   → gripper +1 (close)
 *   B button   → gripper -1 (open)
 */
function readGamepad(gp: Gamepad): JointDirections {
  const ax = gp.axes;
  const btn = gp.buttons;
  return {
    shoulder_pan:  axisToDirection(ax[0] ?? 0),
    shoulder_lift: axisToDirection(-(ax[1] ?? 0)),
    wrist_roll:    axisToDirection(ax[2] ?? 0),
    elbow_flex:    axisToDirection(-(ax[3] ?? 0)),
    wrist_flex: ((): -1 | 0 | 1 => {
      const lt = btn[6]?.value ?? 0;
      const rt = btn[7]?.value ?? 0;
      if (rt > 0.3) return 1;
      if (lt > 0.3) return -1;
      return 0;
    })(),
    gripper: ((): -1 | 0 | 1 => {
      if (btn[0]?.pressed) return 1;
      if (btn[1]?.pressed) return -1;
      return 0;
    })(),
  };
}

function getWsBaseUrl(robot: Robot): string {
  // 41243 is the robot agent's default port; this fallback read 41245, a port
  // nothing listens on.
  const agent = robot.a2aAgentUrl?.replace(/\/$/, '') ?? 'http://localhost:41243';
  try {
    const url = new URL(agent);
    return `ws://${url.hostname}:8766`;
  } catch {
    return agent.replace(/^http/, 'ws');
  }
}

/**
 * Forward gamepad input to the sidecar's keyboard-teleop WebSocket while
 * `enabled` is true. Opens the WS on enable, polls the gamepad at ~20 Hz
 * (matching the sidecar's velocity loop), and only sends a message when a
 * joint's direction actually changes — keeps the WS quiet at idle.
 */
export function useGamepadJoints({ robot, enabled }: UseGamepadJointsArgs): void {
  const wsRef = useRef<WebSocket | null>(null);
  const lastRef = useRef<JointDirections>(ZERO);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !robot) return;

    let stopped = false;
    const ws = new WebSocket(`${getWsBaseUrl(robot)}/ws/keyboard-teleop`);
    wsRef.current = ws;
    lastRef.current = ZERO;

    const send = (joint: keyof JointDirections, direction: -1 | 0 | 1) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ joint, direction }));
    };

    let lastTick = 0;
    const tick = (now: number) => {
      if (stopped) return;
      // ~20 Hz to match the sidecar's velocity loop
      if (now - lastTick >= 50) {
        lastTick = now;
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = Array.from(pads).find((p): p is Gamepad => p !== null);
        if (gp) {
          const next = readGamepad(gp);
          const last = lastRef.current;
          (Object.keys(next) as Array<keyof JointDirections>).forEach((joint) => {
            if (next[joint] !== last[joint]) {
              send(joint, next[joint]);
            }
          });
          lastRef.current = next;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // Stop everything before closing so the follower doesn't drift after
      // the operator releases the controller.
      if (ws.readyState === WebSocket.OPEN) {
        (Object.keys(ZERO) as Array<keyof JointDirections>).forEach((joint) => {
          ws.send(JSON.stringify({ joint, direction: 0 }));
        });
      }
      ws.close();
      wsRef.current = null;
    };
  }, [robot, enabled]);
}
