/**
 * @file cockpitPick.ts
 * @description Chooses which robot the control center binds to when the route
 *   carries no id. Lives beside the page rather than inside it so the choice can
 *   be tested without mounting the 3D viewport.
 * @feature robots
 */

import { isRobotAvailable, type Robot, type RobotType } from '../types/robots.types';

/** Map a robot's model/metadata to a viewer embodiment. */
export function resolveRobotType(robot: Robot | null): RobotType {
  const hint = `${robot?.model ?? ''} ${(robot?.metadata?.robotType as string) ?? ''}`.toLowerCase();
  // G1 EDU (Dex3-1 three-finger hands) before the plain-G1 substring match
  if (hint.includes('g1_edu') || hint.includes('g1-edu') || hint.includes('g1 edu') || hint.includes('dex3')) {
    return 'g1_edu';
  }
  if (hint.includes('g1')) return 'g1';
  if (hint.includes('h1')) return 'h1';
  if (hint.includes('so-101') || hint.includes('so101')) return 'so101';
  return 'generic';
}

/** True for the Unitree G1 family (plain G1 and G1 EDU). */
export function isG1Family(type: RobotType): boolean {
  return type === 'g1' || type === 'g1_edu';
}

/**
 * Pick the robot the control center should bind to on the id-less route.
 *
 * `heldId` is the pick already on screen, and it wins whenever it is still a
 * candidate. This matters more than the ranking: `status` changes under the
 * operator — pressing Charge in the page's own command dock alone drops a robot
 * out of `isRobotAvailable` — so ranking by reachability on every telemetry tick
 * would silently rebind the console to a different machine mid-session, and the
 * operator's next command, E-stop included, would go somewhere they never
 * selected. Reachability therefore decides the *opening* pick only; after that
 * the page moves only when the held robot is parked by the self-heal or leaves
 * the fleet.
 */
export function pickCockpitRobot(
  robots: Robot[],
  skip: Set<string>,
  heldId: string | null
): Robot | null {
  if (!robots.length) return null;

  // `lastSeen` is the live signal (a connected agent heartbeats continuously),
  // which list-level `status` lags behind, so recency lands us on the robot
  // that's actually streaming rather than a stale phantom.
  const byRecency = [...robots].sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''));
  const pool = byRecency.filter((r) => !skip.has(r.id));
  const fromPool = pool.length ? pool : byRecency;

  const held = heldId ? fromPool.find((r) => r.id === heldId) : undefined;
  if (held) return held;

  // Reachability outranks embodiment on the opening pick: a G1 that is offline
  // still loses to a robot that is actually streaming, so the preference never
  // parks the page on a dead default and makes the operator wait out the
  // self-heal timer.
  const reachable = fromPool.filter(isRobotAvailable);
  const ranked = reachable.length ? reachable : fromPool;
  return ranked.find((r) => isG1Family(resolveRobotType(r))) ?? ranked[0];
}
