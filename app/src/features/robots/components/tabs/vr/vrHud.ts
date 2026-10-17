/**
 * @file vrHud.ts
 * @description The in-headset heads-up display, as data: the status lines, the
 *              per-hand controller marker appearance, and the round-trip-time
 *              reducer that measures how far behind the robot actually is.
 *              Pure — no React, no three.js, no WebXR. The caller decides how to
 *              draw a `{text, color}`; this file decides what it says.
 * @feature robots
 */

import type { LinkState } from './vrSession';

/** One line of the HUD. `color` is a CSS colour the renderer can use as-is. */
export interface HudLine {
  /** Stable key for the renderer — the label, not the value. */
  id: string;
  text: string;
  color: string;
}

/**
 * HUD palette.
 *
 * CSS named colours rather than theme tokens on purpose. The HUD is drawn on
 * dark canvas plates inside the headset, so it keeps its dark-ground contrast
 * whatever theme the page is in (a light-theme token would put dark green on a
 * dark plate), and `@/brand` would pull React into this module, which exists so
 * every line the operator reads can be asserted in a unit test. The hues mirror
 * the signal set: measured (ok), unknown (warn), stopped (bad).
 */
export const HUD_COLORS = {
  ok: 'palegreen',
  warn: 'khaki',
  bad: 'salmon',
  text: 'gainsboro',
  dim: 'darkgray',
} as const;

/**
 * How many lines the wrist plate can actually hold. A BUDGET, not a style rule.
 *
 * `VrWristHud` draws on a 512 x 256 px texture at `linePx: 52`, and
 * `VrTextPlate` centres the block vertically. 5 lines is 5 * 52 = 260 px against
 * 256 px of canvas: the outer two lines' 37 px glyphs (`linePx * 0.72`) still
 * land inside the edges, so five is legible. 6 lines is 312 px, which puts the
 * first line's baseline 2 px ABOVE the top of the canvas and the last one 2 px
 * below the bottom — both clipped, and the operator has no way to scroll.
 *
 * `composeHud` therefore returns at most FOUR lines: `VrWristHud` spends the
 * fifth on RTT, which it owns because only it knows the thresholds.
 */
export const HUD_MAX_LINES = 5;

/** What the operator's hands are currently doing. */
export type HudMode = 'ARM-L' | 'ARM-R' | 'ARM-LR' | 'DRIVE' | 'IDLE';

export interface HudState {
  /** A latched E-Stop replaces the entire HUD — see `composeHud`. */
  estopLatched: boolean;
  link: LinkState;
  /** Age of the last `{type:'state'}` message, ms. Null when none has arrived. */
  msSinceState: number | null;
  armLeft: boolean;
  armRight: boolean;
  /**
   * True while a stick is actually commanding base TRANSLATION.
   *
   * Not "the base is moving": the head-follow controller yaws the base for any
   * heading error over 2°, and feeding that in here made the mode line read
   * DRIVE whenever the operator turned their body with no stick touched. The
   * yaw gets its own line below instead.
   */
  driving: boolean;
  /** Commanded forward speed, m/s. */
  vx: number;
  /** Commanded LEFT (strafe) speed, m/s. */
  vy: number;
  /** Commanded yaw rate, rad/s (CCW positive). */
  omega: number;
  /**
   * True while the base sits in a non-locomoting FSM (damp / sit / zero-torque).
   *
   * Costs the SPEED and TURN lines rather than adding one, because while it is
   * true those two are worse than absent: `SetVelocity` answers RPC_OK in a
   * damped FSM and the base does not integrate it, so the rig goes on computing
   * and displaying a commanded speed for a robot that will not move a
   * millimetre. The readout that would lie is the readout that carries the
   * explanation.
   *
   * NOT a full-plate takeover like the E-Stop: the arms are joint targets and
   * never touch the loco FSM, so a damped robot is still perfectly usable for
   * manipulation. Blanking the HUD would overstate it.
   */
  baseDamped?: boolean;
  /**
   * The episode being captured right now, or null/absent when nothing is being
   * recorded.
   *
   * `episode` is the number the operator saw on the desktop before they put the
   * headset on — `SessionDetailPage`'s "Recording episode N of M", which is
   * 1-based — NOT the 0-based `episodeIndex` the review table lists. The wearer
   * cannot see either readout while in VR, so the HUD matches the one they were
   * last shown live.
   *
   * Optional so that the robot-detail page's teleop modal, which has no session
   * behind it, does not have to invent a value.
   */
  recording?: { episode: number; frames: number } | null;
  /**
   * The real robot's arm write path (TASK-393), from the agent's
   * `{type:'arm'}` frame. Absent / null on the sim and on older sidecars,
   * which need no arming — the HUD then looks exactly as it did.
   */
  arm?: HudArm | null;
  /**
   * Any controller grip past the clutch threshold right now (TASK-393). Read
   * only on a real robot, to tell "release the grip" from "squeeze it".
   */
  clutchHeld?: boolean;
  /**
   * A side is driven by a tracked hand (TASK-393). On a real robot a hand never
   * arms the arms — it has no clutch — so the plate says to use the controllers.
   */
  handTracked?: boolean;
}

