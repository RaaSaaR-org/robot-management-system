/**
 * @file vrSessionBridge.test.ts
 * @description TASK-413: the headset's view of the session — the view builder,
 *              the session board's lines and buttons, the wrist HUD's take,
 *              the answer haptics, and the stick shortcuts driven by fake
 *              gamepad frames through the same `isStickClick` the rig uses.
 *              TASK-418: the task line, the persistent quick check, the ENDED
 *              line and the camera strip's priority (E-stop > REC > verdict).
 * @feature robots
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BOARD_COLORS,
  DISCARD_HOLD_MS,
  IDLE_SESSION_KEYS,
  STRIP_VERDICT_MS,
  boardButtons,
  buildVrSessionView,
  composeCameraStrip,
  composeSessionBoard,
  initialCameraStrip,
  stepCameraStrip,
  formatTakeClock,
  hudTakeOf,
  stepSessionKeys,
  withTakeHaptics,
  type SessionKeyAction,
  type SessionKeyBuzz,
  type SessionKeysState,
  type VrLiveInput,
  type VrSessionBridge,
  type VrSessionInput,
  type VrSessionView,
} from '../vrSessionBridge';
import { isStickClick, type StickComponentState } from '../vrDrive';
import { HAPTICS, clearHapticQueue, drainHapticQueue, pendingHaptics, resetHaptics } from '../vrHaptics';

const T0 = Date.parse('2026-10-18T10:00:00.000Z');

function live(overrides: Partial<VrLiveInput> = {}): VrLiveInput {
  return {
    status: 'recording',
    phase: 'capturing',
    take: 6,
    takeStartedAt: new Date(T0 - 42_400).toISOString(),
    takeElapsedS: 40,
    takeFrames: 707,
    totalFrames: 5230,
    kept: 6,
    discarded: 1,
    fpsActual: 29.6,
    degraded: false,
    autoStopS: null,
    ...overrides,
  };
}

function input(overrides: Partial<VrSessionInput> = {}): VrSessionInput {
  return { sessionStatus: 'recording', live: live(), lastQuickCheck: null, keptFallback: 0, pending: false, ...overrides };
}

const view = (overrides: Partial<VrSessionInput> = {}, now = T0): VrSessionView => buildVrSessionView(input(overrides), now);

describe('buildVrSessionView', () => {
  it('times the take from the server start stamp, not the client clock', () => {
    const v = view();
    expect(v.phase).toBe('capturing');
    expect(v.takeElapsedS).toBeCloseTo(42.4, 5);
    expect(v.frames).toBe(707);
    expect(v.kept).toBe(6);
    expect(v.discarded).toBe(1);
  });

  it('falls back to the server elapsed seconds when there is no stamp', () => {
    expect(view({ live: live({ takeStartedAt: null }) }).takeElapsedS).toBe(40);
  });

  it('counts down the auto-stop on the same clock', () => {
    expect(view({ live: live({ autoStopS: 55 }) }).autoStopInS).toBeCloseTo(12.6, 5);
    expect(view({ live: live({ autoStopS: 55, phase: 'between' }) }).autoStopInS).toBeNull();
  });

  it('shows the session total between takes, and no timer', () => {
    const v = view({ live: live({ phase: 'between', takeStartedAt: null }) });
    expect(v.takeElapsedS).toBeNull();
    expect(v.frames).toBe(5230);
  });

  it('uses the session status and the listed kept count before the first live state', () => {
    const v = view({ live: null, sessionStatus: 'paused', keptFallback: 3 });
    expect(v.status).toBe('paused');
    expect(v.kept).toBe(3);
    expect(v.phase).toBeNull();
  });

  it('labels the quick check 1-based, and drops one already discarded', () => {
    const qc = { take: 5, frames: 707, durationS: 23.44, groupsMoved: ['left_arm', 'right_hand'], warnings: [], discarded: false };
    expect(view({ lastQuickCheck: qc }).lastQuickCheck).toEqual({
      takeNumber: 6, durationS: 23.44, frames: 707, groups: ['L arm', 'R hand'], warnings: [],
    });
    expect(view({ lastQuickCheck: { ...qc, discarded: true } }).lastQuickCheck).toBeNull();
  });
});

describe('composeSessionBoard', () => {
  const qc = { take: 5, frames: 707, durationS: 23.44, groupsMoved: ['left_arm', 'right_hand'], warnings: [], discarded: false };

  it('reads ● REC, the 1-based take and the timer while capturing, with the stats', () => {
    const lines = composeSessionBoard(view(), 0);
    expect(lines[0]).toMatchObject({ text: '● REC  Take 7   00:42', color: BOARD_COLORS.rec });
    expect(lines[1].text).toBe('kept 6 · discarded 1');
    expect(lines[2].text).toBe('707 fr · 30 fps · OK');
    expect(lines).toHaveLength(3);
  });

  it('puts the task instruction first, wrapped to two rows at most', () => {
    const lines = composeSessionBoard(view({ instruction: '  pick up the red cube and place it in the bin ' }), 0);
    expect(lines[0]).toMatchObject({ id: 'task', text: 'pick up the red cube and place it in the bin', wrap: true, maxRows: 2 });
    expect(lines[1].text).toMatch(/^● REC/);
    expect(composeSessionBoard(view({ instruction: '   ' }), 0)[0].id).toBe('status');
  });

  it('blinks the dot without moving the text', () => {
    const on = composeSessionBoard(view(), 0)[0].text;
    const off = composeSessionBoard(view(), 500)[0].text;
    expect(on).toContain('●');
    expect(off).not.toContain('●');
    expect(off.trim()).toBe(on.replace('●', '').trim());
  });

  it('says READY between takes and drops the frame/fps noise', () => {
    const lines = composeSessionBoard(view({ live: live({ phase: 'between' }) }), 0);
    expect(lines.map((l) => l.text)).toEqual(['READY  Take 8 next', 'kept 6 · discarded 1']);
  });

  it('keeps the stats between takes while degraded', () => {
    const lines = composeSessionBoard(view({ live: live({ phase: 'between', degraded: true }) }), 0);
    expect(lines[2]).toMatchObject({ text: '5230 fr total · 30 fps · DEGRADED', color: BOARD_COLORS.warn });
  });

  it('says PAUSED for a paused session', () => {
    expect(composeSessionBoard(view({ live: live({ status: 'paused' }) }), 0)[0].text).toBe('PAUSED');
  });

  it('says who ENDED the session, the kept takes and the final frames', () => {
    const ended = view({
      live: live({ status: 'completed', phase: null, totalFrames: 0, kept: 9 }),
      sessionFrames: 1523,
      endedBy: 'Ben',
      lastQuickCheck: qc,
    });
    const lines = composeSessionBoard(ended, 0);
    expect(lines.map((l) => l.text)).toEqual(['ENDED by Ben · 9 kept · 1523 fr']);
    const anonymous = view({ live: live({ status: 'completed', phase: null, kept: 2 }), sessionFrames: 40 });
    expect(composeSessionBoard(anonymous, 0)[0].text).toBe('ENDED · 2 kept · 40 fr');
  });

  it('does not name an ender while the session runs', () => {
    expect(view({ endedBy: 'Ben' }).endedBy).toBeNull();
  });

  it('flags a degraded link and the auto-stop', () => {
    const lines = composeSessionBoard(view({ live: live({ degraded: true, autoStopS: 55 }) }), 0);
    expect(lines[2]).toMatchObject({ text: '707 fr · 30 fps · DEGRADED · auto-stop 13 s', color: BOARD_COLORS.warn });
  });

  it('keeps the quick check until the next Start (D3), never on a timer', () => {
    const between = view({ live: live({ phase: 'between' }), lastQuickCheck: qc });
    for (const now of [0, 6_000, 30_000, 600_000]) {
      const lines = composeSessionBoard(between, now);
      expect(lines[2].text).toBe('Take 6 · 23.4 s · 707 fr · L arm + R hand');
      expect(lines[3]).toMatchObject({ text: '✓ looks good', color: BOARD_COLORS.ok });
    }
    // The next Start: capturing hides it.
    expect(composeSessionBoard(view({ lastQuickCheck: qc }), 30_000).some((l) => l.id === 'qc')).toBe(false);
  });

  it('says a take the E-stop aborted was discarded, until the next Start (TASK-416)', () => {
    const aborted = { take: 10, frames: 0, durationS: 4.2, groupsMoved: [], warnings: ['short'], discarded: true, stopReason: 'estop' };
    const v = view({ live: live({ phase: 'between' }), lastQuickCheck: aborted });
    expect(v.lastQuickCheck).toMatchObject({ takeNumber: 11, estopDiscarded: true });
    for (const now of [0, 30_000]) {
      const lines = composeSessionBoard(v, now);
      expect(lines[0].text).toBe('READY  Take 8 next');
      expect(lines[2]).toMatchObject({ id: 'qc-verdict', text: 'Take 11 stopped by the E-stop — discarded', color: BOARD_COLORS.warn });
      expect(lines).toHaveLength(3);
    }
    // The next Start hides it, like any quick check.
    expect(composeSessionBoard(view({ lastQuickCheck: aborted }), 0).some((l) => l.id === 'qc-verdict')).toBe(false);
    // Any other discarded take still leaves the board.
    expect(view({ lastQuickCheck: { ...aborted, stopReason: 'operator' } }).lastQuickCheck).toBeNull();
  });

  it('puts the warnings in place of "looks good"', () => {
    const warned = { take: 2, frames: 30, durationS: 1, groupsMoved: [], warnings: ['short', 'no_motion'], discarded: false };
    const lines = composeSessionBoard(view({ live: live({ phase: 'between' }), lastQuickCheck: warned }), 0);
    expect(lines[2].text).toBe('Take 3 · 1.0 s · 30 fr · nothing moved');
    expect(lines[3]).toMatchObject({ text: '⚠ Short · No motion', color: BOARD_COLORS.warn });
  });
});

describe('the camera strip (TASK-418)', () => {
  const capturing = (o: Partial<VrLiveInput> = {}) => view({ live: live({ take: 2, takeStartedAt: new Date(T0 - 12_300).toISOString(), ...o }) });
  const between = (o: Partial<VrLiveInput> = {}, extra: Partial<VrSessionInput> = {}) =>
    view({ live: live({ take: 2, phase: 'between', takeStartedAt: null, ...o }), ...extra });

  it('shows REC with the take and its clock while capturing, on a red frame', () => {
    const v = capturing();
    expect(composeCameraStrip(v, false, initialCameraStrip(v), T0)).toEqual({ text: '● REC  Take 3  00:12', tone: 'rec', redFrame: true });
  });

  it('puts the latched E-stop over everything, REC and the end included', () => {
    const v = capturing();
    const estop = { text: 'E-STOP — hold Reset (right panel)', tone: 'estop', redFrame: true };
    expect(composeCameraStrip(v, true, initialCameraStrip(v), T0)).toEqual(estop);
    expect(composeCameraStrip(null, true, null, T0)).toEqual(estop);
    const ended = view({ live: live({ status: 'completed', phase: null }) });
    expect(composeCameraStrip(ended, true, null, T0)).toEqual(estop);
  });

  it('says the session ended, until VR closes', () => {
    const ended = view({ live: live({ status: 'completed', phase: null }) });
    expect(composeCameraStrip(ended, false, null, T0)).toEqual({
      text: 'Session ended — take the headset off', tone: 'ended', redFrame: false,
    });
  });

  it('shows nothing between takes with no fresh verdict, and nothing without a session', () => {
    const v = between();
    expect(composeCameraStrip(v, false, initialCameraStrip(v), T0)).toBeNull();
    expect(composeCameraStrip(null, false, null, T0)).toBeNull();
  });

  it('reports a kept take for 3 s after its stop, with the quick check duration', () => {
    let m = initialCameraStrip(capturing());
    m = stepCameraStrip(m, capturing(), T0);
    const stopped = between({}, { lastQuickCheck: { take: 2, frames: 400, durationS: 13.46, groupsMoved: ['left_arm'], warnings: [], discarded: false } });
    m = stepCameraStrip(m, stopped, T0 + 100);
    expect(composeCameraStrip(stopped, false, m, T0 + 100)).toEqual({ text: '✓ Take 3 kept · 13.5 s', tone: 'ok', redFrame: false });
    expect(composeCameraStrip(stopped, false, m, T0 + 100 + STRIP_VERDICT_MS - 1)).not.toBeNull();
    expect(composeCameraStrip(stopped, false, m, T0 + 100 + STRIP_VERDICT_MS)).toBeNull();
  });

  it('falls back to the clock it last read when the quick check has not arrived', () => {
    let m = initialCameraStrip(capturing());
    m = stepCameraStrip(m, capturing(), T0);
    m = stepCameraStrip(m, between(), T0 + 100);
    expect(composeCameraStrip(between(), false, m, T0 + 100)?.text).toBe('✓ Take 3 kept · 12.3 s');
  });

  it('names the first quick-check warning instead', () => {
    let m = stepCameraStrip(initialCameraStrip(capturing()), capturing(), T0);
    const stopped = between({}, { lastQuickCheck: { take: 2, frames: 30, durationS: 1, groupsMoved: [], warnings: ['no_motion', 'short'], discarded: false } });
    m = stepCameraStrip(m, stopped, T0 + 100);
    expect(composeCameraStrip(stopped, false, m, T0 + 100)).toEqual({ text: '⚠ No motion — Discard on the board', tone: 'warn', redFrame: false });
  });

  it('says a discarded take was discarded', () => {
    let m = stepCameraStrip(initialCameraStrip(capturing()), capturing(), T0);
    const discarded = between({ discarded: 2 });
    m = stepCameraStrip(m, discarded, T0 + 100);
    expect(composeCameraStrip(discarded, false, m, T0 + 100)?.text).toBe('Take 3 discarded');
  });

  it('drops the verdict on the next Start', () => {
    let m = stepCameraStrip(initialCameraStrip(capturing()), capturing(), T0);
    m = stepCameraStrip(m, between(), T0 + 100);
    const next = capturing({ take: 3 });
    m = stepCameraStrip(m, next, T0 + 200);
    expect(m.verdict).toBeNull();
    expect(composeCameraStrip(next, false, m, T0 + 200)?.tone).toBe('rec');
  });

  it('says a take the E-stop aborted was discarded, in the board\'s words (TASK-416)', () => {
    let m = stepCameraStrip(initialCameraStrip(capturing()), capturing(), T0);
    const aborted = between({ discarded: 2 }, {
      lastQuickCheck: { take: 2, frames: 0, durationS: 3, groupsMoved: [], warnings: ['short'], discarded: true, stopReason: 'estop' },
    });
    m = stepCameraStrip(m, aborted, T0 + 100);
    expect(composeCameraStrip(aborted, false, m, T0 + 100)).toEqual({
      text: 'Take 3 stopped by the E-stop — discarded', tone: 'warn', redFrame: false,
    });
    // While the rig itself is latched, the E-stop line still wins.
    expect(composeCameraStrip(aborted, true, m, T0 + 100)?.tone).toBe('estop');
  });
});

describe('boardButtons', () => {
  it('shows Start between takes and Stop + Next while capturing, in one slot', () => {
    expect(boardButtons(view({ live: live({ phase: 'between' }) }))).toMatchObject({ start: true, stop: false, next: false });
    expect(boardButtons(view())).toMatchObject({ start: false, stop: true, next: true, discard: true, enabled: true });
  });

  it('hides Discard last before the first take', () => {
    expect(boardButtons(view({ live: live({ phase: 'between', take: null }) })).discard).toBe(false);
  });

  it('greys everything out while not recording or while an action is in flight', () => {
    expect(boardButtons(view({ live: live({ status: 'paused' }) })).enabled).toBe(false);
    expect(boardButtons(view({ pending: true })).enabled).toBe(false);
  });
});

describe('hudTakeOf / formatTakeClock', () => {
  it('gives the wrist HUD the take only while recording', () => {
    expect(hudTakeOf(view())).toEqual({ phase: 'capturing', takeNumber: 7, elapsedS: expect.closeTo(42.4, 5) });
    expect(hudTakeOf(view({ live: live({ phase: 'between' }) }))).toEqual({ phase: 'between', takeNumber: 8, elapsedS: null });
    expect(hudTakeOf(view({ live: live({ status: 'paused' }) }))).toBeNull();
    expect(hudTakeOf(undefined)).toBeNull();
  });

  it('formats mm:ss and never NaN', () => {
    expect(formatTakeClock(42.9)).toBe('00:42');
    expect(formatTakeClock(3725)).toBe('62:05');
    expect(formatTakeClock(Number.NaN)).toBe('00:00');
    expect(formatTakeClock(null)).toBe('00:00');
  });
});

// ---- the stick shortcuts, from fake gamepad frames ---------------------------

/** One fake gamepad frame: the two thumbstick components as `@pmndrs/xr` reports them. */
interface FakeFrame {
  left?: StickComponentState['state'];
  right?: StickComponentState['state'];
  at: number;
}

