/**
 * @file robotTraits.ts
 * @description What a robot can be asked to do, read off what it reports about
 *              itself — never off its name (TASK-485). One place decides it, so
 *              the header menu, the tabs and the readiness list agree.
 * @feature robots
 *
 * Where each answer comes from:
 * - **an agent** — `robotProvisioning`: an expected robot has none (TASK-477);
 * - **a battery to charge** — `powerSource`, which the agent sends in its
 *   metadata and telemetry and an expected robot carries in its metadata. A
 *   mains-powered robot (`ac_powered`: a bench arm) has no dock to drive to;
 * - **hands** — the embodiment key (`robotType`), the same one that picks the
 *   3D model. Only an embodiment known to carry hands says yes; an arm with a
 *   gripper and an unknown embodiment say no, and the readiness list then
 *   shows hand rows only when the robot's agent reports hand health itself.
 */

import {
  normalizeRobotType,
  robotProvisioning,
  type Robot,
  type RobotTelemetry,
  type RobotType,
} from '../types/robots.types';

export interface RobotTraits {
  /** An agent has registered this robot. False for an expected robot. */
  hasAgent: boolean;
  /** The agent is connected right now: the robot is not offline. */
  connected: boolean;
  /** It runs on a battery and can be sent to charge. False on mains power. */
  canCharge: boolean;
  /** Its embodiment carries hands (not a gripper, not unknown). */
  hasHands: boolean;
}

/** Embodiments that carry hands. `g1_edu` is the G1 body with Dex3-1 hands. */
const EMBODIMENT_HAS_HANDS: Record<RobotType, boolean> = {
  g1_edu: true,
  g1: false,
  h1: false,
  so101: false,
  generic: false,
};

export function robotTraits(
  robot: Pick<Robot, 'status' | 'metadata'>,
  telemetry?: Pick<RobotTelemetry, 'powerSource' | 'robotType'> | null,
): RobotTraits {
  const powerSource = telemetry?.powerSource ?? robot.metadata?.powerSource;
  const embodiment = normalizeRobotType(telemetry?.robotType ?? robot.metadata?.robotType);
  return {
    hasAgent: robotProvisioning(robot) === null,
    connected: robot.status !== 'offline',
    canCharge: powerSource !== 'ac_powered',
    hasHands: EMBODIMENT_HAS_HANDS[embodiment],
  };
}
