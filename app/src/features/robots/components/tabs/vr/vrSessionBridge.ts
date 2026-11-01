/**
 * @file vrSessionBridge.ts
 * @description The recording session as the headset sees it (TASK-413): the
 *              one object the data-collection page hands down to the VR scene
 *              (`VrSessionBridge`), the pure view builder over the session's
 *              live state, the session board's lines, the wrist HUD's take line,
 *              and the stick-shortcut reducer (left click Start/Stop, right
 *              click Next, right hold Discard last). TASK-418: the task line,
 *              the quick check kept until the next Start, the ENDED line, and
 *              the head-camera screen's strip (REC / E-STOP / the verdict /
 *              session ended). No React, no three.js, no
 *              WebXR — all of it testable in vitest with fake gamepad frames.
 *              The one side effect, `withTakeHaptics`, only queues pulses.
 *
 *              Structural on purpose: the robots feature does not import the
 *              data-collection types. `LiveState` and `QuickCheck` satisfy the
 *              `VrLiveInput` / `VrQuickCheckInput` shapes below.
 * @feature robots
 */

import { TAKE_ACCEPTED, TAKE_REFUSED, queueHaptics } from './vrHaptics';

// ============================================================================
// THE BRIDGE
// ============================================================================

/** What a take action came back as. `refused` covers a 409 the store adopted, a busy store and an error. */
export type VrTakeOutcome = 'ok' | 'refused';

/** The last take's quick check, already in the operator's words. */
export interface VrQuickCheckView {
  /** 1-based, as every screen says it. */
  takeNumber: number;
  durationS: number;
  frames: number;
  /** "L arm", "R hand" … */
  groups: string[];
  /** "Short", "No motion" … — empty when the take looks good. */
  warnings: string[];
  /** TASK-416: the robot ended this take on an E-stop and discarded it. */
  estopDiscarded?: boolean;
}

/** The session, read by the board, the wrist HUD and the stick shortcuts. */
export interface VrSessionView {
  /** The session's status: `created`, `recording`, `paused`, `completed`, `cancelled`, … */
  status: string;
  /** `capturing` records a take; `between` is ready for one; null for a recorder without explicit takes. */
  phase: 'between' | 'capturing' | null;
  /** 0-based wire take: the live one while capturing, else the last one; null before the first. */
  take: number | null;
  /** Seconds the live take has run on the server clock; null between takes. */
  takeElapsedS: number | null;
  kept: number;
  discarded: number;
  /** Frames of the live take while capturing, else the session's total. */
  frames: number;
  fpsActual: number | null;
  degraded: boolean;
  /** Seconds until the robot stops the take on its own; null when there is no auto-stop. */
  autoStopInS: number | null;
  lastQuickCheck: VrQuickCheckView | null;
  /** A take action is in flight (the store answers one at a time). */
  pending: boolean;
  /** What to demonstrate — the session's language instruction (TASK-418); null when it has none. */
  instruction: string | null;
  /** Who ended the session, as presence named them (TASK-418); null when unknown or not ended. */
  endedBy: string | null;
  /** The session's own frame count — the final one once it has ended. */
  sessionFrames: number;
}

/** The session is over: completed, cancelled or failed. */
export function sessionEnded(view: Pick<VrSessionView, 'status'>): boolean {
  return view.status === 'completed' || view.status === 'cancelled' || view.status === 'failed';
}

/**
 * Handed down from the session page to the scene as ONE object (D2). A getter,
 * not props: the board, the HUD and the rig read it from their own frame loops,
 * so the canvas never re-renders because a frame counter moved.
 */
export interface VrSessionBridge {
  /** The session this bridge drives (TASK-414: the operator publisher watches it). */
  sessionId?: string;
  getState(): VrSessionView;
  /**
   * Who else watches the session, for the robot panel's title (TASK-414):
   * "Ben (desktop)", or null when nobody does. Read from the frame loop.
   */
  watching?(): string | null;
  actions: {
    start(): Promise<VrTakeOutcome>;
    stop(): Promise<VrTakeOutcome>;
    next(): Promise<VrTakeOutcome>;
    discardLast(): Promise<VrTakeOutcome>;
  };
}

