/**
 * @file motion-guard.ts
 * @description Refuses REST motion starts while a human holds the control
 *              lease (TASK-316).
 * @feature robot
 * @status live
 *
 * With `CONTROL_LEASE_REQUIRED` on, the lease holder is the only one who may
 * move the robot. Every REST route that STARTS motion (commands, skills, VLA,
 * evaluation, tasks, Agent Mode) calls {@link refuseIfLeaseHeld} first; while
 * a lease is `held` it answers 409 `control_lease_held` naming the holder and
 * the route starts nothing.
 *
 * Deliberately NOT guarded: every stop, abort and E-stop route — stopping is
 * always allowed, whoever holds the lease. With no lease held (none, expired,
 * released) autonomous starts stay admitted, exactly as before (epic decision
 * in TASK-313). With the flag off the guard never refuses.
 *
 * The flag is read through the registry's own `observe().enforced`, so a test
 * registry built with `enforced: () => true` exercises the whole path.
 */

import type { Response } from 'express';
import { controlLease, type ControlLeaseRegistry } from './control-lease.js';

export const CONTROL_LEASE_HELD = 'control_lease_held';

export interface ControlLeaseHeldBody {
  code: typeof CONTROL_LEASE_HELD;
  holder: { displayName: string | null; userId: string | null };
  message: string;
}

/**
 * The 409 body when motion must be refused, or `null` when it may start.
 * Pure — the part the WebSocket and REST paths can share.
 */
export function leaseHeldRefusal(leases: ControlLeaseRegistry = controlLease): ControlLeaseHeldBody | null {
  const o = leases.observe();
  if (!o.enforced || o.state !== 'held') return null;
  const who = o.displayName ?? 'another user';
  return {
    code: CONTROL_LEASE_HELD,
    holder: { displayName: o.displayName, userId: o.userId },
    message: `${who} holds the control lease for this robot; motion cannot start until it is released.`,
  };
}

/**
 * Answer 409 and return true when a held lease forbids starting motion.
 * Call it at the top of a start route: `if (refuseIfLeaseHeld(res, leases)) return;`
 */
export function refuseIfLeaseHeld(res: Response, leases: ControlLeaseRegistry = controlLease): boolean {
  const refusal = leaseHeldRefusal(leases);
  if (!refusal) return false;
  res.status(409).json(refusal);
  return true;
}
