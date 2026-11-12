/**
 * @file backgroundTask.ts
 * @description Run work nobody awaits (a timer tick, a fire-and-forget write)
 *   so that a failure is logged and survived instead of ending the process.
 * @feature core
 *
 * Node 22 exits on an unhandled rejection. A `setInterval` callback, or a
 * promise started and dropped, has no caller to reject to — so a database
 * timeout there took the whole API server down (TASK-433). Everything detached
 * goes through `runInBackground`, which is the one place that catches.
 */

/**
 * How long a job that keeps failing stays quiet after it has logged once.
 *
 * The cadence of a timer is not touched: the next tick always runs, whatever
 * the last one did. What backs off is the log line — a 500 ms heartbeat against
 * a database that is down would otherwise write two stack traces a second.
 */
export const FAILURE_LOG_WINDOW_MS = 30_000;

const MAX_TRACKED_MESSAGES = 500;

interface FailureLog {
  lastLoggedAt: number;
  suppressed: number;
}

const failureLogs = new Map<string, FailureLog>();

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function reportFailure(message: string, err: unknown): void {
  try {
    const now = Date.now();
    const state = failureLogs.get(message);
    if (state && now - state.lastLoggedAt < FAILURE_LOG_WINDOW_MS) {
      state.suppressed += 1;
      return;
    }
    const suppressed = state?.suppressed ?? 0;
    // Messages may carry an id (a job, a deployment); never let them pile up.
    if (!state && failureLogs.size >= MAX_TRACKED_MESSAGES) failureLogs.clear();
    failureLogs.set(message, { lastLoggedAt: now, suppressed: 0 });
    if (suppressed > 0) {
      console.error(message, err, `(${suppressed} more failure(s) since the last log line)`);
    } else {
      console.error(message, err);
    }
  } catch {
    // Reporting must never be the thing that throws out of a background job.
  }
}

/**
 * Start `task` without awaiting it. A synchronous throw and a rejection are
 * both logged as `message` followed by the error; neither propagates.
 *
 * @param message the log prefix, e.g. `'[SafetyService] heartbeat failed:'`.
 *   It is also the key the log line is rate-limited by.
 */
export function runInBackground(message: string, task: () => unknown): void {
  let result: unknown;
  try {
    result = task();
  } catch (err) {
    reportFailure(message, err);
    return;
  }
  if (isThenable(result)) {
    result.then(undefined, (err: unknown) => reportFailure(message, err));
  }
}

/** Forget what has been logged. For tests. */
export function resetBackgroundFailureLogs(): void {
  failureLogs.clear();
}
