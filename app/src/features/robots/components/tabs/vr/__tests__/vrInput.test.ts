/**
 * @file vrInput.test.ts
 * @description TASK-407: the trigger routing. With the grip free the trigger is
 *              the in-VR click and must never reach the robot's hand; with the
 *              grip held it is the grasp and must never press a button.
 * @feature robots
 */

import { describe, it, expect } from 'vitest';
import { routeControllerInput } from '../vrInput';
import { GRIP_THRESHOLD } from '../vrConstants';

describe('routeControllerInput', () => {
  it('never hands a trigger pulled with the grip free to the hand', () => {
    for (const squeeze of [0, 0.1, 0.3, GRIP_THRESHOLD - 0.001]) {
      for (const trigger of [0, 0.5, 1]) {
        const routed = routeControllerInput({ squeeze, trigger });
        expect(routed.clutched).toBe(false);
        // `grasp` is what VrTeleopRig writes into `wrist.grip` — null means the
        // frame carries no wrist for this side at all.
        expect(routed.grasp).toBeNull();
        expect(routed.uiTrigger).toBe(trigger);
      }
    }
  });

  it('never hands a trigger pulled with the grip held to the UI', () => {
    for (const squeeze of [GRIP_THRESHOLD, 0.8, 1]) {
      for (const trigger of [0, 0.5, 1]) {
        const routed = routeControllerInput({ squeeze, trigger });
        expect(routed).toEqual({ clutched: true, grasp: trigger, uiTrigger: null });
      }
    }
  });

  it('clamps and refuses garbage', () => {
    expect(routeControllerInput({ squeeze: Number.NaN, trigger: 2 })).toEqual({
      clutched: false, grasp: null, uiTrigger: 1,
    });
    expect(routeControllerInput({ squeeze: 1, trigger: -1 }).grasp).toBe(0);
  });
});