/**
 * The bridge with its answers felt (TASK-413): `episodeMark` when an action
 * landed, two short taps when the session refused it (a 409 the store adopted,
 * a busy store, an error). Every path — a board button or a stick shortcut —
 * goes through this, so the hand always learns the outcome.
 */
export function withTakeHaptics(bridge: VrSessionBridge): VrSessionBridge {
  const felt = (run: () => Promise<VrTakeOutcome>) => async (): Promise<VrTakeOutcome> => {
    let outcome: VrTakeOutcome;
    try {
      outcome = await run();
    } catch {
      outcome = 'refused';
    }
    queueHaptics(outcome === 'ok' ? TAKE_ACCEPTED : TAKE_REFUSED);
    return outcome;
  };
  return {
    sessionId: bridge.sessionId,
    getState: () => bridge.getState(),
    watching: bridge.watching ? () => bridge.watching!() : undefined,
    actions: {
      start: felt(() => bridge.actions.start()),
      stop: felt(() => bridge.actions.stop()),
      next: felt(() => bridge.actions.next()),
      discardLast: felt(() => bridge.actions.discardLast()),
    },
  };
}

// ============================================================================
// THE VIEW BUILDER
// ============================================================================

/** The `LiveState` fields the view reads. */
export interface VrLiveInput {
  status: string;
  phase: 'between' | 'capturing' | null;
  take: number | null;
  takeStartedAt: string | null;
  takeElapsedS: number | null;
  takeFrames: number;
  totalFrames: number;
  kept: number;
  discarded: number;
  fpsActual: number | null;
  degraded: boolean;
  autoStopS: number | null;
}

/** The `QuickCheck` fields the view reads. */
export interface VrQuickCheckInput {
  take: number;
  frames: number;
  durationS: number;
  groupsMoved: string[];
  warnings: string[];
  discarded: boolean;
  /** Why the take ended; `estop` keeps a discarded take on the board (TASK-416). */
  stopReason?: string | null;
}

export interface VrSessionInput {
  /** The session's status, for a session the server has no live state for yet. */
  sessionStatus: string;
  live: VrLiveInput | null;
  lastQuickCheck: VrQuickCheckInput | null;
  /** Episodes listed and not discarded — the kept count before the first live state. */
  keptFallback: number;
  pending: boolean;
  /** The session's `languageInstr` (TASK-418). */
  instruction?: string | null;
  /** Who ended it, when known (TASK-418). */
  endedBy?: string | null;
  /** The session's `frameCount` (TASK-418): the ENDED line's frame total. */
  sessionFrames?: number;
}

export interface VrLabelers {
  group: (group: string) => string;
  warning: (warning: string) => string;
}

/** `left_arm` → "L arm". The session page passes its own labelers; these are the fallback. */
const DEFAULT_LABELERS: VrLabelers = {
  group: (g) => {
    const m = /^(left|right)_(.+)$/.exec(g);
    if (m) return `${m[1] === 'left' ? 'L' : 'R'} ${m[2]!.replace(/_/g, ' ')}`;
    const words = g.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  },
  warning: (w) => {
    const words = w.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  },
};

const finiteOr = <T>(value: number | null | undefined, fallback: T): number | T =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * The view, at server time `nowServerMs`. The take timer counts from the
 * server's start stamp (TASK-410 D5), so the headset and the desktop agree.
 */
