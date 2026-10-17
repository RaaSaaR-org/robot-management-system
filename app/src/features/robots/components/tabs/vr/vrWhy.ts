/**
 * @file vrWhy.ts
 * @description Why the robot's arms are not following the operator, as ONE line,
 *              from facts the headset already has (TASK-407) — plus the robot
 *              panel's status lines. Pure: no React, no three.js, no WebXR. The
 *              wording matches the agent's `explainNotFollowing` table
 *              (TASK-405), so the desktop and the headset say the same thing;
 *              the two rules only the headset can know (controller tracking,
 *              grip) live only here.
 * @feature robots
 */

import type { HudBaseMode } from './vrHud';
import type { LinkState } from './vrSession';

/** Why the agent answered a pose frame with `held` — `TeleopHeldReason` on the agent. */
export type ArmHeldReason =
  | 'unclutched'
  | 'arm_gate'
  | 'not_armed'
  | 'side_refused'
  | 'ik_held'
  | 'estop'
  | 'lease';

export const ARM_HELD_REASONS: readonly ArmHeldReason[] = [
  'unclutched', 'arm_gate', 'not_armed', 'side_refused', 'ik_held', 'estop', 'lease',
];

/** The last `{type:'state', held:true}` answer, as the modal records it. */
export interface ArmHeld {
  side: 'left' | 'right' | 'both';
  reason: ArmHeldReason;
  /** When it arrived, ms (the link's clock). */
  at: number;
}

/** The last arm refusal the agent sent as `{type:'error'}`. */
export interface ArmRefusal {
  code: string;
  message: string;
  at: number;
}

/**
 * How long a held answer or refusal stays the reason, ms. The rig answers at
 * 20 Hz while a grip is held, so a refusal that is still true is refreshed
 * twenty times over in this window; one that stopped (the grip let go) ages out.
 */
export const ARM_REFUSAL_FRESH_MS = 1000;

/** One Dex3 hand's health, as the sidecar reports it (TASK-404 / TASK-405). */
export interface VrHandHealth {
  present: boolean | null;
  ageS: number | null;
  error: [number, number] | null;
  motorFaults: Array<{ motor: number; joint: string; code: string; bits: string[] }>;
  powerV: number | null;
}

/** The `{type:'arm'}` frame's fields the robot panel reads. */
export interface VrArmInfo {
  writeMode: 'arm_sdk' | 'read_only' | null;
  armed: boolean;
  arming: boolean;
  armWeight: number;
  hands: { left: boolean; right: boolean } | null;
  teleopMode: string | null;
  /** TASK-405: `ok` | `hold`; null from a sidecar that does not say. */
  deadman: 'ok' | 'hold' | null;
  /** TASK-405: why the arms were last handed back; null when never / not said. */
  lastDisarmReason: string | null;
  /** TASK-405: per-hand health; null when not reported. */
  handHealth: { left: VrHandHealth; right: VrHandHealth } | null;
}

export type WhySeverity = 'block' | 'warn' | 'ok';

export type WhyCode =
  | 'estop_latched'
  | 'socket_closed'
  | 'lease_none'
  | 'mode_unknown'
  | 'mode_not_balance'
  | 'arm_refused'
  | 'deadman_hold'
  | 'arming'
  | 'controller_untracked'
  | 'not_engaged'
  | 'following';

export interface WhyNotFollowing {
  code: WhyCode;
  severity: WhySeverity;
  /** The full sentence, at most 72 characters — the robot panel's why line. */
  text: string;
  /** At most 26 characters — what fits on one line of the wrist plate. */
  short: string;
}

/** The facts `whyNotFollowingVr` reads — all of them already in the headset. */
export interface VrWhyInput {
  estopLatched: boolean;
  /** The teleop socket is open. */
  socketOpen: boolean;
  /** This console may drive: it holds the lease, or leases are off. */
  leaseHeld: boolean;
  modeControl: 'off' | 'fsm' | 'full';
  baseMode: HudBaseMode;
  armHeld: ArmHeld | null;
  armRefusal: ArmRefusal | null;
  /** Null on the sim and older sidecars. */
  arm: VrArmInfo | null;
  /** A controller is present and its pose resolves this frame. */
  controllers: { left: boolean; right: boolean };
  /** The grip is past the clutch threshold. */
  clutch: { left: boolean; right: boolean };
  now: number;
}

