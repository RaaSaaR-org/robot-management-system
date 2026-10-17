/**
 * @file vrWhy.test.ts
 * @description TASK-407: the headset's one-line reason the arms are not
 *              following — every rule, and the order they are tried in — and the
 *              robot panel's status lines.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  ARM_REFUSAL_FRESH_MS,
  composeRobotPanel,
  shortJoint,
  whyNotFollowingVr,
  type RobotPanelFacts,
  type VrArmInfo,
  type VrWhyInput,
  type WhyCode,
} from '../vrWhy';

const NOW = 1_000_000;

/** Everything fine, a grip held: "Following." */
function following(overrides: Partial<VrWhyInput> = {}): VrWhyInput {
  return {
    estopLatched: false,
    socketOpen: true,
    leaseHeld: true,
    modeControl: 'fsm',
    baseMode: 'balance',
    armHeld: null,
    armRefusal: null,
    arm: null,
    controllers: { left: true, right: true },
    clutch: { left: false, right: true },
    now: NOW,
    ...overrides,
  };
}

const ARM: VrArmInfo = {
  writeMode: 'arm_sdk',
  armed: true,
  arming: false,
  armWeight: 1,
  hands: { left: true, right: true },
  teleopMode: 'arms+hands',
  deadman: 'ok',
  lastDisarmReason: null,
  handHealth: null,
};

/**
 * Each rule's trigger, applied ON TOP of every LATER rule's trigger — so a rule
 * that answers here proves both that it fires and that it wins over everything
 * below it. The list order IS the rule order.
 */
const RULES: Array<{ code: WhyCode; severity: string; apply: Partial<VrWhyInput> }> = [
  { code: 'estop_latched', severity: 'block', apply: { estopLatched: true } },
  { code: 'socket_closed', severity: 'block', apply: { socketOpen: false } },
  { code: 'lease_none', severity: 'block', apply: { leaseHeld: false } },
  { code: 'mode_not_balance', severity: 'block', apply: { baseMode: 'limp' } },
  { code: 'arm_refused', severity: 'block', apply: { armHeld: { side: 'right', reason: 'arm_gate', at: NOW - 10 } } },
  { code: 'deadman_hold', severity: 'warn', apply: { arm: { ...ARM, deadman: 'hold', arming: true, armed: false } } },
  { code: 'arming', severity: 'warn', apply: { arm: { ...ARM, deadman: 'ok', arming: true, armed: false, armWeight: 0.4 } } },
  { code: 'controller_untracked', severity: 'warn', apply: { controllers: { left: false, right: false } } },
  { code: 'not_engaged', severity: 'ok', apply: { clutch: { left: false, right: false } } },
];

describe('whyNotFollowingVr — the rules, in order', () => {
  it('says Following when nothing is wrong and a grip is held', () => {
    expect(whyNotFollowingVr(following())).toMatchObject({ code: 'following', severity: 'ok', text: 'Following.' });
  });

  RULES.forEach((rule, i) => {
    it(`${i + 1}. ${rule.code} wins over every rule below it`, () => {
      // Apply this rule and every later one: this one must still answer.
      const input = following();
      for (const later of RULES.slice(i).reverse()) Object.assign(input, later.apply);
      const why = whyNotFollowingVr(input);
      expect(why.code).toBe(rule.code);
      expect(why.severity).toBe(rule.severity);
    });
  });

  it('every text fits the panel (72) and every short form the wrist plate (26)', () => {
    const inputs: VrWhyInput[] = [
      following(),
      ...RULES.map((r) => following(r.apply)),
      following({ armRefusal: { code: 'arm_failed', message: 'x'.repeat(200), at: NOW } }),
      following({ arm: { ...ARM, arming: true, armed: false, armWeight: 0.4 } }),
      following({ baseMode: 'unknown' }),
    ];
    for (const input of inputs) {
      const why = whyNotFollowingVr(input);
      expect(why.text.length).toBeLessThanOrEqual(72);
      expect(why.short.length).toBeLessThanOrEqual(26);
    }
  });

  it('uses the agent table wording for the latched E-stop where NeoDEM controls the mode', () => {
    expect(whyNotFollowingVr(following({ estopLatched: true })).text)
      .toBe('E-stop is latched. Reset it, then switch to Balance.');
    expect(whyNotFollowingVr(following({ estopLatched: true, modeControl: 'off' })).text)
      .toBe('E-stop is latched. Reset it.');
  });

  it('names the mode, and asks only where NeoDEM controls it (the sim does not)', () => {
    expect(whyNotFollowingVr(following({ baseMode: 'stand' })).text).toBe('The robot is stand. Switch to Balance.');
    expect(whyNotFollowingVr(following({ baseMode: 'unknown' })).code).toBe('mode_unknown');
    expect(whyNotFollowingVr(following({ baseMode: 'unknown', modeControl: 'off' })).code).toBe('following');
  });

  it('prefers a fresh held answer, then a fresh error, and forgets both once stale', () => {
    const stale = NOW - ARM_REFUSAL_FRESH_MS - 1;
    expect(whyNotFollowingVr(following({
      armHeld: { side: 'left', reason: 'not_armed', at: NOW },
      armRefusal: { code: 'arm_requires_heartbeat', message: '', at: NOW },
    }))).toMatchObject({ code: 'arm_refused', short: 'HELD L: not_armed' });
    expect(whyNotFollowingVr(following({
      armRefusal: { code: 'arm_requires_heartbeat', message: '', at: NOW },
    })).text).toBe('No heartbeat from this console. Check the link.');
    expect(whyNotFollowingVr(following({
      armHeld: { side: 'left', reason: 'not_armed', at: stale },
      armRefusal: { code: 'arm_failed', message: 'nope', at: stale },
    })).code).toBe('following');
  });

  it('says arming while the real arms ramp in', () => {
    expect(whyNotFollowingVr(following({ arm: { ...ARM, armed: false, arming: true, armWeight: 0.4 } })))
      .toMatchObject({ code: 'arming', text: 'Arming… 40 %' });
  });

  it('calls a gripped side whose controller is lost untracked, and no controller at all too', () => {
    expect(whyNotFollowingVr(following({ controllers: { left: false, right: false }, clutch: { left: false, right: false } })).code)
      .toBe('controller_untracked');
    expect(whyNotFollowingVr(following({ controllers: { left: false, right: true } })).code).toBe('following');
  });
});