interface Run {
  actions: Array<{ action: SessionKeyAction; at: number }>;
  buzzes: Array<{ buzz: SessionKeyBuzz; at: number }>;
  state: SessionKeysState;
}

function play(frames: FakeFrame[], opts: { phase?: 'between' | 'capturing' | null; enabled?: boolean } = {}): Run {
  let state = IDLE_SESSION_KEYS;
  const run: Run = { actions: [], buzzes: [], state };
  for (const f of frames) {
    const step = stepSessionKeys(state, {
      leftClick: isStickClick({ state: f.left ?? 'default' }),
      rightClick: isStickClick({ state: f.right ?? 'default' }),
      now: f.at,
      phase: opts.phase === undefined ? 'between' : opts.phase,
      enabled: opts.enabled ?? true,
    });
    state = step.state;
    if (step.action) run.actions.push({ action: step.action, at: f.at });
    if (step.buzz) run.buzzes.push({ buzz: step.buzz, at: f.at });
  }
  run.state = state;
  return run;
}

/** Frames every 10 ms from `from` to `to` with the given stick states. */
function hold(side: 'left' | 'right', from: number, to: number, value: StickComponentState['state'] = 'pressed'): FakeFrame[] {
  const out: FakeFrame[] = [];
  for (let t = from; t <= to; t += 10) out.push({ [side]: value, at: t });
  return out;
}

