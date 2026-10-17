/**
 * @file why-not-following.test.ts
 * @description TASK-405: the ordered "why are the arms not following" table —
 *              every code from a minimal input, the order between neighbouring
 *              rules, the sim exemptions and the one-HUD-line limit.
 * @feature readiness
 * @status test
 */

import { describe, it, expect } from 'vitest';
import {
  explainNotFollowing,
  fitLine,
  NOT_FOLLOWING_ORDER,
  REASON_MAX_CHARS,
  type NotFollowingInput,
} from '../why-not-following.js';
import type { HandHealth } from '../../hardware/arm-status.js';

const HAND_OK: HandHealth = { present: true, ageS: 0.01, error: [0, 0], motorFaults: [], powerV: 24 };

/** A real arm_sdk G1 in balance, lease held, both hands healthy, one claim, armed: following. */
function following(): NotFollowingInput {
  return {
    sidecar: { reachable: true, connected: true, sim: false, writeMode: 'arm_sdk', readOnly: false, port: '8767' },
    estopLatched: false,
    mode: { name: 'balance', error: null },
    lease: { enforced: true, state: 'held', bound: 1 },
    hands: { left: { ...HAND_OK }, right: { ...HAND_OK } },
    arms: {
      armed: true, arming: false, armWeight: 1, armState: 'armed', deadman: 'ok',
      lastDisarmReason: null, trackErrRad: null, trackErrJoint: null, claims: 1,
    },
  };
}

type Patch = (i: NotFollowingInput) => void;

const CASES: Array<[string, Patch]> = [
  ['sidecar_unreachable', (i) => { i.sidecar.reachable = false; }],
  ['no_lowstate', (i) => { i.sidecar.connected = false; }],
  ['read_only', (i) => { i.sidecar.readOnly = true; i.sidecar.writeMode = 'read_only'; }],
  ['estop_latched', (i) => { i.estopLatched = true; }],
  ['mode_unknown', (i) => { i.mode = { name: 'unknown', error: 'fsm rpc timeout' }; }],
  ['mode_not_balance', (i) => { i.mode = { name: 'limp', error: null }; }],
  ['lease_none', (i) => { i.lease.state = 'none'; }],
  ['lease_duplicate', (i) => { i.lease.bound = 2; }],
  ['hand_missing', (i) => { i.hands!.right = { ...HAND_OK, present: false, ageS: 3.2 }; }],
  ['hand_fault', (i) => {
    i.hands!.right = {
      ...HAND_OK, error: [0x200, 0],
      motorFaults: [{ motor: 1, joint: 'right_hand_thumb_1_joint', code: '0x200', bits: [] }],
    };
  }],
  ['disarmed_reason', (i) => {
    Object.assign(i.arms, {
      armed: false, armState: 'disarmed', armWeight: 0, lastDisarmReason: 'tracking_error',
      trackErrRad: 0.41, trackErrJoint: 'left_elbow_joint',
    });
  }],
  ['arming', (i) => { Object.assign(i.arms, { armed: false, arming: true, armWeight: 0.4, armState: 'arming' }); }],
  ['deadman_hold', (i) => { i.arms.deadman = 'hold'; }],
  ['not_engaged', (i) => { Object.assign(i.arms, { armed: false, armState: 'disarmed', claims: 0 }); }],
  ['following', () => {}],
];

describe('explainNotFollowing — each rule from a minimal input', () => {
  it('covers all 15 codes, in table order', () => {
    expect(CASES.map(([code]) => code)).toEqual(NOT_FOLLOWING_ORDER);
  });

  for (const [code, patch] of CASES) {
    it(code, () => {
      const input = following();
      patch(input);
      const r = explainNotFollowing(input);
      expect(r.code).toBe(code);
      expect(r.text.length).toBeLessThanOrEqual(REASON_MAX_CHARS);
    });
  }

  it('says the texts the HUD shows', () => {
    const at = (patch: Patch) => {
      const i = following();
      patch(i);
      return explainNotFollowing(i);
    };
    expect(at(CASES[0][1])).toEqual({
      code: 'sidecar_unreachable', severity: 'block',
      text: "Can't reach the robot sidecar (8767). Start the robot side.",
    });
    expect(at(CASES[4][1]).text).toBe('The robot mode is unknown (fsm rpc timeout).');
    expect(at(CASES[5][1]).text).toBe('The robot is limp. Switch to Balance.');
    expect(at((i) => { i.mode = { name: 'stand', error: null }; }).text).toBe('The robot is standing. Switch to Balance.');
    expect(at(CASES[8][1])).toEqual({
      code: 'hand_missing', severity: 'warn', text: 'Right hand sends no state (3.2 s). Check the wrist cable.',
    });
    expect(at(CASES[9][1])).toEqual({
      code: 'hand_fault', severity: 'warn', text: 'Right hand: right_hand_thumb_1 motor fault 0x200.',
    });
    expect(at(CASES[10][1])).toEqual({
      code: 'disarmed_reason', severity: 'block',
      // The long form does not fit one HUD line, so the advice gets shorter.
      text: 'Arms dropped: tracking error on left_elbow 0.41 rad. Squeeze again.',
    });
    expect(at(CASES[11][1])).toEqual({ code: 'arming', severity: 'warn', text: 'Arming… 40 %' });
    expect(at(CASES[14][1])).toEqual({ code: 'following', severity: 'ok', text: 'Following.' });
  });

  it('says each disarm reason in words', () => {
    const text = (reason: string) => {
      const i = following();
      Object.assign(i.arms, { armed: false, armState: 'disarmed', lastDisarmReason: reason });
      return explainNotFollowing(i).text;
    };
    expect(text('left_balance')).toBe('Arms dropped: left balance. Squeeze the grip again.');
    expect(text('deadman')).toBe('Arms dropped: dead-man. Squeeze the grip again.');
    expect(text('stale_state')).toBe('Arms dropped: stale state. Squeeze the grip again.');
  });
});

