/**
 * @file commandRefusal.ts
 * @description The toast title for a command the robot refused (TASK-504): a
 *              refusal is the robot answering, not a failed send, so it reads
 *              "SimBot-01 refused: <reason>" rather than "Couldn't send command"
 *              over the raw error.
 * @feature robots
 */

import { RobotCommandFailedError } from '../api/robotsApi';

/**
 * `"<robot> refused: <reason>"` when `err` is a refusal from the robot, or null
 * for any other error (network, permission, server) — those keep the caller's
 * own "Couldn't send…" title and description.
 */
export function commandRefusalTitle(robotName: string, err: unknown): string | null {
  if (!(err instanceof RobotCommandFailedError)) return null;
  return `${robotName} refused: ${err.message}`;
}