export function buildVrSessionView(
  input: VrSessionInput,
  nowServerMs: number,
  labelers: VrLabelers = DEFAULT_LABELERS,
): VrSessionView {
  const live = input.live;
  const capturing = live?.phase === 'capturing';
  let takeElapsedS: number | null = null;
  if (live && capturing) {
    const started = live.takeStartedAt ? Date.parse(live.takeStartedAt) : Number.NaN;
    takeElapsedS = Number.isFinite(started)
      ? Math.max(0, (nowServerMs - started) / 1000)
      : finiteOr(live.takeElapsedS, null);
  }
  const autoStopS = live?.autoStopS ?? null;
  const qc = input.lastQuickCheck;
  const status = live?.status ?? input.sessionStatus;
  const instruction = input.instruction?.trim() ? input.instruction.trim() : null;
  return {
    status,
    phase: live?.phase ?? null,
    take: live?.take ?? null,
    takeElapsedS,
    kept: live ? live.kept : input.keptFallback,
    discarded: live?.discarded ?? 0,
    frames: live ? (capturing ? live.takeFrames : live.totalFrames) : 0,
    fpsActual: finiteOr(live?.fpsActual, null),
    degraded: live?.degraded === true,
    autoStopInS: capturing && autoStopS && takeElapsedS !== null ? Math.max(0, autoStopS - takeElapsedS) : null,
    lastQuickCheck: qc && (!qc.discarded || qc.stopReason === 'estop')
      ? {
        takeNumber: qc.take + 1,
        durationS: qc.durationS,
        frames: qc.frames,
        groups: qc.groupsMoved.map(labelers.group),
        warnings: qc.warnings.map(labelers.warning),
        ...(qc.discarded ? { estopDiscarded: true } : {}),
      }
      : null,
    pending: input.pending,
    instruction,
    endedBy: sessionEnded({ status }) ? input.endedBy ?? null : null,
    sessionFrames: finiteOr(input.sessionFrames, 0),
  };
}

// ============================================================================
// THE SESSION BOARD'S LINES
// ============================================================================

/** How long the camera strip shows a take's verdict after it stopped (TASK-418). */
export const STRIP_VERDICT_MS = 3_000;

export const BOARD_COLORS = {
  rec: 'salmon',
  ok: 'palegreen',
  warn: 'khaki',
  text: 'gainsboro',
  dim: 'darkgray',
} as const;

export interface BoardLine {
  id: string;
  text: string;
  color: string;
  bold?: boolean;
  /** Wrap at word boundaries (the task line), at most `maxRows` rows. */
  wrap?: boolean;
  maxRows?: number;
}

