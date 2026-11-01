/**
 * @file vrWhy.ts
 * @description Why the robot's arms are not following the operator, as ONE line,
 *              from facts the headset already has (TASK-407) — plus the robot
 *              panel's status lines. Pure: no React, no three.js, no WebXR. The
 *              wording matches the agent's `explainNotFollowing` table
 *              (TASK-405), so the desktop and the headset say the same thing;
 *              the two rules only the headset can know (controller tracking,
 *              grip) live only here.
 *
 *              TASK-417: every sentence names a button that exists in the
 *              headset (Reset, the grip) or the person who acts (the desktop);
 *              the panel leads with the why line and shows only what is not fine.
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
  estop: 'E-stop latched — hold Reset for 1 s.',
  // TASK-417: there is no Take control button inside the headset.
  lease: 'You lost control — exit VR and press Take control.',
};

/**
 * A held reason in a few words, for the robot panel's chip row (TASK-417): the
 * same meaning as `HELD_TEXT`, never the agent's code.
 */
const HELD_WORDS: Record<ArmHeldReason, string> = {
  unclutched: 'grip not held',
  arm_gate: 'arm gate',
  not_armed: 'arms dropped',
  side_refused: 'side refused',
  ik_held: 'out of reach',
  estop: 'E-stop',
  lease: 'no control',
};