describe('stepSessionKeys — fake gamepad frames (D1)', () => {
  it('left click starts between takes, on the press edge, once', () => {
    const run = play([{ at: 0 }, ...hold('left', 10, 300), { at: 310 }]);
    expect(run.actions).toEqual([{ action: 'start', at: 10 }]);
  });

  it('left click stops while capturing', () => {
    const run = play([{ at: 0 }, ...hold('left', 10, 60), { at: 70 }], { phase: 'capturing' });
    expect(run.actions.map((a) => a.action)).toEqual(['stop']);
  });

  it('a pushed stick (touched, not clicked) never starts, stops or advances anything', () => {
    const run = play([...hold('left', 0, 2000, 'touched'), ...hold('right', 2010, 4000, 'touched'), { at: 4010 }]);
    expect(run.actions).toEqual([]);
    expect(run.buzzes).toEqual([]);
  });

  it('right click is Next — on release, so a hold never also advances', () => {
    const run = play([{ at: 0 }, ...hold('right', 10, 200), { at: 210 }], { phase: 'capturing' });
    expect(run.actions).toEqual([{ action: 'next', at: 210 }]);
  });

  it('right held 1.5 s discards the last take after three countdown ticks and a confirm, and nothing else', () => {
    const run = play([{ at: 0 }, ...hold('right', 10, 10 + DISCARD_HOLD_MS + 500), { at: 10 + DISCARD_HOLD_MS + 510 }], {
      phase: 'capturing',
    });
    expect(run.actions).toEqual([{ action: 'discardLast', at: 10 + DISCARD_HOLD_MS }]);
    expect(run.buzzes.map((b) => b.buzz)).toEqual(['tick', 'tick', 'tick', 'confirm']);
    // The ticks are spread across the hold, before the confirm.
    expect(run.buzzes.slice(0, 3).every((b) => b.at < 10 + DISCARD_HOLD_MS)).toBe(true);
  });

  it('letting go before 1.5 s is a Next, never a Discard', () => {
    const run = play([{ at: 0 }, ...hold('right', 10, 1200), { at: 1210 }]);
    expect(run.actions.map((a) => a.action)).toEqual(['next']);
    expect(run.buzzes.map((b) => b.buzz)).toEqual(['tick', 'tick', 'tick']);
  });

  it('while disabled (E-stop latched, not recording) every press is refused and nothing is sent', () => {
    const run = play(
      [{ at: 0 }, ...hold('left', 10, 50), { at: 60 }, ...hold('right', 70, 70 + DISCARD_HOLD_MS + 100), { at: 2000 }],
      { enabled: false },
    );
    expect(run.actions).toEqual([]);
    expect(run.buzzes.map((b) => b.buzz)).toEqual(['refused', 'refused']);
  });

  it('a press held across the end of a session is not replayed', () => {
    const run = play([...hold('left', 0, 100), { at: 110 }]);
    expect(run.actions).toHaveLength(1);
    expect(run.state.leftWasDown).toBe(false);
  });
});

