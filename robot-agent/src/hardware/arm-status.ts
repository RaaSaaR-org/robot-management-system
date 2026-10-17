/**
 * @file arm-status.ts
 * @description What a G1 sidecar says about its arm write path (TASK-391/393
 *              shared contract): write mode, whether it is armed, the blend
 *              weight, the E-stop latch, which Dex3 hands report state and the
 *              teleop mode that follows from that. Pure — parsed from the
 *              `/health` and `/state` bodies, no I/O.
 * @feature hardware
 * @status live
 */

/**
 * How the sidecar may write to the robot.
 *
 * - `read_only` — telemetry only (`G1_READ_ONLY`, the default). Nothing a teleop
 *   client sends reaches a motor.
 * - `arm_sdk` — the opt-in arm-only channel (`G1_WRITE_MODE=arm_sdk`): the 14
 *   arm joints on `rt/arm_sdk`, legs and waist stay under Unitree's balance
 *   controller. Commands are accepted only while ARMED.
 */
export type SidecarWriteMode = 'read_only' | 'arm_sdk';

/** Which end effectors a teleop session can drive, from the hands that report state. */
export type TeleopHandMode = 'arms+hands' | 'arms+left_hand' | 'arms+right_hand' | 'arms_only';

export const TELEOP_HAND_MODES: readonly TeleopHandMode[] = [
  'arms+hands',
  'arms+left_hand',
  'arms+right_hand',
  'arms_only',
];

export interface SidecarArmStatus {
  /**
   * `null` when the sidecar does not report one. That is the MuJoCo DDS sim and
   * every sidecar older than the arm-only contract: they accept `/action`
   * without arming, exactly as before, and nothing here changes how they are
   * driven.
   */
  writeMode: SidecarWriteMode | null;
  /** The sidecar is publishing arm commands (weight may still be ramping). */
  armed: boolean;
  /** Blend weight 0..1 the sidecar is currently publishing. */
  armWeight: number;
  /** `/estop` was posted and has not been reset with `/estop/reset`. */
  estopLatched: boolean;
  /** Dex3 hands whose state arrived within the sidecar's freshness window; null = not reported. */
  hands: { left: boolean; right: boolean } | null;
  /** What a session can drive with the hands that are present; null = not reported. */
  teleopMode: TeleopHandMode | null;
  /** The sidecar is `sim_node.py` (MuJoCo), not a robot. */
  sim: boolean;
  /** The sidecar says it is read-only (old `read_only: true` or `write_mode: read_only`). */
  readOnly: boolean;
}

/** What an unknown / not-yet-seen sidecar is assumed to be: nothing to arm. */
export const UNKNOWN_ARM_STATUS: SidecarArmStatus = Object.freeze({
  writeMode: null,
  armed: false,
  armWeight: 0,
  estopLatched: false,
  hands: null,
  teleopMode: null,
  sim: false,
  readOnly: false,
}) as SidecarArmStatus;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The teleop mode the hands imply, for a sidecar that reports hands but not the mode. */
export function teleopModeFromHands(hands: { left: boolean; right: boolean }): TeleopHandMode {
  if (hands.left && hands.right) return 'arms+hands';
  if (hands.left) return 'arms+left_hand';
  if (hands.right) return 'arms+right_hand';
  return 'arms_only';
}

/**
 * Read the arm fields out of a `/health` or `/state` body.
 *
 * Every field is optional on the wire and validated here: an unknown
 * `write_mode` string is NOT guessed into `arm_sdk` (that would gate the
 * forwarder on an arm call the sidecar does not understand) — it is reported
 * as `null`, i.e. "behave as before".
 */
export function parseArmStatus(body: unknown): SidecarArmStatus {
  const data = asRecord(body);
  if (!data) return { ...UNKNOWN_ARM_STATUS };

  const rawMode = data.write_mode;
  const writeMode: SidecarWriteMode | null =
    rawMode === 'arm_sdk' || rawMode === 'read_only' ? rawMode : null;

  const weightRaw = data.arm_weight;
  const armWeight = typeof weightRaw === 'number' && Number.isFinite(weightRaw)
    ? Math.max(0, Math.min(1, weightRaw))
    : 0;

  const handsRaw = asRecord(data.hands);
  const hands = handsRaw && typeof handsRaw.left === 'boolean' && typeof handsRaw.right === 'boolean'
    ? { left: handsRaw.left, right: handsRaw.right }
    : null;

  const modeRaw = data.teleop_mode;
  const teleopMode = typeof modeRaw === 'string' && (TELEOP_HAND_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as TeleopHandMode)
    : hands
      ? teleopModeFromHands(hands)
      : null;

  return {
    writeMode,
    armed: data.armed === true,
    armWeight,
    estopLatched: data.estop_latched === true,
    hands,
    teleopMode,
    sim: data.sim === true,
    readOnly: writeMode === 'read_only' || (writeMode === null && data.read_only === true),
  };
}

/** Field-by-field equality, so listeners hear about changes and not about polls. */
export function sameArmStatus(a: SidecarArmStatus, b: SidecarArmStatus): boolean {
  return a.writeMode === b.writeMode
    && a.armed === b.armed
    && Math.abs(a.armWeight - b.armWeight) < 0.01
    && a.estopLatched === b.estopLatched
    && (a.hands?.left ?? null) === (b.hands?.left ?? null)
    && (a.hands?.right ?? null) === (b.hands?.right ?? null)
    && a.teleopMode === b.teleopMode
    && a.sim === b.sim
    && a.readOnly === b.readOnly;
}
