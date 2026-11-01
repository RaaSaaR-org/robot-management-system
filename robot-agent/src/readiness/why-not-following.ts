/**
 * @file why-not-following.ts
 * @description The one line that says why a teleoperated G1's arms are not
 *              following the controllers (TASK-405). Pure: it takes a snapshot
 *              of what the agent knows — sidecar, mode, lease, hands, arm path —
 *              and returns the FIRST rule of an ordered table that matches. The
 *              VR HUD shows exactly this line; the full snapshot stays in the
 *              readiness route for panels that have room.
 * @feature readiness
 * @status live
 *
 * WHY ONE REASON (D1). A headset shows one line. The rules are ordered so the
 * line is the thing to fix FIRST: a robot that is limp also has no armed arms,
 * but "squeeze the grip" would be the wrong advice.
 *
 * WHAT IS NOT HERE (D3). Operator-local reasons — an untracked controller, a
 * grip nobody squeezes — live in the headset. The agent knows claims, not
 * controllers.
 */

import type { HandHealth, SidecarArmState, SidecarWriteMode } from '../hardware/arm-status.js';
import type { BaseModeName } from '../hardware/base-mode.js';

export type NotFollowingCode =
  | 'sidecar_unreachable'
  | 'no_lowstate'
  | 'read_only'
  | 'estop_latched'
  | 'mode_unknown'
  | 'mode_not_balance'
  | 'lease_none'
  | 'lease_duplicate'
  | 'hand_missing'
  | 'hand_fault'
  | 'disarmed_reason'
  | 'arming'
  | 'deadman_hold'
  | 'not_engaged'
  | 'following';

export type NotFollowingSeverity = 'block' | 'warn' | 'ok';

export interface NotFollowingReason {
  code: NotFollowingCode;
  severity: NotFollowingSeverity;
  /** At most {@link REASON_MAX_CHARS} characters — one VR HUD line. */
  text: string;
}

/** The rule codes in the order they are tried. */
export const NOT_FOLLOWING_ORDER: readonly NotFollowingCode[] = [
  'sidecar_unreachable',
  'no_lowstate',
  'read_only',
  'estop_latched',
  'mode_unknown',
  'mode_not_balance',
  'lease_none',
  'lease_duplicate',
  'hand_missing',
  'hand_fault',
  'disarmed_reason',
  'arming',
  'deadman_hold',
  'not_engaged',
  'following',
];

/** One HUD line. */
export const REASON_MAX_CHARS = 72;

export interface NotFollowingInput {
  sidecar: {
    /** The sidecar answers HTTP. */
    reachable: boolean;
    /** Its robot lowstate is fresh. */
    connected: boolean;
    /** `sim_node.py` (MuJoCo), not a robot. */
    sim: boolean;
    writeMode: SidecarWriteMode | null;
    readOnly: boolean;
    /** The port to name in the "can't reach" line, e.g. `8767`. */
    port?: string | null;
  };
  /** The agent's own E-stop or the sidecar's latch. */
  estopLatched: boolean;
  /**
   * The measured robot mode. `null` = no reading at all. A stale reading is
   * passed as `{name: 'unknown', error: 'stale …'}` by the caller.
   */
  mode: { name: BaseModeName; error: string | null } | null;
  lease: {
    /** `CONTROL_LEASE_REQUIRED`: without it nobody has to take control. */
    enforced: boolean;
    state: 'none' | 'held' | 'expired' | 'released';
    /** Control sockets bound to the lease. */
    bound: number;
  };
  /** Each Dex3 hand's health; null = the sidecar does not report it (unknown, never "ok"). */
  hands: { left: HandHealth; right: HandHealth } | null;
  arms: {
    armed: boolean;
    /** An `/arm` is in flight. */
    arming: boolean;
    armWeight: number;
    armState: SidecarArmState | null;
    deadman: 'ok' | 'hold' | null;
    lastDisarmReason: string | null;
    trackErrRad: number | null;
    trackErrJoint: string | null;
    /** Teleop sockets holding an arm claim. */
    claims: number;
  };
}

