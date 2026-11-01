/**
 * @file vrTexts.test.ts
 * @description TASK-417: every sentence the headset shows — the why line in all
 *              its forms, the wrist HUD, the robot panel and the desktop's
 *              request prompt — names a button that exists in the headset or
 *              the person who acts. None tells the operator to press Stand,
 *              Balance or Take control inside the headset, and every why line
 *              fits its 72 characters.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import {
  ARM_HELD_REASONS,
  composeRobotPanel,
  pickWhyLine,
  whyNotFollowingVr,
  type VrArmInfo,
  type VrWhyInput,
  type WhyNotFollowing,
} from '../vrWhy';
import { composeHud, finishWristHud, hudBaseLine, type HudBaseMode, type HudState } from '../vrHud';
import { vrModeAllowLabel, vrModePromptLine } from '../vrModeRequest';

const NOW = 1_000_000;
const MODES: HudBaseMode[] = ['limp', 'stand', 'balance', 'zero_torque', 'other', 'unknown'];
const CONTROL = ['off', 'fsm', 'full'] as const;
const ARM: VrArmInfo = {
  writeMode: 'arm_sdk', armed: false, arming: true, armWeight: 0.4,
  hands: { left: true, right: false }, teleopMode: 'arms+left_hand', deadman: 'hold',
  lastDisarmReason: 'estop', handHealth: null,
};

function input(over: Partial<VrWhyInput>): VrWhyInput {
  return {
    estopLatched: false, socketOpen: true, leaseHeld: true, modeControl: 'fsm', baseMode: 'balance',
    armHeld: null, armRefusal: null, arm: null,
    controllers: { left: true, right: true }, clutch: { left: false, right: true }, now: NOW,
    ...over,
  };
}

/** Every why line the rules can produce, across the facts that steer the wording. */
function everyWhy(): WhyNotFollowing[] {
  const out: WhyNotFollowing[] = [];
  for (const modeControl of CONTROL) {
    for (const baseMode of MODES) {
      for (const estopLatched of [true, false]) {
        for (const leaseHeld of [true, false]) {
          for (const socketOpen of [true, false]) {
            out.push(whyNotFollowingVr(input({ modeControl, baseMode, estopLatched, leaseHeld, socketOpen })));
          }
        }
      }
    }
  }
  for (const reason of ARM_HELD_REASONS) out.push(whyNotFollowingVr(input({ armHeld: { side: 'both', reason, at: NOW } })));
  for (const code of ['lease_required', 'arm_requires_lease', 'arm_requires_heartbeat', 'heartbeat_lost', 'arm_estop_latched',
    'arm_requires_clutch', 'arm_reengage_required', 'arm_side_unclutched', 'ik_unsupported', 'arm_whatever']) {
    out.push(whyNotFollowingVr(input({ armRefusal: { code, message: 'x', at: NOW } })));
  }
  out.push(whyNotFollowingVr(input({ arm: ARM })));
  out.push(whyNotFollowingVr(input({ arm: { ...ARM, deadman: 'ok' } })));
  out.push(whyNotFollowingVr(input({ controllers: { left: false, right: false } })));
  out.push(whyNotFollowingVr(input({ clutch: { left: false, right: false } })));
  return out;
}

/** "press Stand", "switch to Balance", "Press Take control" — unless it says to leave VR first. */
const IN_HEADSET_BUTTON = /\b(press|switch to|tap|click)\b[^.]*\b(stand|balance|take control)\b/i;
const tellsToPressInHeadset = (text: string): boolean =>
  IN_HEADSET_BUTTON.test(text) && !/exit VR and press/i.test(text);

describe('in-VR texts name only buttons the headset has (TASK-417)', () => {
  const whys = everyWhy();

  it('the why line: never "press Stand / Balance / Take control" in the headset, at most 72 characters', () => {
    for (const why of whys) {
      expect(tellsToPressInHeadset(why.text), why.text).toBe(false);
      expect(tellsToPressInHeadset(why.short), why.short).toBe(false);
      expect(why.text.length, why.text).toBeLessThanOrEqual(72);
      expect(why.short.length, why.short).toBeLessThanOrEqual(26);
    }
  });

  it('says what the spec says after an E-stop, when limp, and without the lease', () => {
    const texts = new Set(whys.map((w) => w.text));
    expect(texts).toContain('E-stop latched — hold Reset for 1 s. Then the desktop asks for Balance.');
    expect(texts).toContain('E-stop latched — hold Reset for 1 s.');
    expect(texts).toContain('Robot limp — the desktop asks for Stand up, then Balance.');
    expect(texts).toContain('You lost control — exit VR and press Take control.');
  });

  it('rewords the server reasons written for the desktop', () => {
    const local = whyNotFollowingVr(input({}));
    for (const server of [
      { code: 'lease_none', text: 'Nobody has taken control. Press Take control.' },
      { code: 'mode_not_balance', text: 'The robot is standing. Switch to Balance.' },
      { code: 'estop_latched', text: 'E-stop is latched. Reset it, then switch to Balance.' },
    ]) {
      const picked = pickWhyLine(local, { ...server, severity: 'block', source: 'agent' });
      expect(picked.from).toBe('server');
      expect(tellsToPressInHeadset(picked.text), picked.text).toBe(false);
    }
  });

  it('the wrist HUD and the robot panel', () => {
    const texts: string[] = [];
    for (const modeControl of CONTROL) {
      for (const baseMode of MODES) {
        for (const baseDamped of [true, false]) {
          const state: HudState = {
            estopLatched: false, link: 'live', msSinceState: 10, armLeft: true, armRight: false, driving: false,
            vx: 0, vy: 0, omega: 0, baseDamped, baseMode, modeControl, moveEnabled: false,
          };
          const base = hudBaseLine(state);
          if (base) texts.push(base.text);
          for (const estopLatched of [true, false]) {
            texts.push(...finishWristHud(composeHud({ ...state, estopLatched }), { estopLatched, whyBlock: null, rttLine: null })
              .map((l) => l.text));
          }
          for (const why of whys.slice(0, 12)) {
            texts.push(...composeRobotPanel({
              estopLatched: false, baseMode, baseMeasured: true, baseDamped, modeControl, armInfo: ARM,
              clutch: { left: true, right: false }, armHeld: { side: 'left', reason: 'lease', at: NOW },
              leaseLabel: 'none', link: 'stale', rttMs: 40,
            }, why, NOW).map((l) => l.text));
          }
        }
      }
    }
    texts.push(vrModePromptLine({ requestId: 'r', mode: 'balance', expiresAt: NOW + 7_000 }, NOW).text);
    texts.push(vrModeAllowLabel('stand'), vrModeAllowLabel('balance'), 'Hold 1 s to reset');
    for (const text of texts) expect(tellsToPressInHeadset(text), text).toBe(false);
  });
});