/** Texts for a `held` answer, by reason. Each at most 72 characters. */
const HELD_TEXT: Record<ArmHeldReason, string> = {
  unclutched: 'Arm refused: that grip is not held. Squeeze the grip.',
  arm_gate: 'Arm refused by the robot\'s arm gate. Check the desktop window.',
  not_armed: 'Arms dropped. Release the grip, then squeeze it again.',
  side_refused: 'Arm refused on that side. Release its grip and squeeze again.',
  ik_held: 'Arm held: the hand pose is out of the arm\'s reach.',
  estop: 'E-stop is latched. Reset it.',
  lease: 'Nobody has taken control. Press Take control.',
};

/** Texts for an `{type:'error'}` refusal, by code. Unknown codes get the code. */
const REFUSAL_TEXT: Record<string, string> = {
  lease_required: HELD_TEXT.lease,
  arm_requires_lease: HELD_TEXT.lease,
  arm_requires_heartbeat: 'No heartbeat from this console. Check the link.',
  heartbeat_lost: 'No heartbeat from this console. Check the link.',
  arm_estop_latched: 'The sidecar\'s E-stop is latched. Reset it.',
  arm_requires_clutch: 'This console reports no grip. Reload the app.',
  arm_reengage_required: HELD_TEXT.not_armed,
  arm_side_unclutched: HELD_TEXT.unclutched,
  ik_unsupported: 'This robot has no arm chain the agent can solve.',
};

/** The error codes that mean "the agent refused the arm". */
export function isArmRefusalCode(code: string): boolean {
  return code in REFUSAL_TEXT || code === 'arm_failed' || code.startsWith('arm_');
}

const SIDE_TAG: Record<ArmHeld['side'], string> = { left: 'L', right: 'R', both: 'LR' };

/** Cut to `max` characters with an ellipsis. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function fresh(at: number, now: number): boolean {
  return Number.isFinite(at) && now - at <= ARM_REFUSAL_FRESH_MS && now - at >= -ARM_REFUSAL_FRESH_MS;
}

/**
 * Why the arms are not following, first matching rule wins:
 *
 * 1. E-stop latched
 * 2. socket closed
 * 3. no lease
 * 4. base not in balance (only where NeoDEM controls the mode)
 * 5. the agent refused the arm (a fresh `held` answer, else a fresh error)
 * 6. dead-man holding
 * 7. arming (real robot, ramping in)
 * 8. a controller is not tracked (none at all, or a gripped side lost)
 * 9. no grip squeezed
 * 10. following
 */
