/**
 * @file exit-code.ts
 * @description The exit code a one-shot roboctl command ends with (TASK-389):
 * a command the robot failed or cancelled is a failure for scripts and CI too,
 * the same as a transport error.
 * @feature cli
 */

import type { RobotCommand } from '../api/types.js';

/** 1 when the robot reports the command as failed or cancelled, else 0. */
export function commandExitCode(command: Pick<RobotCommand, 'status'>): number {
  return command.status === 'failed' || command.status === 'cancelled' ? 1 : 0;
}