/** Each controller grip past the clutch threshold, as the rig reports it to the agent. */
export interface RigClutch {
  left: boolean;
  right: boolean;
}

/** Whether two clutch reports agree. `null` (never sent) agrees with nothing. */
export function sameClutch(a: RigClutch, b: RigClutch | null): boolean {
  return b !== null && a.left === b.left && a.right === b.right;
}

/**
 * The agent's re-engage latch for this console (`robot-agent/src/teleop/reengage.ts`):
 * `need_release` after any disarm the operator did not cause (and at the start
 * of a session), `need_press` once the grip was seen let go, `ready` once it was
 * squeezed again, `holding` while this console has the arms.
 */
export type HudEngage = 'need_release' | 'need_press' | 'ready' | 'holding';

/** What the HUD needs of the agent's `{type:'arm'}` frame. */
export interface HudArm {
  armed: boolean;
  arming: boolean;
  /** 0..1 */
  armWeight: number;
  /** `arms+hands` | `arms+left_hand` | `arms+right_hand` | `arms_only`, or null when unknown. */
  teleopMode: string | null;
  /** The agent's re-engage latch for this console; null from an older agent. */
  engage?: HudEngage | null;
}

/** The two-line plate a real robot shows while a tracked hand is in use. */
export const HUD_USE_CONTROLLERS = ['Use controllers to drive', 'the real robot'] as const;
/** What the MODE line says while the arms wait for the grip to be let go. */
export const HUD_RELEASE_GRIP = 'Release grip to re-arm';

/**
 * Whether the arms are waiting for the operator to let go before they may arm
 * again: the agent's latch says so, the grip is still held, and nothing is
 * arming. Without the grip held the agent moves on to `need_press` within one
 * beat, and the MODE line's own `ARMS OFF` is then the honest readout.
 */
export function hudNeedsRelease(arm: HudArm, clutchHeld: boolean): boolean {
  return arm.engage === 'need_release' && clutchHeld && !arm.armed && !arm.arming;
}

/**
 * The arm state as a MODE-line suffix. Folded into MODE rather than given a
 * line: the plate is full (see `composeHud`), and "which arm am I holding" and
 * "is that arm actually under my control" are one question to the wearer.
 */
export function hudArmSuffix(arm: HudArm): string {
  if (arm.armed && arm.armWeight >= 0.99) return 'ARMED';
  if (arm.armed || arm.arming) return `ARMING ${Math.round(Math.max(0, Math.min(1, arm.armWeight)) * 100)}%`;
  return 'ARMS OFF';
}

/** The missing-hand warning, or null when both hands are there (or unknown). */
export function hudHandWarning(teleopMode: string | null | undefined): string | null {
  switch (teleopMode) {
    case 'arms+left_hand':
      return 'NO RIGHT HAND — arms + left';
    case 'arms+right_hand':
      return 'NO LEFT HAND — arms + right';
    case 'arms_only':
      return 'NO HANDS — arms only';
    default:
      return null;
  }
}

