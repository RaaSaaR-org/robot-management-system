/**
 * @file processHandlers.ts
 * @description Process-level handlers for errors nothing else caught.
 * @feature core
 *
 * Kept apart from `index.ts` so a test can import the handlers without
 * starting the server (TASK-433).
 *
 * Policy:
 *
 * - `unhandledRejection` — always logged with its stack.
 *   - Outside production the process keeps running: one dropped promise must
 *     not end a dev session.
 *   - In production the process exits with code 1 after logging, so the
 *     orchestrator restarts a pod that may be broken. Registering a handler
 *     replaces Node's own exit, so the exit has to be explicit.
 *   - `UNHANDLED_REJECTION_EXIT` overrides either default: `false` keeps a
 *     production process alive (a single-replica instance where a restart is
 *     the outage), `true` makes any environment exit.
 * - `uncaughtException` — logged, then exit code 1 in every environment. After
 *   a synchronous throw nobody caught, the state of the process is unknown.
 */

import { logger } from './logger.js';

function formatReason(reason: unknown): string {
  if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
  try {
    return typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/** Whether an unhandled rejection ends the process. Read on every call. */
export function exitsOnUnhandledRejection(env: NodeJS.ProcessEnv = process.env): boolean {
  const override = env.UNHANDLED_REJECTION_EXIT?.trim().toLowerCase();
  if (override === 'true' || override === '1') return true;
  if (override === 'false' || override === '0') return false;
  return env.NODE_ENV === 'production';
}

export function handleUnhandledRejection(reason: unknown): void {
  const willExit = exitsOnUnhandledRejection();
  // console.error is synchronous on a pipe or file; the pino line may not have
  // been flushed by the time process.exit runs, so the stack goes out both ways.
  console.error(
    `[process] Unhandled promise rejection${willExit ? ' — exiting' : ' — process keeps running'}:`,
    formatReason(reason),
  );
  logger.error({ err: reason instanceof Error ? reason : new Error(formatReason(reason)) }, 'Unhandled promise rejection');
  if (willExit) process.exit(1);
}

export function handleUncaughtException(err: unknown, origin?: string): void {
  console.error(`[process] Uncaught exception (${origin ?? 'uncaughtException'}) — exiting:`, formatReason(err));
  logger.fatal({ err: err instanceof Error ? err : new Error(formatReason(err)), origin }, 'Uncaught exception');
  process.exit(1);
}

let registered = false;

/** Register both handlers on `process`. Idempotent. */
export function registerProcessHandlers(): void {
  if (registered) return;
  registered = true;
  process.on('unhandledRejection', handleUnhandledRejection);
  process.on('uncaughtException', handleUncaughtException);
}
