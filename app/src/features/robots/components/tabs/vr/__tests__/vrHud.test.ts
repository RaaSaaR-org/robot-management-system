/**
 * @file vrHud.test.ts
 * @description Tests for the in-headset HUD lines, the controller markers and
 *              the round-trip-time reducer.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  composeHud,
  hudMode,
  markerAppearance,
  createLoopHealth,
  onPositionsSent,
  onStateReceived,
  HUD_COLORS,
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
