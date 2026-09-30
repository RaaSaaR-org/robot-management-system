/**
 * @file wait-command.ts
 * @description Wait for a command the robot accepted as `executing` to end
 * (TASK-336). On a sidecar-backed robot `move`, `charge` and `home` walk for
 * real and the agent answers at once with `executing`; the same command flips
 * to `completed`/`failed` in its history when the walk ends.
 * @feature cli
 */

import type { CommandListResponse, RobotCommand } from '../api/types.js';

/** The part of the API client this needs — a stub in tests. */
export interface CommandHistorySource {
  getCommandHistory(page?: number, pageSize?: number): Promise<CommandListResponse>;
}

export interface WaitOptions {
  /** Give up after this long; the command is returned as last seen. Default 10 min. */
  timeoutMs?: number;
  /** Poll interval. Default 1 s. */
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const TERMINAL = new Set<RobotCommand['status']>(['completed', 'failed', 'cancelled']);

/** True while the robot is still working on the command. */
export function isInFlight(command: RobotCommand): boolean {
  return !TERMINAL.has(command.status);
}

/**
 * Poll the robot's command history until `command` is terminal, or the timeout
 * passes. Returns the latest copy seen, which is still `executing` on a timeout
 * — never a made-up ending.
 */
export async function waitForCommand(
  source: CommandHistorySource,
  command: RobotCommand,
  opts: WaitOptions = {},
): Promise<RobotCommand> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const intervalMs = opts.intervalMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;

  let latest = command;
  while (isInFlight(latest) && now() < deadline) {
    await sleep(intervalMs);
    const history = await source.getCommandHistory(1, 50);
    const found = history.commands.find((c) => c.id === command.id);
    if (!found) break; // pushed out of the history — nothing more to learn
    latest = found;
  }
  return latest;
}