/** Cut to one HUD line, on a word where possible. */
export function fitLine(text: string, max: number = REASON_MAX_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,:;]+$/, '')}…`;
}

/** `left_elbow_joint` → `left_elbow`: the suffix costs HUD width and says nothing. */
function shortJoint(name: string): string {
  return name.replace(/_joint$/, '');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function modeWords(mode: BaseModeName): string {
  switch (mode) {
    case 'zero_torque':
      return 'limp (zero torque)';
    case 'stand':
      return 'standing';
    case 'other':
      return 'in another mode';
    default:
      return mode;
  }
}

/** Why the sidecar dropped the arms, in HUD words. */
export function disarmWords(input: NotFollowingInput['arms']): string {
  switch (input.lastDisarmReason) {
    case 'tracking_error': {
      const joint = input.trackErrJoint ? ` on ${shortJoint(input.trackErrJoint)}` : '';
      const rad = input.trackErrRad !== null ? ` ${input.trackErrRad.toFixed(2)} rad` : '';
      return `tracking error${joint}${rad}`;
    }
    case 'left_balance':
      return 'left balance';
    case 'deadman':
      return 'dead-man';
    case 'stale_state':
      return 'stale state';
    case 'fsm_stale':
      return 'stale mode reading';
    case 'estop':
      return 'E-stop';
    default:
      return (input.lastDisarmReason ?? 'unknown').replace(/_/g, ' ');
  }
}

function reason(code: NotFollowingCode, severity: NotFollowingSeverity, text: string): NotFollowingReason {
  return { code, severity, text: fitLine(text) };
}

/** The hand the line is about: right first — on the G1 EDU it is the one that faults. */
const SIDES = ['right', 'left'] as const;

/**
 * The first matching rule, in {@link NOT_FOLLOWING_ORDER}.
 *
 * A sim sidecar (`sim: true`, no write mode) has no read-only switch and no
 * measured mode, so rules 3, 5 and 6 are skipped and the ready line says so.
 * `lease_none` applies only while the lease is enforced: without
 * `CONTROL_LEASE_REQUIRED` nobody has to take control and the arms follow.
 */
export function explainNotFollowing(input: NotFollowingInput): NotFollowingReason {
  const { sidecar, arms } = input;
  const sim = sidecar.sim && sidecar.writeMode === null;

  // 1
  if (!sidecar.reachable) {
    const port = sidecar.port ? ` (${sidecar.port})` : '';
    return reason('sidecar_unreachable', 'block', `Can't reach the robot sidecar${port}. Start the robot side.`);
  }
  // 2
  if (!sidecar.connected) {
    return reason('no_lowstate', 'block', 'The sidecar gets no robot state: cable, robot power or bridge.');
  }
  // 3
  if (!sim && sidecar.readOnly) {
    return reason('read_only', 'block', 'The sidecar is read-only. Switch the robot side to arm control.');
  }
  // 4
  if (input.estopLatched) {
    return reason('estop_latched', 'block', 'E-stop is latched. Reset it, then switch to Balance.');
  }
  if (!sim) {
    // 5
    if (!input.mode || input.mode.name === 'unknown') {
      const why = input.mode?.error ?? 'no reading';
      return reason('mode_unknown', 'block', `The robot mode is unknown (${why}).`);
    }
    // 6
    if (input.mode.name !== 'balance') {
      return reason('mode_not_balance', 'block', `The robot is ${modeWords(input.mode.name)}. Switch to Balance.`);
    }
  }
  // 7
  if (input.lease.enforced && input.lease.state !== 'held') {
    return reason('lease_none', 'block', 'Nobody has taken control. Press Take control.');
  }
  // 8
  if (input.lease.bound > 1) {
    return reason('lease_duplicate', 'block', 'Two control sockets are bound. Close the other VR window.');
  }
  // 9
  if (input.hands) {
    for (const side of SIDES) {
      const h = input.hands[side];
      if (h.present === false) {
        const age = h.ageS !== null ? `${h.ageS.toFixed(1)} s` : 'no data';
        return reason('hand_missing', 'warn', `${cap(side)} hand sends no state (${age}). Check the wrist cable.`);
      }
    }
    // 10
    for (const side of SIDES) {
      const h = input.hands[side];
      const fault = h.motorFaults[0];
      if (fault) {
        const more = h.motorFaults.length > 1 ? ` (+${h.motorFaults.length - 1})` : '';
        return reason('hand_fault', 'warn', `${cap(side)} hand: ${shortJoint(fault.joint)} motor fault ${fault.code}${more}.`);
      }
      if (h.error && (h.error[0] !== 0 || h.error[1] !== 0)) {
        const hex = h.error.map((w) => `0x${w.toString(16)}`).join('/');
        return reason('hand_fault', 'warn', `${cap(side)} hand reports error ${hex}.`);
      }
    }
  }
  // 11
  if (!arms.armed && arms.claims > 0 && arms.lastDisarmReason !== null && arms.lastDisarmReason !== 'request'
      && !arms.arming) {
    const why = `Arms dropped: ${disarmWords(arms)}.`;
    const full = `${why} Squeeze the grip again.`;
    return reason('disarmed_reason', 'block', full.length <= REASON_MAX_CHARS ? full : `${why} Squeeze again.`);
  }
  // 12
  if (arms.arming || arms.armState === 'arming') {
    return reason('arming', 'warn', `Arming… ${Math.round(Math.max(0, Math.min(1, arms.armWeight)) * 100)} %`);
  }
  // 13
  if (arms.deadman === 'hold') {
    return reason('deadman_hold', 'warn', 'Dead-man is holding. Keep the grip squeezed.');
  }
  // 14
  // An arm_sdk sidecar that is not armed is not following, claim or not.
  const live = sidecar.writeMode !== 'arm_sdk' || arms.armed;
  if (arms.claims === 0 || !live) {
    return reason(
      'not_engaged',
      'ok',
      sim ? 'Ready (simulation). Squeeze a grip to drive that arm.' : 'Ready. Squeeze a grip to drive that arm.',
    );
  }
  // 15
  return reason('following', 'ok', sim ? 'Following (simulation).' : 'Following.');
}
