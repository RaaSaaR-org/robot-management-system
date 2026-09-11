/**
 * @file stopStyles.ts
 * @description Shared look of the E-stop buttons: the one saturated red fill
 *              the contract allows (bg-stop + text-on-stop), plus a helper that
 *              reads the store's last action error after a failed act.
 * @feature safety
 */

import { useSafetyStore } from '../store/safetyStore';

/** Class for every E-stop button (fleet, robot, zone). Kit Button + this. */
export const STOP_BUTTON_CLASS =
  'bg-stop text-on-stop hover:bg-stop/90 border-transparent disabled:bg-stop/60';

/** Icon class inside a stop button (lucide, w-4 h-4) */
export const STOP_ICON_CLASS = 'h-4 w-4';

/** The store's error for the last failed act (read after the await, never stale). */
export function lastSafetyError(fallback: string): string {
  return useSafetyStore.getState().lastActionError ?? fallback;
}
