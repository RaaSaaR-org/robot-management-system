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
 * Whether the signed-in user holds `robots:command` (member and above). That is
 * who the server admits to the per-robot stop under `/api/safety` and to every
 * resume. It is NOT the gate for the fleet or zone stop: `writeRoleGuard` lets
 * any role fire `POST /api/safety/fleet/estop` and
 * `POST /api/safety/zones/:id/estop` (`SAFETY_HALT_WRITES`), so
 * `FleetEmergencyStopButton` uses this for "Resume fleet" only and the zone
 * stops do not use it at all.
 */
export function useCanStop(): boolean {
  return usePermission('robots:command');
}

/** Why the per-robot stop is disabled for a viewer (the fleet and zone stops never are). */
export const STOP_FORBIDDEN_HINT = "Your role can't use this stop. Use Stop fleet, or ask an operator.";

/** Why a resume is disabled for a viewer: putting robots back in motion is an operator call. */
export const RESUME_FORBIDDEN_HINT = "Your role can't resume robots. Ask an operator.";