// ---- the answer haptics -------------------------------------------------------

describe('withTakeHaptics', () => {
  const pulses: Array<{ value: number; ms: number }> = [];
  const source = {
    handedness: 'right',
    gamepad: { hapticActuators: [{ pulse: (value: number, ms: number) => { pulses.push({ value, ms }); return Promise.resolve(true); } }] },
  };
  const bridge = (outcome: 'ok' | 'refused' | 'throw'): VrSessionBridge => {
    const run = () => (outcome === 'throw' ? Promise.reject(new Error('net')) : Promise.resolve(outcome));
    return {
      getState: () => view(),
      actions: { start: run, stop: run, next: run, discardLast: run },
    };
  };

  beforeEach(() => {
    pulses.length = 0;
    clearHapticQueue();
    resetHaptics();
  });

  it('buzzes episodeMark when the action landed', async () => {
    expect(await withTakeHaptics(bridge('ok')).actions.start()).toBe('ok');
    drainHapticQueue([source], Date.now() + 10);
    expect(pulses).toEqual([{ value: HAPTICS.episodeMark.intensity, ms: HAPTICS.episodeMark.ms }]);
  });

  it('taps twice, short, when the session refused it (a 409 the store adopted)', async () => {
    const now = Date.now();
    expect(await withTakeHaptics(bridge('refused')).actions.stop()).toBe('refused');
    drainHapticQueue([source], now + 1_000);
    drainHapticQueue([source], now + 1_200);
    expect(pulses).toEqual([
      { value: HAPTICS.refusedTap.intensity, ms: HAPTICS.refusedTap.ms },
      { value: HAPTICS.refusedTap.intensity, ms: HAPTICS.refusedTap.ms },
    ]);
    expect(pendingHaptics()).toBe(0);
  });

  it('treats a thrown action as refused, never as success', async () => {
    expect(await withTakeHaptics(bridge('throw')).actions.discardLast()).toBe('refused');
    expect(pendingHaptics()).toBe(2);
  });
});