describe('explainNotFollowing — order between neighbouring rules', () => {
  it('an E-stop wins over a limp robot (4 before 6)', () => {
    const i = following();
    i.estopLatched = true;
    i.mode = { name: 'limp', error: null };
    expect(explainNotFollowing(i).code).toBe('estop_latched');
  });

  it('a limp robot wins over a missing lease (6 before 7)', () => {
    const i = following();
    i.mode = { name: 'limp', error: null };
    i.lease.state = 'none';
    expect(explainNotFollowing(i).code).toBe('mode_not_balance');
  });

  it('a missing hand wins over dropped arms (9 before 11)', () => {
    const i = following();
    i.hands!.left = { ...HAND_OK, present: false, ageS: null };
    Object.assign(i.arms, { armed: false, armState: 'disarmed', lastDisarmReason: 'deadman' });
    const r = explainNotFollowing(i);
    expect(r.code).toBe('hand_missing');
    expect(r.text).toBe('Left hand sends no state (no data). Check the wrist cable.');
  });
});

describe('explainNotFollowing — conditions', () => {
  it('dropped arms need a claim and a reason other than an explicit request', () => {
    const i = following();
    Object.assign(i.arms, { armed: false, armState: 'disarmed', lastDisarmReason: 'request' });
    expect(explainNotFollowing(i).code).toBe('not_engaged');
    Object.assign(i.arms, { lastDisarmReason: 'deadman', claims: 0 });
    expect(explainNotFollowing(i).code).toBe('not_engaged');
  });

  it('an unenforced lease does not ask anybody to take control', () => {
    const i = following();
    i.lease = { enforced: false, state: 'none', bound: 0 };
    expect(explainNotFollowing(i).code).toBe('following');
  });

  it('unknown hand health is not a warning — and not a clean bill either', () => {
    const i = following();
    i.hands = null;
    expect(explainNotFollowing(i).code).toBe('following');
  });

  it('a missing mode reading is unknown, not balance', () => {
    const i = following();
    i.mode = null;
    expect(explainNotFollowing(i)).toMatchObject({ code: 'mode_unknown', text: 'The robot mode is unknown (no reading).' });
  });
});

describe('explainNotFollowing — a sim sidecar', () => {
  function sim(): NotFollowingInput {
    const i = following();
    i.sidecar = { reachable: true, connected: true, sim: true, writeMode: null, readOnly: false, port: '8777' };
    i.mode = null;
    i.hands = null;
    i.lease = { enforced: false, state: 'none', bound: 0 };
    Object.assign(i.arms, { armed: false, armState: null, deadman: null, armWeight: 0, claims: 0 });
    return i;
  }

  it('skips read-only and mode rules (3, 5, 6) and says Ready (simulation)', () => {
    const i = sim();
    i.sidecar.readOnly = true;
    i.mode = { name: 'limp', error: null };
    const r = explainNotFollowing(i);
    expect(r).toEqual({ code: 'not_engaged', severity: 'ok', text: 'Ready (simulation). Squeeze a grip to drive that arm.' });
  });

  it('still reports a lost sim sidecar and an E-stop', () => {
    const i = sim();
    i.estopLatched = true;
    expect(explainNotFollowing(i).code).toBe('estop_latched');
    i.sidecar.reachable = false;
    expect(explainNotFollowing(i).code).toBe('sidecar_unreachable');
  });
});

describe('one HUD line', () => {
  it('every text fits 72 characters, even with long names', () => {
    const i = following();
    Object.assign(i.arms, {
      armed: false, armState: 'disarmed', lastDisarmReason: 'tracking_error',
      trackErrRad: 1.23456, trackErrJoint: 'right_shoulder_roll_joint_with_a_very_long_suffix_name',
    });
    expect(explainNotFollowing(i).text.length).toBeLessThanOrEqual(REASON_MAX_CHARS);
    i.mode = { name: 'unknown', error: 'x'.repeat(200) };
    expect(explainNotFollowing(i).text.length).toBeLessThanOrEqual(REASON_MAX_CHARS);
  });

  it('fitLine cuts on a word and marks the cut', () => {
    const s = fitLine('word '.repeat(30));
    expect(s.length).toBeLessThanOrEqual(REASON_MAX_CHARS);
    expect(s.endsWith('…')).toBe(true);
  });
});