export function hudMode(state: Pick<HudState, 'armLeft' | 'armRight' | 'driving'>): HudMode {
  if (state.armLeft && state.armRight) return 'ARM-LR';
  if (state.armLeft) return 'ARM-L';
  if (state.armRight) return 'ARM-R';
  return state.driving ? 'DRIVE' : 'IDLE';
}

const LINK_COLOR: Record<LinkState, string> = {
  live: HUD_COLORS.ok,
  stale: HUD_COLORS.warn,
  lost: HUD_COLORS.bad,
};

/** Format a number for the HUD without exposing float noise to the operator. */
function fixed(v: number, digits: number): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '--';
}

/** A whole count for the HUD — never NaN, never negative, never a float. */
function count(v: number): string {
  return Number.isFinite(v) ? String(Math.max(0, Math.round(v))) : '--';
}

/**
 * The HUD, as an ordered list of lines.
 *
 * A latched E-Stop REPLACES everything else rather than adding a line. The
 * operator is wearing a headset with no peripheral vision of the room, and the
 * one fact that matters at that moment is that the robot is stopped and will
 * stay stopped until somebody clears the latch deliberately — a red banner
 * competing with a speed readout is a banner that gets skimmed.
 *
 * RECORDING COSTS A LINE, AND `turn` PAYS FOR IT. The plate holds five lines
 * (`HUD_MAX_LINES`) and four of them were already spoken for, with the fifth
 * committed to RTT. So while an episode is being captured the TURN readout is
 * dropped rather than a sixth line added, because turning in this rig is
 * PHYSICAL — never a stick, see `vrHeading` — so the operator's own inner ear
 * already reports the yaw they asked for. It is the only line on the plate whose
 * information the wearer has a second source for. LINK, MODE, SPEED and RTT have
 * none, and neither does REC: nothing else in the headset says whether the last
 * two minutes of work is being kept.
 *
 * REC goes FIRST for the same reason. It is the line the operator scans for, and
 * anything appended at the bottom is the first thing off the plate if the budget
 * ever moves.
 */
/** MODE, with the arm state folded in on a robot that needs arming. */
function modeLine(state: HudState): HudLine {
  const mode = hudMode(state);
  if (!state.arm) {
    return { id: 'mode', text: `MODE ${mode}`, color: mode === 'IDLE' ? HUD_COLORS.dim : HUD_COLORS.text };
  }
  // Takes the MODE line rather than adding one: which arm is held does not
  // matter while neither is under control, and what to do next does.
  if (hudNeedsRelease(state.arm, state.clutchHeld === true)) {
    return { id: 'mode', text: HUD_RELEASE_GRIP, color: HUD_COLORS.warn };
  }
  const suffix = hudArmSuffix(state.arm);
  // Amber while an arm is held but not yet (or no longer) under control: the
  // wearer is moving a hand the robot is not following.
  const engaged = mode === 'ARM-L' || mode === 'ARM-R' || mode === 'ARM-LR';
  const color = suffix === 'ARMED'
    ? HUD_COLORS.ok
    : engaged
      ? HUD_COLORS.warn
      : HUD_COLORS.dim;
  return { id: 'mode', text: `MODE ${mode} ${suffix}`, color };
}