export function whyNotFollowingVr(input: VrWhyInput): WhyNotFollowing {
  const controlled = input.modeControl === 'fsm' || input.modeControl === 'full';
  if (input.estopLatched) {
    return {
      code: 'estop_latched',
      severity: 'block',
      text: controlled ? 'E-stop is latched. Reset it, then switch to Balance.' : 'E-stop is latched. Reset it.',
      short: 'E-STOP — hold Reset',
    };
  }
  if (!input.socketOpen) {
    return {
      code: 'socket_closed',
      severity: 'block',
      text: 'No link to the robot agent. Reconnecting…',
      short: 'NO LINK — reconnecting',
    };
  }
  if (!input.leaseHeld) {
    return { code: 'lease_none', severity: 'block', text: HELD_TEXT.lease, short: 'NO CONTROL — take it' };
  }
  if (controlled && input.baseMode === 'unknown') {
    return { code: 'mode_unknown', severity: 'block', text: 'The robot mode is unknown.', short: 'MODE UNKNOWN' };
  }
  if (controlled && input.baseMode !== 'balance') {
    const mode = input.baseMode === 'zero_torque' ? 'limp' : input.baseMode;
    return {
      code: 'mode_not_balance',
      severity: 'block',
      text: `The robot is ${mode}. Switch to Balance.`,
      short: clip(`ROBOT ${mode.toUpperCase()} — Balance`, 26),
    };
  }
  if (input.armHeld && fresh(input.armHeld.at, input.now)) {
    const { side, reason } = input.armHeld;
    return {
      code: 'arm_refused',
      severity: 'block',
      text: HELD_TEXT[reason],
      short: clip(`HELD ${SIDE_TAG[side]}: ${reason}`, 26),
    };
  }
  if (input.armRefusal && fresh(input.armRefusal.at, input.now)) {
    const { code, message } = input.armRefusal;
    return {
      code: 'arm_refused',
      severity: 'block',
      text: clip(REFUSAL_TEXT[code] ?? `Arm refused: ${message || code}`, 72),
      short: clip(`REFUSED: ${code}`, 26),
    };
  }
  if (input.arm?.deadman === 'hold') {
    return {
      code: 'deadman_hold',
      severity: 'warn',
      text: 'Dead-man is holding. Keep the grip squeezed.',
      short: 'DEAD-MAN HOLD',
    };
  }
  if (input.arm && input.arm.writeMode === 'arm_sdk' && input.arm.arming) {
    const pct = Math.round(input.arm.armWeight * 100);
    return { code: 'arming', severity: 'warn', text: `Arming… ${pct} %`, short: `ARMING ${pct} %` };
  }
  const { controllers, clutch } = input;
  if ((!controllers.left && !controllers.right)
    || (clutch.left && !controllers.left)
    || (clutch.right && !controllers.right)) {
    return {
      code: 'controller_untracked',
      severity: 'warn',
      text: 'A controller is not tracked. Hold it in the headset\'s view.',
      short: 'CONTROLLER NOT TRACKED',
    };
  }
  if (!clutch.left && !clutch.right) {
    return {
      code: 'not_engaged',
      severity: 'ok',
      text: 'Ready. Squeeze a grip to drive that arm.',
      short: 'READY — squeeze a grip',
    };
  }
  return { code: 'following', severity: 'ok', text: 'Following.', short: 'FOLLOWING' };
}

// ---- the robot panel's lines ------------------------------------------------

/** Palette for the panel — the same dark-ground colours as the wrist HUD. */
export const PANEL_COLORS = {
  ok: 'palegreen',
  warn: 'khaki',
  bad: 'salmon',
  text: 'gainsboro',
  dim: 'darkgray',
} as const;

export const SEVERITY_COLOR: Record<WhySeverity, string> = {
  block: PANEL_COLORS.bad,
  warn: PANEL_COLORS.warn,
  ok: PANEL_COLORS.ok,
};

export interface PanelLine {
  id: string;
  text: string;
  color: string;
  bold?: boolean;
  /** Wrap onto a second row rather than shrink. */
  wrap?: boolean;
}

/** What the robot panel reads off the rig telemetry. */
export interface RobotPanelFacts {
  estopLatched: boolean;
  baseMode: HudBaseMode;
  baseMeasured: boolean;
  baseDamped: boolean;
  modeControl: 'off' | 'fsm' | 'full';
  armInfo: VrArmInfo | null;
  clutch: { left: boolean; right: boolean };
  armHeld: ArmHeld | null;
  /** `you`, `none`, `off`, or the holder's display name. */
  leaseLabel: string;
  link: LinkState;
  rttMs: number | null;
}

/** `right_hand_thumb_1_joint` → `THUMB_1`. */
export function shortJoint(joint: string): string {
  return joint
    .replace(/^(left|right)_(hand_)?/, '')
    .replace(/_joint$/, '')
    .toUpperCase();
}

function handHealthTag(h: VrHandHealth): string {
  if (h.present === false) return 'missing';
  const fault = h.motorFaults[0];
  if (fault) return `${shortJoint(fault.joint)} ${fault.code}`;
  if (h.error && (h.error[0] !== 0 || h.error[1] !== 0)) {
    return `err 0x${(h.error[0] || h.error[1]).toString(16)}`;
  }
  if (h.present === null) return '—';
  return 'ok';
}

