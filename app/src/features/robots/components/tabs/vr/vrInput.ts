/**
 * @file vrInput.ts
 * @description Who owns a controller's trigger this frame: the robot's hand
 *              (grasp) or the in-VR UI (click). One pure function, so that a UI
 *              click can never close a hand and a grasp can never press a button.
 * @feature robots
 */

import { GRIP_THRESHOLD } from './vrConstants';

/** One controller's analogue inputs, as the gamepad reports them (0..1). */
export interface ControllerAxes {
  /** `xr-standard-squeeze` — the grip, which is the arm clutch. */
  squeeze: number;
  /** `xr-standard-trigger`. */
  trigger: number;
}

/** What one controller's trigger means this frame. */
export interface RoutedControllerInput {
  /** The grip is past the clutch threshold: this side drives its arm. */
  clutched: boolean;
  /**
   * The grasp axis for the robot's hand, or null when the arm is not clutched.
   * Null is not zero: a released arm sends no grasp at all.
   */
  grasp: number | null;
  /**
   * The trigger as a UI pointer button, or null while the grip is held — the
   * ray is hidden then, and the trigger belongs to the hand.
   */
  uiTrigger: number | null;
}

function axis(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/**
 * Route the trigger (TASK-407, D2).
 *
 * The trigger was already the grasp, but only while the grip is held; with the
 * grip free it did nothing. That spare half is the in-VR click. The split is by
 * the SAME threshold the arm clutches on, so there is no squeeze at which the
 * trigger is both — and no squeeze at which it is neither while a button is
 * under the ray.
 */
export function routeControllerInput({ squeeze, trigger }: ControllerAxes): RoutedControllerInput {
  const clutched = axis(squeeze) >= GRIP_THRESHOLD;
  const value = axis(trigger);
  return clutched
    ? { clutched, grasp: value, uiTrigger: null }
    : { clutched, grasp: null, uiTrigger: value };
}