export function composeHud(state: HudState): HudLine[] {
  if (state.estopLatched) {
    return [
      { id: 'estop', text: 'E-STOP LATCHED', color: HUD_COLORS.bad },
      { id: 'estop-hint', text: 'Robot stopped — clear from the fleet console', color: HUD_COLORS.bad },
    ];
  }

  const age =
    state.msSinceState == null || !Number.isFinite(state.msSinceState)
      ? '--'
      : `${Math.max(0, Math.round(state.msSinceState))}ms`;

  const rec = state.recording;
  const hand = state.arm ? hudHandWarning(state.arm.teleopMode) : null;
  const recLine: HudLine[] = rec
    ? [{ id: 'rec', text: `REC ● ep ${count(rec.episode)} · ${count(rec.frames)} fr`, color: HUD_COLORS.bad }]
    : [];
  const linkLine: HudLine = {
    id: 'link',
    text: `LINK ${state.link.toUpperCase()} ${age}`,
    color: LINK_COLOR[state.link] ?? HUD_COLORS.dim,
  };

  // A tracked hand on a real robot (TASK-393): the agent drives no side whose
  // grip is not held, and a hand has no grip. The base readouts give way — a
  // hands-only operator has no stick to drive the base with either.
  if (state.arm && state.handTracked) {
    return [
      ...recLine,
      linkLine,
      { id: 'mode', text: HUD_USE_CONTROLLERS[0], color: HUD_COLORS.warn },
      { id: 'hand-hint', text: HUD_USE_CONTROLLERS[1], color: HUD_COLORS.warn },
    ];
  }

  return [
    // Red, not green: every camera ever built lights red for "armed and
    // capturing", and the operator does not have to be taught it. It is also the
    // only red line that can appear while the robot is running, so it cannot be
    // confused with the E-Stop banner, which replaces the plate entirely.
    ...recLine,
    linkLine,
    modeLine(state),
    // Two lines, because the base has two independent things to report and one
    // of them used to be invisible. The old single line printed `vx` and
    // `omega`; `vy` was computed, rotated into the robot frame, sent to the
    // robot and never shown, so a full-speed sideways walk read `SPEED 0.00
    // m/s`. Both linear axes are labelled rather than packed onto one number:
    // a magnitude would hide which way the robot is going, and 512 px of plate
    // at a 37 px glyph will not carry a third figure on the SPEED line.
    ...(state.baseDamped
      ? [
          {
            id: 'damped',
            text: 'BASE DAMPED — press Stand',
            color: HUD_COLORS.warn,
          },
        ]
      : [
          {
            id: 'speed',
            text: `SPEED ${fixed(state.vx, 2)} fwd ${fixed(state.vy, 2)} left`,
            color: HUD_COLORS.text,
          },
          // Dropped while recording — see the docstring. `rec` buys this slot.
          // On a real robot with a Dex3 hand missing the warning takes it
          // instead (TASK-393): the yaw has a second source, the missing hand
          // has none inside the headset.
          ...(rec
            ? []
            : hand
              ? [{ id: 'hands', text: hand, color: HUD_COLORS.warn }]
              : [
                  {
                    id: 'turn',
                    text: `TURN ${fixed(state.omega, 2)} rad/s`,
                    color: HUD_COLORS.text,
                  },
                ]),
        ]),
  ];
}

export interface MarkerInput {
  /** Squeeze (grip) axis for this hand, 0..1. */
  squeeze: number;
  /** True while any joint on this arm is clipped against its working range. */
  saturated: boolean;
  /** Squeeze above which the arm is engaged — the rig's own clutch threshold. */
  gripThreshold: number;
}

export interface MarkerAppearance {
  color: string;
  /** 0..1, for the marker material. */
  opacity: number;
  /** Multiplier on the marker's base size. */
  scale: number;
  engaged: boolean;
}

/** Marker size when the clutch is open vs closed. */
const MARKER_IDLE_SCALE = 0.6;
const MARKER_ENGAGED_SCALE = 1;

/**
 * How a hand's controller marker should look.
 *
 * The marker is the ONLY thing in the headset that says whether a grip actually
 * registered. A Quest grip button is analogue and its travel is short, so an
 * operator holding it at 0.45 believes they are driving the arm and cannot tell
 * why nothing moves. Size and opacity both track the squeeze BELOW the
 * threshold, so the marker visibly grows as the clutch closes and the operator
 * learns where the bite point is.
 *
 * Saturation turns the marker red while engaged — that is the "you have run out
 * of shoulder" signal, and it is paired with a haptic pulse because an operator
 * looking at the robot's hands is not looking at their own.
 */
