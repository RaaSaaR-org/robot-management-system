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
  PANEL_COLORS,
  cameraPanelLine,
  wristPanelLine,
  pickWhyLine,
  type ServerWhy,
  type WhyNotFollowing as Why,
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

  it('names the hold on Reset, and who asks for Balance next, for a latched E-stop (TASK-417)', () => {
    expect(whyNotFollowingVr(following({ estopLatched: true })).text)
      .toBe('E-stop latched — hold Reset for 1 s. Then the desktop asks for Balance.');
    expect(whyNotFollowingVr(following({ estopLatched: true, modeControl: 'off' })).text)
      .toBe('E-stop latched — hold Reset for 1 s.');
  });

  it('names the mode and who acts, only where NeoDEM controls it (the sim does not)', () => {
    expect(whyNotFollowingVr(following({ baseMode: 'stand' })).text).toBe('Robot standing — the desktop asks for Balance.');
    expect(whyNotFollowingVr(following({ baseMode: 'limp' })).text)
      .toBe('Robot limp — the desktop asks for Stand up, then Balance.');
    expect(whyNotFollowingVr(following({ baseMode: 'zero_torque' })).short).toBe('LIMP — desktop asks');
    expect(whyNotFollowingVr(following({ baseMode: 'unknown' })).code).toBe('mode_unknown');
    expect(whyNotFollowingVr(following({ baseMode: 'unknown', modeControl: 'off' })).code).toBe('following');
  });

  it('prefers a fresh held answer, then a fresh error, and forgets both once stale', () => {
    const stale = NOW - ARM_REFUSAL_FRESH_MS - 1;
    expect(whyNotFollowingVr(following({
      armHeld: { side: 'left', reason: 'not_armed', at: NOW },
      armRefusal: { code: 'arm_requires_heartbeat', message: '', at: NOW },
    }))).toMatchObject({ code: 'arm_refused', short: 'HELD L: arms dropped' });
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

  it('leads with the why line — bold, 1.5x, two rows at most — and shows nothing that is fine (TASK-417)', () => {
    const lines = composeRobotPanel(facts(), why, NOW);
    expect(lines).toEqual([
      { id: 'why', text: 'Following.', color: PANEL_COLORS.ok, bold: true, wrap: true, maxRows: 2, scale: 1.5 },
    ]);
  });

  it('puts the non-ok facts on one chip row, held reasons in words, never the agent code', () => {
    const lines = composeRobotPanel(facts({
      armInfo: { ...ARM, armed: false, armWeight: 0, deadman: null, lastDisarmReason: 'left_balance' },
      armHeld: { side: 'right', reason: 'ik_held', at: NOW },
      baseMode: 'stand',
      link: 'stale',
      leaseLabel: 'Ben',
    }), why, NOW);
    expect(lines[0].id).toBe('why');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ id: 'chips', color: PANEL_COLORS.bad, wrap: true });
    expect(lines[1].text).toBe(
      'MODE stand  ·  ARMS off: left_balance  ·  HELD R: out of reach  ·  LINK stale  ·  LEASE Ben',
    );
    expect(lines[1].text).not.toMatch(/ik_held/);
  });

  it('decodes hand health only when a hand is not fine', () => {
    const health = (present: boolean | null, joint?: string) => ({
      present,
      ageS: 0.1,
      error: [0, 0] as [number, number],
      motorFaults: joint ? [{ motor: 1, joint, code: '0x200', bits: ['overcurrent'] }] : [],
      powerV: 24,
    });
    const fault = composeRobotPanel(facts({
      armInfo: { ...ARM, handHealth: { left: health(true), right: health(true, 'right_hand_thumb_1_joint') } },
    }), why, NOW);
    expect(fault[1].text).toBe('HANDS L ok · R THUMB_1 0x200');
    const missing = composeRobotPanel(facts({
      armInfo: { ...ARM, handHealth: { left: health(false), right: health(true) } },
    }), why, NOW);
    expect(missing[1].text).toContain('L missing');
    const fine = composeRobotPanel(facts({
      armInfo: { ...ARM, handHealth: { left: health(true), right: health(true) } },
    }), why, NOW);
    expect(fine).toHaveLength(1);
  });

  it('drops "MODE unknown", "no arming needed" and the idle RTT on the sim', () => {
    const lines = composeRobotPanel(facts({ armInfo: null, modeControl: 'off', baseMode: 'unknown', baseMeasured: false, rttMs: 4497 }), why, NOW);
    expect(lines.map((l) => l.id)).toEqual(['why']);
    const all = lines.map((l) => l.text).join(' ');
    expect(all).not.toMatch(/MODE unknown|no arming needed|ms\b/);
  });

  it('shortens joint names', () => {
    expect(shortJoint('left_hand_index_0_joint')).toBe('INDEX_0');
    expect(shortJoint('thumb_1')).toBe('THUMB_1');
  });
});