describe('composeRobotPanel', () => {
  const facts = (overrides: Partial<RobotPanelFacts> = {}): RobotPanelFacts => ({
    estopLatched: false,
    baseMode: 'balance',
    baseMeasured: true,
    baseDamped: false,
    modeControl: 'fsm',
    armInfo: ARM,
    clutch: { left: true, right: false },
    armHeld: null,
    leaseLabel: 'you',
    link: 'live',
    rttMs: 42,
    ...overrides,
  });
  const why = whyNotFollowingVr(following());

  it('prints the six lines, the why line last, bold and wrapped', () => {
    const lines = composeRobotPanel(facts(), why, NOW);
    expect(lines.map((l) => l.text)).toEqual([
      'MODE balance (measured)',
      'ARMS armed 100 % · dead-man OK',
      'GRIP L ●  R ○',
      'HANDS L ok · R ok · arms+hands',
      'LEASE you · LINK live 42 ms',
      'Following.',
    ]);
    expect(lines[lines.length - 1]).toMatchObject({ id: 'why', bold: true, wrap: true });
  });

  it('shows the held side and reason, the disarm reason, and — for an absent dead-man', () => {
    const lines = composeRobotPanel(facts({
      armInfo: { ...ARM, armed: false, armWeight: 0, deadman: null, lastDisarmReason: 'left_balance' },
      armHeld: { side: 'right', reason: 'arm_gate', at: NOW },
    }), why, NOW);
    expect(lines[1].text).toBe('ARMS disarmed: left_balance · dead-man —');
    expect(lines[2].text).toBe('GRIP L ●  R ○ · HELD R: arm_gate');
  });

  it('decodes hand health: a motor fault by joint and code, a missing hand', () => {
    const health = (present: boolean | null, joint?: string) => ({
      present,
      ageS: 0.1,
      error: [0, 0] as [number, number],
      motorFaults: joint ? [{ motor: 1, joint, code: '0x200', bits: ['overcurrent'] }] : [],
      powerV: 24,
    });
    const lines = composeRobotPanel(facts({
      armInfo: { ...ARM, handHealth: { left: health(true), right: health(true, 'right_hand_thumb_1_joint') } },
    }), why, NOW);
    expect(lines[3].text).toBe('HANDS L ok · R THUMB_1 0x200 · arms+hands');
    const missing = composeRobotPanel(facts({
      armInfo: { ...ARM, handHealth: { left: health(false), right: health(true) } },
    }), why, NOW);
    expect(missing[3].text).toContain('L missing');
  });

  it('says plainly when the sidecar needs no arming (the sim)', () => {
    const lines = composeRobotPanel(facts({ armInfo: null, modeControl: 'off', baseMode: 'unknown', baseMeasured: false }), why, NOW);
    expect(lines[0].text).toBe('MODE unknown');
    expect(lines[1].text).toBe('ARMS no arming needed');
    expect(lines[3].text).toBe('HANDS —');
  });

  it('shortens joint names', () => {
    expect(shortJoint('left_hand_index_0_joint')).toBe('INDEX_0');
    expect(shortJoint('thumb_1')).toBe('THUMB_1');
  });
});
