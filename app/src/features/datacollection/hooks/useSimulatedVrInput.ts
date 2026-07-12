/**
 * @file useSimulatedVrInput.ts
 * @description Synthetic VR input driver for testing without a headset.
 *              Connects to the robot agent's /ws/keyboard-teleop WebSocket,
 *              waits for the `config` message (joint names + limits), then
 *              streams smooth sinusoidal pick-and-place-like motion as
 *              `{positions}` batches at ~16 Hz: phase-offset left/right
 *              reach cycles over the arm joints plus hand open/close, all
 *              clamped to the advertised joint limits.
 * @feature datacollection
 */

import { useEffect, useRef, useState } from 'react';
import type { Robot } from '../../robots/types/robots.types';

export type SimInputStatus = 'disconnected' | 'connecting' | 'streaming';

interface JointConfig {
  name: string;
  limitLower: number;
  limitUpper: number;
  defaultPosition: number;
}

interface UseSimulatedVrInputArgs {
  robot: Robot | null;
  enabled: boolean;
}

/** Full reach/grasp cycle duration (seconds) — slow, plausible pick-and-place. */
const CYCLE_S = 8;
/** Stream rate (~16 Hz, comparable to the real VR rig's ~20 Hz). */
const TICK_MS = 60;
/** Fraction of a joint's range used by the motion. */
const ARM_SWING = 0.3;
const HAND_SWING = 0.45;

function getWsBaseUrl(robot: Robot): string {
  const agent = robot.a2aAgentUrl?.replace(/\/$/, '') ?? 'http://localhost:41243';
  return agent.replace(/^http/, 'ws');
}

/** Deterministic per-joint jitter in [0, 1) so motion looks organic. */
function jointJitter(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

/** Smooth "hold at the ends" easing for grasp cycles (-1..1 → -1..1). */
function graspShape(v: number): number {
  return Math.tanh(2.5 * v);
}

/**
 * Compute one pose sample of the synthetic pick-and-place motion.
 * Exported for reuse/testing.
 */
export function computeSimulatedPose(
  joints: JointConfig[],
  tSeconds: number
): Record<string, number> {
  const positions: Record<string, number> = {};
  const basePhase = (2 * Math.PI * tSeconds) / CYCLE_S;

  for (const joint of joints) {
    const name = joint.name.toLowerCase();
    const range = joint.limitUpper - joint.limitLower;
    if (!Number.isFinite(range) || range <= 0) continue;

    // Phase-offset the right side by half a cycle so the arms alternate.
    const isRight = /(^|_)right|_r_|_r$/.test(name);
    const sideOffset = isRight ? Math.PI : 0;
    // Distal joints lag proximal ones slightly → wave-like reach.
    const lag = name.includes('elbow')
      ? 0.6
      : name.includes('wrist')
        ? 1.1
        : /hand|finger|thumb|gripper/.test(name)
          ? 1.4
          : 0;
    const jitter = jointJitter(joint.name);
    const phase = basePhase + sideOffset - lag + jitter * 0.5;

    const isHand = /hand|finger|thumb|gripper/.test(name);
    const swing = (isHand ? HAND_SWING : ARM_SWING) * (0.75 + 0.5 * jitter);
    const wave = isHand ? graspShape(Math.sin(phase)) : Math.sin(phase);

    // Center the motion on the default pose, then clamp to the joint limits.
    const center = Math.min(joint.limitUpper, Math.max(joint.limitLower, joint.defaultPosition));
    const amplitude = (swing * range) / 2;
    const target = center + amplitude * wave;
    positions[joint.name] = Math.min(joint.limitUpper, Math.max(joint.limitLower, target));
  }

  return positions;
}

/**
 * Only drive arm/hand joints — legs and torso stay at their defaults so the
 * humanoid doesn't fall over in the viewer while "picking".
 */
function selectDrivenJoints(joints: JointConfig[]): JointConfig[] {
  const armLike = joints.filter((j) =>
    /shoulder|elbow|wrist|hand|finger|thumb|gripper|arm/i.test(j.name)
  );
  // Single-arm embodiments (SO-101) name joints differently — drive everything.
  return armLike.length > 0 ? armLike : joints;
}

/**
 * Streams synthetic VR-like motion to the robot agent while `enabled`.
 * Returns the connection/streaming status for the UI chip.
 */
export function useSimulatedVrInput({ robot, enabled }: UseSimulatedVrInputArgs): SimInputStatus {
  const [status, setStatus] = useState<SimInputStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled || !robot) {
      setStatus('disconnected');
      return;
    }

    setStatus('connecting');
    const ws = new WebSocket(`${getWsBaseUrl(robot)}/ws/keyboard-teleop`);
    wsRef.current = ws;

    let joints: JointConfig[] = [];
    let timer: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'config' && Array.isArray(msg.joints) && !timer) {
          joints = selectDrivenJoints(msg.joints as JointConfig[]);
          setStatus('streaming');
          timer = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const t = (Date.now() - startedAt) / 1000;
            ws.send(JSON.stringify({ positions: computeSimulatedPose(joints, t) }));
          }, TICK_MS);
        }
      } catch {
        /* ignore parse errors */
      }
    };

    const markDisconnected = () => {
      if (wsRef.current === ws) {
        setStatus('disconnected');
        wsRef.current = null;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    ws.onclose = markDisconnected;
    ws.onerror = markDisconnected;

    return () => {
      if (timer) clearInterval(timer);
      if (wsRef.current === ws) wsRef.current = null;
      // Park the joints at home before leaving so the robot doesn't freeze mid-reach.
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ preset: 'home' }));
        } catch {
          /* closing anyway */
        }
      }
      ws.close();
      setStatus('disconnected');
    };
  }, [robot, enabled]);

  return status;
}