/** Texts for an `{type:'error'}` refusal, by code. Unknown codes get the code. */
const REFUSAL_TEXT: Record<string, string> = {
  lease_required: HELD_TEXT.lease,
  arm_requires_lease: HELD_TEXT.lease,
  arm_requires_heartbeat: 'No heartbeat from this console. Check the link.',
  heartbeat_lost: 'No heartbeat from this console. Check the link.',
  arm_estop_latched: 'The sidecar\'s E-stop is latched — hold Reset for 1 s.',
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
      // TASK-417: name the buttons the operator has, and who acts next.
      text: controlled
        ? 'E-stop latched — hold Reset for 1 s. Then the desktop asks for Balance.'
        : 'E-stop latched — hold Reset for 1 s.',
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
    return { code: 'lease_none', severity: 'block', text: HELD_TEXT.lease, short: 'NO CONTROL — exit VR' };
  }
  if (controlled && input.baseMode === 'unknown') {
    return { code: 'mode_unknown', severity: 'block', text: 'The robot mode is unknown.', short: 'MODE UNKNOWN' };
  }
  if (controlled && input.baseMode !== 'balance') {
    // TASK-417: the desktop asks, the headset allows — no mode button in VR.
    const limp = input.baseMode === 'limp' || input.baseMode === 'zero_torque';
    if (limp) {
      return {
        code: 'mode_not_balance',
        severity: 'block',
        text: 'Robot limp — the desktop asks for Stand up, then Balance.',
        short: 'LIMP — desktop asks',
      };
    }
    const mode = input.baseMode === 'stand' ? 'standing' : `in ${input.baseMode}`;
    return {
      code: 'mode_not_balance',
      severity: 'block',
      text: `Robot ${mode} — the desktop asks for Balance.`,
      short: clip(`${input.baseMode.toUpperCase()} — desktop asks`, 26),
    };
  }
  if (input.armHeld && fresh(input.armHeld.at, input.now)) {
    const { side, reason } = input.armHeld;
    return {
      code: 'arm_refused',
      severity: 'block',
      text: HELD_TEXT[reason],
      short: clip(`HELD ${SIDE_TAG[side]}: ${HELD_WORDS[reason]}`, 26),
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
  /** With `wrap`: at most this many rows. */
  maxRows?: number;
  /** Glyph and row height relative to the panel's line (TASK-417: the why line is 1.5). */
  scale?: number;
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

/** The ARMS chip, or null when the arms need no attention (or no arming at all). */
function armsChip(arm: VrArmInfo | null): { text: string; bad: boolean } | null {
  if (!arm) return null;
  if (arm.writeMode === 'read_only') return { text: 'ARMS read-only sidecar', bad: false };
  if (arm.writeMode !== 'arm_sdk') return null;
  if (arm.deadman === 'hold') return { text: 'DEAD-MAN hold', bad: false };
  const pct = Math.round(arm.armWeight * 100);
  if (arm.armed && pct >= 99) return null;
  if (arm.armed || arm.arming) return { text: `ARMS arming ${pct} %`, bad: false };
  return { text: arm.lastDisarmReason ? `ARMS off: ${arm.lastDisarmReason}` : 'ARMS off', bad: false };
}

/** The HANDS chip, or null while both hands are fine (or not reported). */
function handsChip(arm: VrArmInfo | null): string | null {
  if (arm?.handHealth) {
    const l = handHealthTag(arm.handHealth.left);
    const r = handHealthTag(arm.handHealth.right);
    if ((l === 'ok' || l === '—') && (r === 'ok' || r === '—')) return null;
    return `HANDS L ${l} · R ${r}`;
  }
  if (arm?.hands && (!arm.hands.left || !arm.hands.right)) {
    return `HANDS L ${arm.hands.left ? 'ok' : 'none'} · R ${arm.hands.right ? 'ok' : 'none'}`;
  }
  return null;
}

/**
 * The robot panel, top to bottom (TASK-417, D3): the why line FIRST — bold,
 * 1.5x, at most two rows, coloured by severity — then ONE row of chips naming
 * only what is not fine: MODE (not balance, where NeoDEM controls it), ARMS,
 * HELD (in words, never the agent's code), HANDS, LINK (not live), LEASE (not
 * you). A glance finds why the arms stopped; nothing that is fine competes
 * with it, and no number that freezes while idle (the old RTT) is shown.
 */
export function composeRobotPanel(facts: RobotPanelFacts, why: WhyNotFollowing, now: number): PanelLine[] {
  const controlled = facts.modeControl === 'fsm' || facts.modeControl === 'full';
  const chips: string[] = [];
  let bad = false;

  if (controlled && facts.baseMode !== 'balance') {
    const mode = facts.baseMode === 'zero_torque' ? 'limp' : facts.baseMode;
    chips.push(`MODE ${mode}${facts.baseDamped && mode !== 'limp' ? ' · damped' : ''}`);
  } else if (!controlled && facts.baseDamped) {
    chips.push('BASE damped');
  }
  const arms = armsChip(facts.armInfo);
  if (arms) chips.push(arms.text);
  const heldFresh = facts.armHeld && fresh(facts.armHeld.at, now) ? facts.armHeld : null;
  if (heldFresh) {
    chips.push(`HELD ${SIDE_TAG[heldFresh.side]}: ${HELD_WORDS[heldFresh.reason]}`);
    bad = true;
  }
  const hands = handsChip(facts.armInfo);
  if (hands) chips.push(hands);
  if (facts.link !== 'live') {
    chips.push(`LINK ${facts.link}`);
    if (facts.link === 'lost') bad = true;
  }
  if (facts.leaseLabel !== 'you' && facts.leaseLabel !== 'off') {
    chips.push(`LEASE ${facts.leaseLabel}`);
    bad = true;
  }

  const lines: PanelLine[] = [
    { id: 'why', text: why.text, color: SEVERITY_COLOR[why.severity], bold: true, wrap: true, maxRows: 2, scale: 1.5 },
  ];
  if (chips.length > 0) {
    lines.push({
      id: 'chips',
      text: chips.join('  ·  '),
      color: bad ? PANEL_COLORS.bad : PANEL_COLORS.warn,
      wrap: true,
      maxRows: 2,
    });
  }
  return lines;
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
  return serverWins ? { text: vrServerText(server, local), severity: server.severity, from: 'server' } : localLine;
}

/**
 * The server's reasons are worded for the desktop ("Press Take control",
 * "Switch to Balance"), and the headset has neither button (TASK-417). Those
 * codes take the headset's own wording: the local sentence when it agrees on
 * the code, else this table.
 */
const VR_SERVER_TEXT: Record<string, string> = {
  estop_latched: HELD_TEXT.estop,
  lease_none: HELD_TEXT.lease,
  mode_not_balance: 'Robot not balancing — the desktop asks for Balance.',
};

function vrServerText(server: ServerWhy, local: WhyNotFollowing): string {
  const reworded = VR_SERVER_TEXT[server.code];
  if (reworded === undefined) return server.text;
  return local.code === server.code ? local.text : reworded;
}