/** `42.4` → `00:42`; `3725` → `62:05`. */
export function formatTakeClock(seconds: number | null): string {
  const s = seconds === null || !Number.isFinite(seconds) ? 0 : Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The number Start would record next, 1-based: the live take while capturing, else the one after the last. */
export function shownTakeNumber(view: Pick<VrSessionView, 'phase' | 'take'>): number {
  if (view.take === null) return 1;
  return view.phase === 'capturing' ? view.take + 1 : view.take + 2;
}

function statusLine(view: VrSessionView, nowMs: number): BoardLine {
  if (view.status === 'paused') return { id: 'status', text: 'PAUSED', color: BOARD_COLORS.warn, bold: true };
  if (sessionEnded(view)) {
    // TASK-418: who ended it and what the session holds, so the wearer is not
    // thrown out of VR without a word.
    const by = view.endedBy ? ` by ${view.endedBy}` : '';
    return {
      id: 'status',
      text: `ENDED${by} · ${view.kept} kept · ${view.sessionFrames} fr`,
      color: BOARD_COLORS.warn,
      bold: true,
    };
  }
  if (view.status !== 'recording') {
    return { id: 'status', text: 'NOT STARTED  start the session on the desktop', color: BOARD_COLORS.dim, bold: true };
  }
  if (view.phase === 'capturing') {
    // The dot blinks at 1 Hz; the space keeps the text from jumping.
    const dot = Math.floor(nowMs / 500) % 2 === 0 ? '●' : '  ';
    return {
      id: 'status',
      text: `${dot} REC  Take ${shownTakeNumber(view)}   ${formatTakeClock(view.takeElapsedS)}`,
      color: BOARD_COLORS.rec,
      bold: true,
    };
  }
  if (view.phase === 'between') {
    return { id: 'status', text: `READY  Take ${shownTakeNumber(view)} next`, color: BOARD_COLORS.ok, bold: true };
  }
  // A recorder without explicit takes: it records continuously.
  return { id: 'status', text: `● REC  Take ${shownTakeNumber(view)}`, color: BOARD_COLORS.rec, bold: true };
}

/** The board's task line wraps onto at most this many rows (TASK-418). */
export const INSTRUCTION_MAX_ROWS = 2;

/**
 * The board, top to bottom (TASK-418):
 *   1. the task to demonstrate (wrapped, two rows at most), when the session has one
 *   2. `● REC  Take 7   00:42` / `READY  Take 8 next` / `PAUSED` / `ENDED by Ben · 9 kept · 1523 fr`
 *   3. `kept 6 · discarded 1`
 *   4. `707 fr · 30 fps · OK · auto-stop 12 s` — only while capturing or degraded;
 *      between takes it was noise (`1523 fr total · 0 fps · OK`)
 *   5–6. the last take's quick check, kept until the next Start or the end of
 *      the session (D3) — the desktop shows the same card for the same time.
 *      A take the E-stop aborted (TASK-416) shows one line instead: it was
 *      discarded — its numbers describe frames that were thrown away.
 */
export function composeSessionBoard(view: VrSessionView, nowMs: number): BoardLine[] {
  const capturing = view.phase === 'capturing';
  const ended = sessionEnded(view);
  const lines: BoardLine[] = [];
  if (view.instruction) {
    lines.push({ id: 'task', text: view.instruction, color: BOARD_COLORS.text, wrap: true, maxRows: INSTRUCTION_MAX_ROWS });
  }
  lines.push(statusLine(view, nowMs));
  if (!ended) {
    lines.push({ id: 'counts', text: `kept ${view.kept} · discarded ${view.discarded}`, color: BOARD_COLORS.text });
  }
  if (!ended && (capturing || view.degraded)) {
    const fps = view.fpsActual === null ? '— fps' : `${Math.round(view.fpsActual)} fps`;
    const frames = capturing ? `${view.frames} fr` : `${view.frames} fr total`;
    const stats = [frames, fps, view.degraded ? 'DEGRADED' : 'OK'];
    if (view.autoStopInS !== null) stats.push(`auto-stop ${Math.ceil(view.autoStopInS)} s`);
    lines.push({ id: 'stats', text: stats.join(' · '), color: view.degraded ? BOARD_COLORS.warn : BOARD_COLORS.text });
  }
  const qc = view.lastQuickCheck;
  if (qc?.estopDiscarded && !capturing && !ended) {
    lines.push({
      id: 'qc-verdict',
      text: `Take ${qc.takeNumber} stopped by the E-stop — discarded`,
      color: BOARD_COLORS.warn,
      bold: true,
    });
  } else if (qc && !capturing && !ended) {
    const groups = qc.groups.length > 0 ? qc.groups.join(' + ') : 'nothing moved';
    lines.push({
      id: 'qc',
      text: `Take ${qc.takeNumber} · ${qc.durationS.toFixed(1)} s · ${qc.frames} fr · ${groups}`,
      color: BOARD_COLORS.text,
    });
    lines.push(qc.warnings.length > 0
      ? { id: 'qc-verdict', text: `⚠ ${qc.warnings.join(' · ')}`, color: BOARD_COLORS.warn, bold: true }
      : { id: 'qc-verdict', text: '✓ looks good', color: BOARD_COLORS.ok, bold: true });
  }
  return lines;
}

/** Which session buttons the board shows, and whether they may be pressed. */
export interface BoardButtons {
  start: boolean;
  stop: boolean;
  next: boolean;
  discard: boolean;
  /** False greys every session button out (not recording, or an action in flight). */
  enabled: boolean;
}

/** Start between takes, Stop while capturing — one slot (D3); Next only while capturing. */
export function boardButtons(view: VrSessionView): BoardButtons {
  const recording = view.status === 'recording';
  const capturing = view.phase === 'capturing';
  return {
    start: !capturing,
    stop: capturing,
    next: capturing,
    discard: view.take !== null,
    enabled: recording && !view.pending,
  };
}

// ============================================================================
// THE WRIST HUD'S TAKE LINE
// ============================================================================

/** What the wrist HUD's first line reads off the session. */
export interface HudTake {
  phase: 'capturing' | 'between';
  /** 1-based. */
  takeNumber: number;
  elapsedS: number | null;
}

/** Null while the session is not recording — the HUD then spends no line on it. */
export function hudTakeOf(view: VrSessionView | null | undefined): HudTake | null {
  if (!view || view.status !== 'recording') return null;
  return {
    phase: view.phase === 'between' ? 'between' : 'capturing',
    takeNumber: shownTakeNumber(view),
    elapsedS: view.phase === 'capturing' ? view.takeElapsedS : null,
  };
}

// ============================================================================
// THE HEAD-CAMERA SCREEN'S STRIP (TASK-418, D2)
// ============================================================================

/**
 * What the strip remembers between frames: the phase and take it last saw, the
 * discard count, the live take's last clock reading, and the verdict on the
 * take that just ended. Pure data, stepped by `stepCameraStrip`.
 */
export interface CameraStripMemory {
  phase: VrSessionView['phase'];
  take: number | null;
  discarded: number;
  /** The live take's clock as last read, for a kept take whose quick check has not arrived. */
  lastElapsedS: number | null;
  verdict: {
    kind: 'stopped' | 'discarded';
    /** 1-based. */
    takeNumber: number;
    durationS: number | null;
    atMs: number;
  } | null;
}

/** The memory before the strip has seen the session: nothing to report yet. */
export function initialCameraStrip(view: VrSessionView): CameraStripMemory {
  return { phase: view.phase, take: view.take, discarded: view.discarded, lastElapsedS: null, verdict: null };
}

/**
 * One read of the session. A take that went from capturing to between is
 * `stopped`; a discard count that went up is `discarded` (the take last seen —
 * the live one for a hold-discard while capturing). The next Start clears it.
 */
export function stepCameraStrip(prev: CameraStripMemory, view: VrSessionView, nowMs: number): CameraStripMemory {
  let verdict = prev.verdict;
  const capturing = view.phase === 'capturing';
  if (view.discarded > prev.discarded && prev.take !== null) {
    verdict = { kind: 'discarded', takeNumber: prev.take + 1, durationS: null, atMs: nowMs };
  } else if (prev.phase === 'capturing' && !capturing && prev.take !== null) {
    verdict = { kind: 'stopped', takeNumber: prev.take + 1, durationS: prev.lastElapsedS, atMs: nowMs };
  } else if (capturing && (prev.phase !== 'capturing' || view.take !== prev.take)) {
    verdict = null;
  }
  return {
    phase: view.phase,
    take: view.take,
    discarded: view.discarded,
    lastElapsedS: capturing ? view.takeElapsedS : null,
    verdict,
  };
}

export type CameraStripTone = 'rec' | 'estop' | 'ok' | 'warn' | 'dim' | 'ended';

export interface CameraStrip {
  text: string;
  tone: CameraStripTone;
  /** The screen's frame turns red (REC and the latched E-stop). */
  redFrame: boolean;
}

/**
 * The strip along the top of the camera screen, where the operator looks
 * during a take. Priority: the latched E-stop over everything (it is the one
 * state that must never be missed), then the session's end, then REC, then
 * for `STRIP_VERDICT_MS` the verdict on the take that just stopped (an
 * E-stop abort says so, TASK-416). Null:
 * no strip, normal frame.
 */
export function composeCameraStrip(
  view: VrSessionView | null,
  estopLatched: boolean,
  memory: CameraStripMemory | null,
  nowMs: number,
): CameraStrip | null {
  if (estopLatched) return { text: 'E-STOP — hold Reset (right panel)', tone: 'estop', redFrame: true };
  if (!view) return null;
  if (sessionEnded(view)) return { text: 'Session ended — take the headset off', tone: 'ended', redFrame: false };
  if (view.status === 'recording' && view.phase === 'capturing') {
    return {
      text: `● REC  Take ${shownTakeNumber(view)}  ${formatTakeClock(view.takeElapsedS)}`,
      tone: 'rec',
      redFrame: true,
    };
  }
  const verdict = memory?.verdict;
  if (!verdict || nowMs - verdict.atMs >= STRIP_VERDICT_MS) return null;
  const qc = view.lastQuickCheck?.takeNumber === verdict.takeNumber ? view.lastQuickCheck : null;
  // TASK-416: the robot ended this take on an E-stop and threw it away — the
  // same words as the board and the desktop, whichever way the strip saw it end.
  if (qc?.estopDiscarded) {
    return { text: `Take ${verdict.takeNumber} stopped by the E-stop — discarded`, tone: 'warn', redFrame: false };
  }
  if (verdict.kind === 'discarded') {
    return { text: `Take ${verdict.takeNumber} discarded`, tone: 'dim', redFrame: false };
  }
  if (qc && qc.warnings.length > 0) {
    return { text: `⚠ ${qc.warnings[0]} — Discard on the board`, tone: 'warn', redFrame: false };
  }
  const durationS = qc ? qc.durationS : verdict.durationS;
  const duration = durationS !== null && Number.isFinite(durationS) ? ` · ${durationS.toFixed(1)} s` : '';
  return { text: `✓ Take ${verdict.takeNumber} kept${duration}`, tone: 'ok', redFrame: false };
}

// ============================================================================
// THE STICK SHORTCUTS (D1)
// ============================================================================

/** Right stick held this long discards the last take. */
export const DISCARD_HOLD_MS = 1_500;
/** Countdown pulses during the hold, evenly spaced before the confirm. */
export const DISCARD_HOLD_TICKS = 3;

export type SessionKeyAction = 'start' | 'stop' | 'next' | 'discardLast';
export type SessionKeyBuzz = 'tick' | 'confirm' | 'refused';

export interface SessionKeysState {
  leftWasDown: boolean;
  /** When the current right-stick press began, ms; null when it is up. */
  rightSince: number | null;
  /** Countdown pulses already given for this press. */
  rightTicks: number;
  /** This press already discarded; letting go does nothing more. */
  rightFired: boolean;
  /** This press was refused at the edge; letting go does nothing. */
  rightRefused: boolean;
}

export const IDLE_SESSION_KEYS: SessionKeysState = {
  leftWasDown: false,
  rightSince: null,
  rightTicks: 0,
  rightFired: false,
  rightRefused: false,
};

export interface SessionKeysInput {
  /** `isStickClick` on each thumbstick this frame. */
  leftClick: boolean;
  rightClick: boolean;
  now: number;
  phase: 'between' | 'capturing' | null;
  /**
   * False while the E-stop is latched or the session is not recording: a press
   * then buzzes `refused` and does nothing, like the greyed-out board buttons.
   */
  enabled: boolean;
}

export interface SessionKeysStep {
  state: SessionKeysState;
  action: SessionKeyAction | null;
  buzz: SessionKeyBuzz | null;
}

/**
 * One frame of the two stick clicks.
 *
 * - LEFT click, on the press edge: Start between takes, Stop while capturing.
 *   A recorder without explicit takes (`phase` null) gets Start, which the
 *   session page maps to its old episode boundary.
 * - RIGHT click: Next — on RELEASE, so a press that becomes a hold never also
 *   advances. Held `DISCARD_HOLD_MS`: Discard last, after `DISCARD_HOLD_TICKS`
 *   countdown ticks, with a confirm pulse. An accidental click can never
 *   destroy a take (D1).
 */
export function stepSessionKeys(prev: SessionKeysState, input: SessionKeysInput): SessionKeysStep {
  let action: SessionKeyAction | null = null;
  let buzz: SessionKeyBuzz | null = null;
  const state: SessionKeysState = { ...prev, leftWasDown: input.leftClick };

  if (input.leftClick && !prev.leftWasDown) {
    if (!input.enabled) buzz = 'refused';
    else action = input.phase === 'capturing' ? 'stop' : 'start';
  }

  if (input.rightClick) {
    if (prev.rightSince === null) {
      state.rightSince = input.now;
      state.rightTicks = 0;
      state.rightFired = false;
      state.rightRefused = !input.enabled;
      if (!input.enabled) buzz = 'refused';
    } else if (!prev.rightFired && !prev.rightRefused) {
      const held = input.now - prev.rightSince;
      if (held >= DISCARD_HOLD_MS) {
        if (input.enabled) {
          state.rightFired = true;
          action = action ?? 'discardLast';
          buzz = 'confirm';
        } else {
          state.rightRefused = true;
          buzz = 'refused';
        }
      } else {
        const due = Math.floor((held / DISCARD_HOLD_MS) * (DISCARD_HOLD_TICKS + 1));
        if (due > prev.rightTicks && due <= DISCARD_HOLD_TICKS) {
          state.rightTicks = due;
          buzz = buzz ?? 'tick';
        }
      }
    }
  } else if (prev.rightSince !== null) {
    if (!prev.rightFired && !prev.rightRefused) {
      if (input.enabled) action = action ?? 'next';
      else buzz = 'refused';
    }
    state.rightSince = null;
    state.rightTicks = 0;
    state.rightFired = false;
    state.rightRefused = false;
  }

  return { state, action, buzz };
}
