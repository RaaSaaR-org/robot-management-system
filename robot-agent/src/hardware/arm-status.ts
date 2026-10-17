/**
 * @file arm-status.ts
 * @description What a G1 sidecar says about its arm write path (TASK-391/393
 *              shared contract): write mode, whether it is armed, the blend
 *              weight, the E-stop latch, which Dex3 hands report state and the
 *              teleop mode that follows from that, plus the diagnostics the
 *              readiness line needs (TASK-405): the arm phase, the dead-man,
 *              why the arms last dropped, the tracking error, the FSM the
 *              sidecar acts on, how old its lowstate is and each Dex3 hand's
 *              health (TASK-404). Pure — parsed from the `/health` and `/state`
 *              bodies, no I/O.
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

/** The arm write path's phase, as `g1_arm_sdk.py` names it. */
export type SidecarArmState = 'disarmed' | 'arming' | 'armed' | 'disarming';

/** One motor fault of a Dex3 hand, decoded by the sidecar (TASK-404). */
export interface HandMotorFault {
  motor: number;
  joint: string;
  /** Hex error code, e.g. `0x200`. */
  code: string;
  bits: string[];
}

/**
 * What the sidecar says about one Dex3 hand (TASK-404 `hand_health.<side>`).
 * Every field is `null` when the sidecar did not say — unknown, never "ok".
 */
export interface HandHealth {
  /** The hand's state arrived within the sidecar's freshness window. */
  present: boolean | null;
  /** Seconds since the last hand state message; null = never received / not reported. */
  ageS: number | null;
  /** The two raw error words of the hand state; null = not reported. */
  error: [number, number] | null;
  motorFaults: HandMotorFault[];
  /** Supply voltage, V; null = not reported. */
  powerV: number | null;
}

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
  // ── TASK-405 diagnostics. Optional in the type so older call sites that build
  // a status by hand still compile; `parseArmStatus` always fills them, with
  // `null` for every field the sidecar did not send.
  /** `arm_state`: disarmed / arming / armed / disarming. */
  armState?: SidecarArmState | null;
  /** `deadman`: `ok`, or `hold` while the sidecar holds the last pose for want of fresh commands. */
  deadman?: 'ok' | 'hold' | null;
  /** `last_disarm_reason`: `request`, `deadman`, `tracking_error`, `left_balance`, `estop`, … */
  lastDisarmReason?: string | null;
  /** `track_err_rad`: the largest |command − measured| over the arms, rad. */
  trackErrRad?: number | null;
  /** `track_err_joint`: the joint that holds that error. */
  trackErrJoint?: string | null;
  /** `fsm`: the FSM id the arm path gates on and how old that reading is. */
  fsm?: { id: number | null; ageS: number | null } | null;
  /** `lease_generation` the sidecar was armed under. */
  leaseGeneration?: number | null;
  /** `ignored_joints`: joint → why the sidecar drops commands for it. */
  ignoredJoints?: Record<string, string> | null;
  /** `dds_domain` the sidecar publishes on (0 = the real robot). */
  ddsDomain?: number | null;
  /** `lowstate_age_s` (TASK-404): seconds since the last robot lowstate. */
  lowstateAgeS?: number | null;
  /** `hand_health` (TASK-404); null when the sidecar does not report it. */
  handHealth?: { left: HandHealth; right: HandHealth } | null;
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
  armState: null,
  deadman: null,
  lastDisarmReason: null,
  trackErrRad: null,
  trackErrJoint: null,
  fsm: null,
  leaseGeneration: null,
  ignoredJoints: null,
  ddsDomain: null,
  lowstateAgeS: null,
  handHealth: null,
}) as SidecarArmStatus;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const ARM_STATES: readonly SidecarArmState[] = ['disarmed', 'arming', 'armed', 'disarming'];