export function markerAppearance(input: MarkerInput): MarkerAppearance {
  const squeeze = Number.isFinite(input.squeeze) ? Math.max(0, Math.min(1, input.squeeze)) : 0;
  const threshold =
    Number.isFinite(input.gripThreshold) && input.gripThreshold > 0 ? input.gripThreshold : 0.5;
  const engaged = squeeze >= threshold;
  if (engaged) {
    return {
      color: input.saturated ? HUD_COLORS.bad : HUD_COLORS.ok,
      opacity: 1,
      scale: MARKER_ENGAGED_SCALE,
      engaged: true,
    };
  }
  // Below the bite point: interpolate over the approach so the marker answers
  // the finger rather than snapping at the threshold.
  const t = squeeze / threshold;
  return {
    color: HUD_COLORS.dim,
    opacity: 0.35 + 0.45 * t,
    scale: MARKER_IDLE_SCALE + (MARKER_ENGAGED_SCALE - MARKER_IDLE_SCALE) * t,
    engaged: false,
  };
}

/**
 * Round-trip time of the control loop, measured client-side with ZERO server
 * change.
 *
 * The agent answers every `{positions}` frame with a `{type:'state'}`
 * synchronously (`robot-agent/src/api/keyboard-teleop.ts` calls `sendState()`
 * in the same handler), so timestamping the send and the next state message is
 * a genuine round trip through the agent and its state manager — not an
 * estimate, and not something that needed a protocol field adding.
 */
export interface LoopHealth {
  /** Send time of the OLDEST unanswered `{positions}` frame. */
  pendingSentAt: number | null;
  /** Most recent measurement, ms. */
  lastRttMs: number | null;
  /** Smoothed measurement, ms — what the HUD should show. */
  rttMs: number | null;
  samples: number;
}

/**
 * Weight of a new sample in the smoothed RTT.
 *
 * 0.2 at a 20 Hz stream is roughly a 0.7 s memory: long enough that one late
 * frame does not make the number jump, short enough that a link that genuinely
 * degrades shows it inside a second.
 */
export const RTT_EMA_ALPHA = 0.2;

export function createLoopHealth(): LoopHealth {
  return { pendingSentAt: null, lastRttMs: null, rttMs: null, samples: 0 };
}

/**
 * Does this outbound frame carry a pose? Then it is an RTT probe.
 *
 * `wrists` counts. It was left out when IK was added and IK is now the default
 * on a G1, so the one readout that measures the control loop went dead in the
 * mode it was added for — `RTT --` on the desktop and no RTT line in the
 * headset at all. Worse silently: an operator who drove in Orientation for a
 * few seconds and switched back froze a stale number on the HUD for the rest of
 * the session, painted green however badly the link then degraded. LINK does
 * not substitute — a link that degrades but stays pipelined still delivers a
 * state every ~50 ms and keeps reading LIVE.
 */
export function isPoseFrame(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null
    && ('positions' in payload || 'wrists' in payload);
}

/**
 * Record that a `{positions}` frame just went out.
 *
 * An already-pending timestamp is KEPT, not overwritten. The agent answers in
 * order, so the next state message belongs to the OLDEST outstanding frame;
 * overwriting would measure the newest send against the oldest reply and report
 * a round trip shorter than the real one — which is the wrong direction to be
 * wrong about a control link.
 */
export function onPositionsSent(health: LoopHealth, now: number): LoopHealth {
  if (!Number.isFinite(now)) return health;
  if (health.pendingSentAt !== null) return health;
  return { ...health, pendingSentAt: now };
}

/**
 * Record a `{type:'state'}` arrival.
 *
 * With nothing outstanding this is one of the agent's own 30 Hz held-key ticks
 * rather than an answer to us, and is ignored — attributing it to a send we
 * never made would report an RTT of minutes.
 */
export function onStateReceived(health: LoopHealth, now: number): LoopHealth {
  const sent = health.pendingSentAt;
  if (sent === null || !Number.isFinite(now)) return health;
  const rtt = now - sent;
  // A clock that went backwards is not a negative round trip.
  if (rtt < 0) return { ...health, pendingSentAt: null };
  const rttMs = health.rttMs === null ? rtt : health.rttMs + (rtt - health.rttMs) * RTT_EMA_ALPHA;
  return { pendingSentAt: null, lastRttMs: rtt, rttMs, samples: health.samples + 1 };
}