// ---- TASK-413: the robot panel's camera line and the server's reason --------

describe('cameraPanelLine', () => {
  const base = { robotId: 'sim-robot-g1-edu', state: 'live' as const, retryInS: null, fps: 27.6 };

  it('reads live and the frame rate', () => {
    expect(cameraPanelLine(base, 'sim-robot-g1-edu')).toMatchObject({ id: 'camera', text: 'CAMERA live 28 fps', color: PANEL_COLORS.ok });
  });

  it('says when an offline stream retries', () => {
    expect(cameraPanelLine({ ...base, state: 'offline', fps: null, retryInS: 4 }, 'sim-robot-g1-edu'))
      .toMatchObject({ text: 'CAMERA offline · retrying in 4 s', color: PANEL_COLORS.bad });
    expect(cameraPanelLine({ ...base, state: 'stale', retryInS: 2 }, 'sim-robot-g1-edu')?.text).toBe('CAMERA stale · retrying in 2 s');
  });

  it('is absent when no head-camera panel shows this robot', () => {
    expect(cameraPanelLine({ ...base, robotId: null }, 'sim-robot-g1-edu')).toBeNull();
    expect(cameraPanelLine(base, 'another-robot')).toBeNull();
  });
});

describe('pickWhyLine (D4)', () => {
  const localGrip: Why = { code: 'not_engaged', severity: 'warn', text: 'Hold the grip to take an arm', short: 'Hold grip' };
  const localOk: Why = { code: 'following', severity: 'ok', text: 'Following', short: 'Following' };
  const serverBlock: ServerWhy = { code: 'sidecar_down', severity: 'block', text: 'The hardware sidecar is not running', source: 'server' };

  it('shows the server reason when it blocks — the desktop says the same', () => {
    expect(pickWhyLine(localGrip, serverBlock)).toEqual({ text: serverBlock.text, severity: 'block', from: 'server' });
    expect(pickWhyLine(localOk, { ...serverBlock, source: 'agent' }).from).toBe('server');
  });

  it('keeps the local reason, which knows the grip, when the server does not block', () => {
    expect(pickWhyLine(localGrip, { ...serverBlock, severity: 'ok', text: 'Ready' })).toMatchObject({ from: 'local', text: localGrip.text });
    expect(pickWhyLine(localGrip, { ...serverBlock, severity: 'warn', source: 'agent', text: 'x' }).from).toBe('local');
    expect(pickWhyLine(localGrip, null).from).toBe('local');
  });

  it('lets a server-sourced warning through only when it is at least as serious', () => {
    expect(pickWhyLine(localOk, { ...serverBlock, severity: 'warn', text: 'Camera stream is down' }).from).toBe('server');
  });

  it('never outranks a latched E-stop', () => {
    const latched: Why = { code: 'estop_latched', severity: 'block', text: 'E-stop latched', short: 'E-STOP' };
    expect(pickWhyLine(latched, serverBlock).from).toBe('local');
  });
});

describe('wristPanelLine (TASK-443)', () => {
  it('says nothing without wrist panels, or while every wrist is live', () => {
    expect(wristPanelLine({}, 'g1')).toBeNull();
    expect(wristPanelLine({
      left_wrist_camera: { robotId: 'g1', state: 'live' },
      right_wrist_camera: { robotId: 'g1', state: 'live' },
    }, 'g1')).toBeNull();
  });

  it('names each side once one is not live, left first', () => {
    expect(wristPanelLine({
      right_wrist_camera: { robotId: 'g1', state: 'offline' },
      left_wrist_camera: { robotId: 'g1', state: 'live' },
    }, 'g1')).toMatchObject({ id: 'wrists', text: 'WRISTS L live · R offline', color: PANEL_COLORS.bad });
    expect(wristPanelLine({ left_wrist_camera: { robotId: 'g1', state: 'stale' } }, 'g1'))
      .toMatchObject({ text: 'WRISTS L stale', color: PANEL_COLORS.warn });
  });

  it('ignores panels showing another robot', () => {
    expect(wristPanelLine({ left_wrist_camera: { robotId: 'other', state: 'offline' } }, 'g1')).toBeNull();
  });
});
