/**
 * @file vrHud.test.ts
 * @description Tests for the in-headset HUD lines, the controller markers and
 *              the round-trip-time reducer.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  composeHud,
  hudArmSuffix,
  hudHandWarning,
  hudNeedsRelease,
  sameClutch,
  HUD_RELEASE_GRIP,
  HUD_USE_CONTROLLERS,
  hudMode,
  isPoseFrame,
  markerAppearance,
  createLoopHealth,
  onPositionsSent,
  onStateReceived,
  HUD_COLORS,
  HUD_MAX_LINES,
  RTT_EMA_ALPHA,
  type HudState,
} from '../vrHud';

const BASE: HudState = {
  estopLatched: false,
  link: 'live',
  msSinceState: 42,
  armLeft: false,
  armRight: false,
  driving: false,
  vx: 0,
  vy: 0,
  omega: 0,
};

describe('hudMode', () => {
  it('names each combination of hands', () => {
    expect(hudMode({ armLeft: false, armRight: false, driving: false })).toBe('IDLE');
    expect(hudMode({ armLeft: false, armRight: false, driving: true })).toBe('DRIVE');
    expect(hudMode({ armLeft: true, armRight: false, driving: false })).toBe('ARM-L');
    expect(hudMode({ armLeft: false, armRight: true, driving: false })).toBe('ARM-R');
    expect(hudMode({ armLeft: true, armRight: true, driving: false })).toBe('ARM-LR');
  });

  it('an engaged arm outranks driving — that is the hand the operator is watching', () => {
    expect(hudMode({ armLeft: true, armRight: false, driving: true })).toBe('ARM-L');
  });
});

describe('composeHud', () => {
  it('shows link, mode, speed and turn', () => {
    const lines = composeHud({ ...BASE, armLeft: true, vx: 0.25, vy: 0.1, omega: -0.5 });
    expect(lines.map((l) => l.id)).toEqual(['link', 'mode', 'speed', 'turn']);
    expect(lines[0].text).toBe('LINK LIVE 42ms');
    expect(lines[1].text).toBe('MODE ARM-L');
    expect(lines[2].text).toBe('SPEED 0.25 fwd 0.10 left');
    expect(lines[3].text).toBe('TURN -0.50 rad/s');
  });

  it('reports a pure sideways strafe, which the SPEED line used to drop', () => {
    // vy was computed, rotated into the robot frame, sent to the robot, and then
    // never shown: a full-speed lateral walk read `SPEED 0.00 m/s`.
    const lines = composeHud({ ...BASE, driving: true, vx: 0, vy: 0.4 });
    expect(lines[2].text).toBe('SPEED 0.00 fwd 0.40 left');
  });

  it('colours the link line by state', () => {
    expect(composeHud({ ...BASE, link: 'live' })[0].color).toBe(HUD_COLORS.ok);
    expect(composeHud({ ...BASE, link: 'stale' })[0].color).toBe(HUD_COLORS.warn);
    expect(composeHud({ ...BASE, link: 'lost' })[0].color).toBe(HUD_COLORS.bad);
  });

  it('dims the mode line when nothing is happening', () => {
    expect(composeHud(BASE)[1].color).toBe(HUD_COLORS.dim);
    expect(composeHud({ ...BASE, driving: true })[1].color).toBe(HUD_COLORS.text);
  });

  it('a latched E-Stop REPLACES the whole HUD', () => {
    const lines = composeHud({ ...BASE, estopLatched: true, armLeft: true, vx: 0.4 });
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('E-STOP LATCHED');
    expect(lines.every((l) => l.color === HUD_COLORS.bad)).toBe(true);
    expect(lines.some((l) => l.text.includes('SPEED'))).toBe(false);
  });

  it('shows -- rather than a number when no state has ever arrived', () => {
    expect(composeHud({ ...BASE, link: 'lost', msSinceState: null })[0].text).toBe('LINK LOST --');
    expect(composeHud({ ...BASE, msSinceState: Number.NaN })[0].text).toBe('LINK LIVE --');
  });

  it('never shows a negative age from a backwards clock', () => {
    expect(composeHud({ ...BASE, msSinceState: -5 })[0].text).toBe('LINK LIVE 0ms');
  });

  it('shows -- rather than NaN for a non-finite speed', () => {
    const lines = composeHud({ ...BASE, vx: Number.NaN, vy: Number.NaN, omega: Infinity });
    expect(lines[2].text).toBe('SPEED -- fwd -- left');
    expect(lines[3].text).toBe('TURN -- rad/s');
  });

  // `BASE` deliberately has no `recording` key at all: the field is optional so
  // that the robot detail page's teleop modal, which has no session behind it,
  // never has to supply one. These tests spread it as-is, which is the proof.
  it('says nothing about recording when nothing is recording', () => {
    expect(composeHud(BASE).some((l) => l.id === 'rec')).toBe(false);
    expect(composeHud({ ...BASE, recording: null }).some((l) => l.id === 'rec')).toBe(false);
  });

  it('puts REC first while an episode is being captured', () => {
    const lines = composeHud({ ...BASE, recording: { episode: 3, frames: 412 } });
    expect(lines[0].id).toBe('rec');
    expect(lines[0].text).toBe('REC ● ep 3 · 412 fr');
  });

  it('colours REC red — what every camera ever built means by "capturing"', () => {
    const lines = composeHud({ ...BASE, recording: { episode: 1, frames: 0 } });
    expect(lines[0].color).toBe(HUD_COLORS.bad);
  });

  // THE LINE BUDGET. 512 x 256 px of plate at `linePx: 52` holds five lines and
  // `VrWristHud` has already committed the fifth to RTT, so a sixth would be
  // drawn off the canvas. TURN pays for REC because turning in this rig is
  // physical — the operator's own inner ear reports the yaw — which makes it the
  // only line whose information the wearer has a second source for.
  it('drops TURN to pay for REC rather than overflowing the plate', () => {
    const driving = { ...BASE, driving: true, vx: 0.3, omega: -0.4 };
    expect(composeHud(driving).map((l) => l.id)).toEqual(['link', 'mode', 'speed', 'turn']);
    expect(composeHud({ ...driving, recording: { episode: 2, frames: 9 } }).map((l) => l.id)).toEqual(
      ['rec', 'link', 'mode', 'speed'],
    );
  });

  it('never composes more than the plate can hold, recording or not', () => {
    const states: HudState[] = [
      BASE,
      { ...BASE, armLeft: true, armRight: true, driving: true, vx: 1, vy: 1, omega: 1 },
      { ...BASE, recording: { episode: 12, frames: 99999 } },
      { ...BASE, estopLatched: true, recording: { episode: 12, frames: 99999 } },
    ];
    for (const state of states) {
      expect(composeHud(state).length).toBeLessThanOrEqual(HUD_MAX_LINES);
      // Stricter, and the one that actually matters: `VrWristHud` appends RTT to
      // whatever comes back, so `composeHud` may only ever use four of the five.
      expect(composeHud(state).length).toBeLessThanOrEqual(HUD_MAX_LINES - 1);
    }
  });

  it('a latched E-Stop still returns exactly its two red lines while recording', () => {
    const lines = composeHud({
      ...BASE,
      estopLatched: true,
      recording: { episode: 3, frames: 412 },
    });
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('E-STOP LATCHED');
    expect(lines.every((l) => l.color === HUD_COLORS.bad)).toBe(true);
    expect(lines.some((l) => l.id === 'rec')).toBe(false);
  });

  it('shows -- rather than NaN, and never a negative count, on the REC line', () => {
    const lines = composeHud({ ...BASE, recording: { episode: Number.NaN, frames: -3 } });
    expect(lines[0].text).toBe('REC ● ep -- · 0 fr');
  });

  it('rounds a fractional frame count instead of printing a float at the wrist', () => {
    const lines = composeHud({ ...BASE, recording: { episode: 1.4, frames: 412.6 } });
    expect(lines[0].text).toBe('REC ● ep 1 · 413 fr');
  });
});

describe('composeHud — a damped base', () => {
  it('replaces SPEED and TURN, because those two are the lines that would lie', () => {
    // `SetVelocity` answers RPC_OK in a damped FSM and the base does not
    // integrate it, so the rig goes on computing a commanded speed for a robot
    // that will not move. Printing that number is worse than printing nothing.
    const lines = composeHud({ ...BASE, baseDamped: true, driving: true, vx: 0.4, omega: 0.3 });

    expect(lines.map((l) => l.id)).toEqual(['link', 'mode', 'damped']);
    expect(lines[2].text).toContain('BASE DAMPED');
    expect(lines.some((l) => l.text.includes('SPEED'))).toBe(false);
    expect(lines.some((l) => l.text.includes('TURN'))).toBe(false);
  });

  it('leaves the rest of the plate alone — the arms still work', () => {
    // Not a full-plate takeover like the E-Stop: the arms are joint targets and
    // never touch the loco FSM, so a damped robot is still usable for
    // manipulation and LINK/MODE still carry information.
    const lines = composeHud({ ...BASE, baseDamped: true, armLeft: true, armRight: true });

    expect(lines[0].text).toBe('LINK LIVE 42ms');
    expect(lines[1].text).toBe('MODE ARM-LR');
  });

  it('stays out of the way when the base is standing', () => {
    const lines = composeHud({ ...BASE, baseDamped: false, vx: 0.4 });
    expect(lines.map((l) => l.id)).toEqual(['link', 'mode', 'speed', 'turn']);
  });

  it('is outranked by the E-Stop, which still replaces everything', () => {
    const lines = composeHud({ ...BASE, baseDamped: true, estopLatched: true });
    expect(lines.map((l) => l.id)).toEqual(['estop', 'estop-hint']);
  });

  it('still fits the plate while recording, which spends a line of its own', () => {
    const lines = composeHud({
      ...BASE, baseDamped: true, recording: { episode: 3, frames: 120 },
    });
    // REC, LINK, MODE, DAMPED — four, leaving the fifth for the modal's RTT.
    expect(lines.map((l) => l.id)).toEqual(['rec', 'link', 'mode', 'damped']);
    expect(lines.length).toBeLessThanOrEqual(HUD_MAX_LINES - 1);
  });
});

describe('markerAppearance', () => {
  const g = { gripThreshold: 0.5, saturated: false };

  it('is dim and small at rest', () => {
    const m = markerAppearance({ ...g, squeeze: 0 });
    expect(m.engaged).toBe(false);
    expect(m.color).toBe(HUD_COLORS.dim);
    expect(m.scale).toBeCloseTo(0.6);
  });

  it('grows as the finger approaches the bite point, so the operator can find it', () => {
    const a = markerAppearance({ ...g, squeeze: 0.1 });
    const b = markerAppearance({ ...g, squeeze: 0.4 });
    expect(b.scale).toBeGreaterThan(a.scale);
    expect(b.opacity).toBeGreaterThan(a.opacity);
    expect(b.engaged).toBe(false);
  });

  it('snaps to engaged at the threshold', () => {
    expect(markerAppearance({ ...g, squeeze: 0.5 }).engaged).toBe(true);
    expect(markerAppearance({ ...g, squeeze: 0.5 }).color).toBe(HUD_COLORS.ok);
    expect(markerAppearance({ ...g, squeeze: 0.5 }).scale).toBe(1);
  });

  it('turns red when a joint on that arm is on a stop', () => {
    expect(markerAppearance({ ...g, squeeze: 1, saturated: true }).color).toBe(HUD_COLORS.bad);
  });

  it('does not colour a DISENGAGED marker red — there is nothing to saturate', () => {
    expect(markerAppearance({ ...g, squeeze: 0.2, saturated: true }).color).toBe(HUD_COLORS.dim);
  });

  it('handles degenerate squeeze and threshold values', () => {
    expect(markerAppearance({ ...g, squeeze: Number.NaN }).engaged).toBe(false);
    expect(markerAppearance({ ...g, squeeze: 5 }).engaged).toBe(true);
    expect(markerAppearance({ ...g, squeeze: -5 }).engaged).toBe(false);
    expect(markerAppearance({ squeeze: 0.9, saturated: false, gripThreshold: 0 }).engaged).toBe(true);
    expect(
      markerAppearance({ squeeze: 0.9, saturated: false, gripThreshold: Number.NaN }).engaged,
    ).toBe(true);
  });

  it('always produces a drawable opacity and scale', () => {
    for (const squeeze of [0, 0.25, 0.5, 1, Number.NaN, -1, 99]) {
      const m = markerAppearance({ ...g, squeeze });
      expect(m.opacity).toBeGreaterThan(0);
      expect(m.opacity).toBeLessThanOrEqual(1);
      expect(m.scale).toBeGreaterThan(0);
    }
  });
});

describe('LoopHealth', () => {
  it('starts with nothing measured', () => {
    expect(createLoopHealth()).toEqual({
      pendingSentAt: null,
      lastRttMs: null,
      rttMs: null,
      samples: 0,
    });
  });

  it('measures a round trip from the send to the next state message', () => {
    const h = onStateReceived(onPositionsSent(createLoopHealth(), 1000), 1037);
    expect(h.lastRttMs).toBe(37);
    expect(h.rttMs).toBe(37);
    expect(h.samples).toBe(1);
    expect(h.pendingSentAt).toBeNull();
  });

  it('smooths subsequent samples toward the new value', () => {
    let h = onStateReceived(onPositionsSent(createLoopHealth(), 0), 40);
    h = onStateReceived(onPositionsSent(h, 100), 200);
    expect(h.lastRttMs).toBe(100);
    expect(h.rttMs).toBeCloseTo(40 + (100 - 40) * RTT_EMA_ALPHA, 9);
  });

  it('keeps the OLDEST outstanding send, because the agent answers in order', () => {
    // Overwriting would pair the newest send with the oldest reply and report a
    // round trip shorter than the real one.
    let h = onPositionsSent(createLoopHealth(), 1000);
    h = onPositionsSent(h, 1050);
    expect(h.pendingSentAt).toBe(1000);
    h = onStateReceived(h, 1080);
    expect(h.lastRttMs).toBe(80);
  });

  it('ignores a state message with nothing outstanding', () => {
    // The agent also emits state on its own 30 Hz held-key tick.
    const h = createLoopHealth();
    expect(onStateReceived(h, 5000)).toBe(h);
  });

  it('discards a negative round trip from a backwards clock', () => {
    const h = onStateReceived(onPositionsSent(createLoopHealth(), 1000), 900);
    expect(h.pendingSentAt).toBeNull();
    expect(h.rttMs).toBeNull();
    expect(h.samples).toBe(0);
  });

  it('ignores non-finite clocks', () => {
    const sent = onPositionsSent(createLoopHealth(), Number.NaN);
    expect(sent.pendingSentAt).toBeNull();
    const pending = onPositionsSent(createLoopHealth(), 10);
    expect(onStateReceived(pending, Number.NaN)).toBe(pending);
  });

  it('does not mutate the state it is given', () => {
    const h = createLoopHealth();
    onStateReceived(onPositionsSent(h, 0), 10);
    expect(h).toEqual(createLoopHealth());
  });
});

describe('isPoseFrame — what counts as an RTT probe', () => {
  it('counts a wrist frame, which is the only thing IK mode sends', () => {
    // The regression: `{wrists}` was not recognised, IK became the default on a
    // G1, and the readout that measures the control loop went dead in its own
    // default mode — `RTT --` on the desktop, no RTT line in the headset.
    expect(isPoseFrame({ wrists: { left: { p: [0, 0, 0] } } })).toBe(true);
    expect(isPoseFrame({ positions: { j0: 0 } })).toBe(true);
  });

  it('does not count a frame the agent answers with something other than state', () => {
    for (const payload of [
      { move: 'forward' },
      { preset: 'home' },
      { estop: true },
      { hands: { left: {} } },
      null,
      'positions',
      42,
    ]) {
      expect(isPoseFrame(payload)).toBe(false);
    }
  });
});

// TASK-393: the real robot's arms on the plate.
describe('the arm path on the HUD', () => {
  const ARM = { armed: true, arming: false, armWeight: 1, teleopMode: 'arms+hands' };

  it('folds the arm state into MODE and adds no line', () => {
    const lines = composeHud({ ...BASE, armLeft: true, arm: ARM });
    expect(lines.find((l) => l.id === 'mode')?.text).toBe('MODE ARM-L ARMED');
    expect(lines.length).toBe(composeHud(BASE).length);
  });

  it('says ARMING with the weight, and warns while an arm is held but not under control', () => {
    expect(hudArmSuffix({ ...ARM, armWeight: 0.42 })).toBe('ARMING 42%');
    const lines = composeHud({ ...BASE, armRight: true, arm: { ...ARM, armed: false } });
    const mode = lines.find((l) => l.id === 'mode')!;
    expect(mode.text).toBe('MODE ARM-R ARMS OFF');
    expect(mode.color).toBe(HUD_COLORS.warn);
  });

  it('puts a missing hand where TURN was, and never a fifth line', () => {
    const lines = composeHud({ ...BASE, arm: { ...ARM, teleopMode: 'arms+left_hand' } });
    expect(lines.find((l) => l.id === 'hands')?.text).toBe('NO RIGHT HAND — arms + left');
    expect(lines.find((l) => l.id === 'turn')).toBeUndefined();
    const recording = composeHud({ ...BASE, recording: { episode: 1, frames: 3 }, arm: { ...ARM, teleopMode: 'arms_only' } });
    expect(recording.length).toBeLessThanOrEqual(HUD_MAX_LINES - 1);
  });

  it('has no hand warning when both hands are there or nobody said', () => {
    expect(hudHandWarning('arms+hands')).toBeNull();
    expect(hudHandWarning(null)).toBeNull();
  });

  it('looks exactly as before without an arm path', () => {
    expect(composeHud({ ...BASE, arm: null })).toEqual(composeHud(BASE));
  });
});

// TASK-393 review: the arms never re-arm on a grip that was already held.
describe('the re-engage latch on the HUD', () => {
  const OFF = { armed: false, arming: false, armWeight: 0, teleopMode: 'arms+hands' };

  it('asks for the grip to be let go while the agent waits for it', () => {
    const lines = composeHud({ ...BASE, armLeft: true, clutchHeld: true, arm: { ...OFF, engage: 'need_release' } });
    const mode = lines.find((l) => l.id === 'mode')!;
    expect(mode.text).toBe(HUD_RELEASE_GRIP);
    expect(mode.color).toBe(HUD_COLORS.warn);
    expect(lines.length).toBe(composeHud(BASE).length);
  });

  it('goes back to the normal readout once released, and to ARMING on the squeeze', () => {
    const released = composeHud({ ...BASE, clutchHeld: false, arm: { ...OFF, engage: 'need_release' } });
    expect(released.find((l) => l.id === 'mode')?.text).toBe('MODE IDLE ARMS OFF');
    const arming = composeHud({
      ...BASE, armLeft: true, clutchHeld: true,
      arm: { ...OFF, arming: true, armWeight: 0.2, engage: 'holding' },
    });
    expect(arming.find((l) => l.id === 'mode')?.text).toBe('MODE ARM-L ARMING 20%');
  });

  it('never asks for a release while the arms are up or arming', () => {
    expect(hudNeedsRelease({ ...OFF, armed: true, engage: 'need_release' }, true)).toBe(false);
    expect(hudNeedsRelease({ ...OFF, arming: true, engage: 'need_release' }, true)).toBe(false);
    expect(hudNeedsRelease({ ...OFF, engage: 'need_press' }, true)).toBe(false);
    expect(hudNeedsRelease({ ...OFF, engage: null }, true)).toBe(false);
  });

  it('tells a hand-tracking operator to use the controllers, in at most four lines', () => {
    const lines = composeHud({ ...BASE, handTracked: true, recording: { episode: 1, frames: 2 }, arm: OFF });
    expect(lines.map((l) => l.text)).toContain(HUD_USE_CONTROLLERS[0]);
    expect(lines.map((l) => l.text)).toContain(HUD_USE_CONTROLLERS[1]);
    expect(`${HUD_USE_CONTROLLERS[0]} ${HUD_USE_CONTROLLERS[1]}`).toBe('Use controllers to drive the real robot');
    expect(lines.length).toBeLessThanOrEqual(HUD_MAX_LINES - 1);
  });

  it('leaves hand tracking alone on the sim', () => {
    expect(composeHud({ ...BASE, handTracked: true })).toEqual(composeHud(BASE));
  });

  it('compares clutch reports, with never-sent equal to nothing', () => {
    expect(sameClutch({ left: true, right: false }, { left: true, right: false })).toBe(true);
    expect(sameClutch({ left: true, right: false }, { left: false, right: false })).toBe(false);
    expect(sameClutch({ left: false, right: false }, null)).toBe(false);
  });
});