/** One `hand_health.<side>` block. Missing pieces stay `null`, never "healthy". */
export function parseHandHealth(v: unknown): HandHealth {
  const h = asRecord(v);
  const errRaw = h?.error;
  const error: [number, number] | null = Array.isArray(errRaw)
    && errRaw.length === 2
    && errRaw.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? [errRaw[0] as number, errRaw[1] as number]
    : null;
  const faultsRaw = Array.isArray(h?.motor_faults) ? h.motor_faults : [];
  const motorFaults = faultsRaw.flatMap((f: unknown): HandMotorFault[] => {
    const r = asRecord(f);
    if (!r) return [];
    const motor = finiteOrNull(r.motor);
    const code = typeof r.code === 'string' ? r.code : finiteOrNull(r.code) !== null ? `0x${(r.code as number).toString(16)}` : null;
    if (motor === null || code === null) return [];
    return [{
      motor,
      joint: typeof r.joint === 'string' && r.joint ? r.joint : `motor_${motor}`,
      code,
      bits: Array.isArray(r.bits) ? r.bits.filter((b): b is string => typeof b === 'string') : [],
    }];
  });
  return {
    present: typeof h?.present === 'boolean' ? h.present : null,
    ageS: finiteOrNull(h?.age_s),
    error,
    motorFaults,
    powerV: finiteOrNull(h?.power_v),
  };
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
    ...parseArmDiagnostics(data),
  };
}

/** The TASK-405 diagnostic fields; each one `null` when the body lacks it. */
function parseArmDiagnostics(data: Record<string, unknown>): Required<Pick<SidecarArmStatus,
  'armState' | 'deadman' | 'lastDisarmReason' | 'trackErrRad' | 'trackErrJoint' | 'fsm'
  | 'leaseGeneration' | 'ignoredJoints' | 'ddsDomain' | 'lowstateAgeS' | 'handHealth'>> {
  const armState = typeof data.arm_state === 'string' && (ARM_STATES as readonly string[]).includes(data.arm_state)
    ? (data.arm_state as SidecarArmState)
    : null;
  const deadman = data.deadman === 'ok' || data.deadman === 'hold' ? data.deadman : null;
  const fsmRaw = asRecord(data.fsm);
  const ignoredRaw = asRecord(data.ignored_joints);
  let ignoredJoints: Record<string, string> | null = null;
  if (ignoredRaw) {
    ignoredJoints = {};
    for (const [k, v] of Object.entries(ignoredRaw)) ignoredJoints[k] = typeof v === 'string' ? v : String(v);
  }
  const handsRaw = asRecord(data.hand_health);
  return {
    armState,
    deadman,
    lastDisarmReason: stringOrNull(data.last_disarm_reason),
    trackErrRad: finiteOrNull(data.track_err_rad),
    trackErrJoint: stringOrNull(data.track_err_joint),
    fsm: fsmRaw ? { id: finiteOrNull(fsmRaw.id), ageS: finiteOrNull(fsmRaw.age_s) } : null,
    leaseGeneration: finiteOrNull(data.lease_generation),
    ignoredJoints,
    ddsDomain: finiteOrNull(data.dds_domain),
    lowstateAgeS: finiteOrNull(data.lowstate_age_s),
    handHealth: handsRaw
      ? { left: parseHandHealth(handsRaw.left), right: parseHandHealth(handsRaw.right) }
      : null,
  };
}

/** What a hand's health says for change detection: ages and voltages tick every poll. */
function handKey(h: HandHealth | undefined): string {
  if (!h) return '';
  return JSON.stringify([h.present, h.error, h.motorFaults.map((f) => `${f.motor}:${f.code}`)]);
}

/** Change-relevant part of the hand health — what a listener must hear about. */
export function handHealthKey(hh: SidecarArmStatus['handHealth']): string {
  if (!hh) return 'null';
  return `${handKey(hh.left)}|${handKey(hh.right)}`;
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
    && a.readOnly === b.readOnly
    && (a.armState ?? null) === (b.armState ?? null)
    && (a.deadman ?? null) === (b.deadman ?? null)
    && (a.lastDisarmReason ?? null) === (b.lastDisarmReason ?? null)
    && (a.trackErrJoint ?? null) === (b.trackErrJoint ?? null)
    && Math.abs((a.trackErrRad ?? 0) - (b.trackErrRad ?? 0)) < 0.01
    && (a.trackErrRad === null || a.trackErrRad === undefined) === (b.trackErrRad === null || b.trackErrRad === undefined)
    && handHealthKey(a.handHealth) === handHealthKey(b.handHealth);
}