function armsLine(arm: VrArmInfo | null): PanelLine {
  if (!arm || arm.writeMode !== 'arm_sdk') {
    return {
      id: 'arms',
      text: arm?.writeMode === 'read_only' ? 'ARMS read-only sidecar' : 'ARMS no arming needed',
      color: arm?.writeMode === 'read_only' ? PANEL_COLORS.warn : PANEL_COLORS.dim,
    };
  }
  const pct = Math.round(arm.armWeight * 100);
  const state = arm.armed && pct >= 99
    ? `armed ${pct} %`
    : arm.armed || arm.arming
      ? `arming ${pct} %`
      : `disarmed: ${arm.lastDisarmReason ?? '—'}`;
  const deadman = arm.deadman === null ? '—' : arm.deadman.toUpperCase();
  const color = arm.armed && pct >= 99
    ? PANEL_COLORS.ok
    : arm.armed || arm.arming
      ? PANEL_COLORS.warn
      : PANEL_COLORS.dim;
  return { id: 'arms', text: `ARMS ${state} · dead-man ${deadman}`, color: arm.deadman === 'hold' ? PANEL_COLORS.warn : color };
}

function handsLine(arm: VrArmInfo | null): PanelLine {
  let text: string;
  let warn = false;
  if (arm?.handHealth) {
    const l = handHealthTag(arm.handHealth.left);
    const r = handHealthTag(arm.handHealth.right);
    warn = l !== 'ok' || r !== 'ok';
    text = `HANDS L ${l} · R ${r}`;
  } else if (arm?.hands) {
    const l = arm.hands.left ? 'ok' : 'none';
    const r = arm.hands.right ? 'ok' : 'none';
    warn = !arm.hands.left || !arm.hands.right;
    text = `HANDS L ${l} · R ${r}`;
  } else {
    text = 'HANDS —';
  }
  if (arm?.teleopMode) text += ` · ${arm.teleopMode}`;
  return { id: 'hands', text, color: warn ? PANEL_COLORS.warn : PANEL_COLORS.text };
}

/**
 * The robot panel, top to bottom: MODE, ARMS, GRIP, HANDS, LEASE·LINK, and the
 * why line last — bold, wrapped, coloured by severity.
 */
export function composeRobotPanel(facts: RobotPanelFacts, why: WhyNotFollowing, now: number): PanelLine[] {
  const controlled = facts.modeControl === 'fsm' || facts.modeControl === 'full';
  const modeText = `MODE ${facts.baseMode === 'zero_torque' ? 'limp' : facts.baseMode}`
    + `${facts.baseMeasured ? ' (measured)' : ''}${facts.baseDamped ? ' · damped' : ''}`;
  const modeColor = facts.baseMode === 'balance'
    ? PANEL_COLORS.ok
    : controlled || facts.baseDamped
      ? PANEL_COLORS.warn
      : PANEL_COLORS.text;

  const dot = (on: boolean): string => (on ? '●' : '○');
  const heldFresh = facts.armHeld && fresh(facts.armHeld.at, now) ? facts.armHeld : null;
  const grip = `GRIP L ${dot(facts.clutch.left)}  R ${dot(facts.clutch.right)}`
    + (heldFresh ? ` · HELD ${SIDE_TAG[heldFresh.side]}: ${heldFresh.reason}` : '');

  const rtt = facts.rttMs === null || !Number.isFinite(facts.rttMs) ? '' : ` ${Math.round(facts.rttMs)} ms`;
  const linkColor = facts.link === 'live' ? PANEL_COLORS.ok : facts.link === 'stale' ? PANEL_COLORS.warn : PANEL_COLORS.bad;
  const leaseOk = facts.leaseLabel === 'you' || facts.leaseLabel === 'off';

  return [
    { id: 'mode', text: modeText, color: modeColor },
    armsLine(facts.armInfo),
    { id: 'grip', text: grip, color: heldFresh ? PANEL_COLORS.bad : PANEL_COLORS.text },
    handsLine(facts.armInfo),
    {
      id: 'lease-link',
      text: `LEASE ${facts.leaseLabel} · LINK ${facts.link}${rtt}`,
      color: !leaseOk ? PANEL_COLORS.warn : linkColor,
    },
    { id: 'why', text: why.text, color: SEVERITY_COLOR[why.severity], bold: true, wrap: true },
  ];
}

/** The rig telemetry fields the why line and the panel read (`VrRigTelemetry` satisfies it). */
export interface VrWhyTelemetry {
  estopLatched: boolean;
  socketOpen: boolean;
  leaseHeld: boolean;
  leaseLabel: string;
  modeControl: 'off' | 'fsm' | 'full';
  baseMode: HudBaseMode;
  baseMeasured: boolean;
  baseDamped: boolean;
  armHeld: ArmHeld | null;
  armRefusal: ArmRefusal | null;
  armInfo: VrArmInfo | null;
  controllers: { left: boolean; right: boolean };
  clutch: { left: boolean; right: boolean };
  link: LinkState;
  rttMs: number | null;
}

