/**
 * @file stopStyles.ts
 * @description Shared look of the E-stop buttons: the one saturated red fill
 *              the contract allows (bg-stop + text-on-stop), a helper that
 *              reads the store's last action error after a failed act, and the
 *              role gate every stop and resume shares.
 * @feature safety
 */

import { usePermission } from '@/features/auth/hooks/useAuth';
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

/**
 * Whether the signed-in user may stop and resume robots. The server admits every
 * E-stop write to member and above (`writeRoleGuard`), which is exactly who holds
 * `robots:command` — so a viewer sees the stop, disabled, instead of a 403.
 */
export function useCanStop(): boolean {
  return usePermission('robots:command');
}

/** Why a stop control is disabled for a role that cannot use it. */
export const STOP_FORBIDDEN_HINT = "Your role can't stop or resume robots. Ask an operator.";