/** `whyNotFollowingVr` over the rig telemetry. */
export function whyFromTelemetry(t: VrWhyTelemetry, now: number): WhyNotFollowing {
  return whyNotFollowingVr({
    estopLatched: t.estopLatched,
    socketOpen: t.socketOpen,
    leaseHeld: t.leaseHeld,
    modeControl: t.modeControl,
    baseMode: t.baseMode,
    armHeld: t.armHeld,
    armRefusal: t.armRefusal,
    arm: t.armInfo,
    controllers: t.controllers,
    clutch: t.clutch,
    now,
  });
}

/** The robot panel's facts over the rig telemetry. */
export function panelFactsFromTelemetry(t: VrWhyTelemetry): RobotPanelFacts {
  return {
    estopLatched: t.estopLatched,
    baseMode: t.baseMode,
    baseMeasured: t.baseMeasured,
    baseDamped: t.baseDamped,
    modeControl: t.modeControl,
    armInfo: t.armInfo,
    clutch: t.clutch,
    armHeld: t.armHeld,
    leaseLabel: t.leaseLabel,
    link: t.link,
    rttMs: t.rttMs,
  };
}

// ---- TASK-413: the camera line and the server's reason ----------------------

/** What the robot panel reads off `useVrCameraStatus`. */
export interface CameraLineInput {
  /** The robot the head-camera panel shows; null when none is mounted. */
  robotId: string | null;
  state: 'live' | 'stale' | 'offline' | 'connecting';
  retryInS: number | null;
  fps: number | null;
}

/**
 * `CAMERA live 28 fps` / `CAMERA offline · retrying in 4 s` — or null when no
 * head-camera panel is showing this robot (the SO-101 has none).
 */
export function cameraPanelLine(camera: CameraLineInput, robotId: string): PanelLine | null {
  if (camera.robotId !== robotId) return null;
  const retry = camera.retryInS !== null && Number.isFinite(camera.retryInS)
    ? ` · retrying in ${Math.max(0, Math.round(camera.retryInS))} s`
    : '';
  switch (camera.state) {
    case 'live': {
      const fps = camera.fps !== null && Number.isFinite(camera.fps) ? ` ${Math.round(camera.fps)} fps` : '';
      return { id: 'camera', text: `CAMERA live${fps}`, color: PANEL_COLORS.ok };
    }
    case 'stale':
      return { id: 'camera', text: `CAMERA stale${retry}`, color: PANEL_COLORS.warn };
    case 'offline':
      return { id: 'camera', text: `CAMERA offline${retry}`, color: PANEL_COLORS.bad };
    default:
      return { id: 'camera', text: `CAMERA connecting${retry}`, color: PANEL_COLORS.dim };
  }
}

/** The server's readiness reason (TASK-411) as far as the why line needs it. */
export interface ServerWhy {
  code: string;
  severity: WhySeverity;
  text: string;
  source: 'server' | 'agent';
}

const SEVERITY_RANK: Record<WhySeverity, number> = { ok: 0, warn: 1, block: 2 };

/**
 * The robot panel's why line (D4): the server's reason when it BLOCKS — so the
 * headset and the desktop show the same verdict — and when the server itself
 * (not the agent it relays) says something at least as serious as the local
 * reason. Otherwise the local reason, which alone knows the grip and the
 * controller tracking. A latched E-stop is the one local reason never
 * outranked: the panel is red and its title already says so.
 */
export function pickWhyLine(local: WhyNotFollowing, server: ServerWhy | null): { text: string; severity: WhySeverity; from: 'server' | 'local' } {
  const localLine = { text: local.text, severity: local.severity, from: 'local' as const };
  if (!server || local.code === 'estop_latched') return localLine;
  const serverWins = server.severity === 'block'
    || (server.source === 'server' && server.severity !== 'ok' && SEVERITY_RANK[server.severity] >= SEVERITY_RANK[local.severity]);
  return serverWins ? { text: server.text, severity: server.severity, from: 'server' } : localLine;
}
