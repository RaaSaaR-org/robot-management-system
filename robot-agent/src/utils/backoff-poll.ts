/**
 * @file backoff-poll.ts
 * @description A poll loop that slows down while the platform keeps failing and
 *              snaps back to its base interval on the first success.
 * @feature robot
 * @status live
 *
 * The robot polls several platform endpoints on a fixed timer. When one of them
 * fails for good — a server that predates the route answers 404, a robot the
 * server does not know — a fixed `setInterval` asks the same question every few
 * seconds forever, filling both logs (TASK-372). This loop doubles the delay
 * after each consecutive failure up to a cap, resets it on success, and reports
 * only the two transitions (started failing / recovered), never every attempt.
 */

/** The delay before the next attempt after `failures` consecutive failures. */
export function backoffDelayMs(baseMs: number, maxMs: number, failures: number, factor = 2): number {
  if (failures <= 0) return baseMs;
  const cap = Math.max(baseMs, maxMs);
  // Exponent is bounded so a long outage cannot overflow to Infinity/NaN.
  const grown = baseMs * Math.pow(factor, Math.min(failures, 32));
  return Math.min(cap, grown);
}

/** The default ceiling: five minutes, or the base interval when that is longer. */
export function defaultBackoffCapMs(baseMs: number): number {
  return Math.max(baseMs, 5 * 60_000);
}

export type BackoffTransition =
  | { kind: 'failing'; error: string; nextDelayMs: number }
  | { kind: 'recovered'; failures: number };

/** What one attempt reports: success, or failure with a reason for the log. */
export type BackoffAttempt = { ok: true } | { ok: false; error: string };

export interface BackoffPollOptions {
  /** The healthy interval, and the first retry delay. Must be > 0. */
  baseMs: number;
  /** The longest delay between attempts while failing. */
  maxMs?: number;
  factor?: number;
  /** One attempt. A rejection counts as a failure. */
  run: () => Promise<BackoffAttempt>;
  /** Called once when the loop starts failing, and once when it recovers. */
  onTransition?: (transition: BackoffTransition) => void;
  /** Run the first attempt now (default) rather than after `baseMs`. */
  immediate?: boolean;
}

export interface BackoffPoll {
  stop(): void;
  /** Consecutive failures so far (0 while healthy). */
  readonly failures: number;
}

/** Start the loop. Timers are unref'd so the loop never holds the process open. */
export function startBackoffPoll(options: BackoffPollOptions): BackoffPoll {
  const { baseMs, run, onTransition } = options;
  const maxMs = options.maxMs ?? defaultBackoffCapMs(baseMs);
  const factor = options.factor ?? 2;
  let failures = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => void attempt(), delayMs);
    timer.unref?.();
  };

  const attempt = async (): Promise<void> => {
    timer = null;
    let result: BackoffAttempt;
    try {
      result = await run();
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (stopped) return;
    if (result.ok) {
      if (failures > 0) onTransition?.({ kind: 'recovered', failures });
      failures = 0;
      schedule(baseMs);
      return;
    }
    failures += 1;
    const nextDelayMs = backoffDelayMs(baseMs, maxMs, failures, factor);
    if (failures === 1) onTransition?.({ kind: 'failing', error: result.error, nextDelayMs });
    schedule(nextDelayMs);
  };

  if (options.immediate === false) schedule(baseMs);
  else void attempt();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    get failures(): number {
      return failures;
    },
  };
}

/** The one line a transition is worth: a warning when failing starts, info on recovery. */
export function describePollTransition(label: string, target: string, t: BackoffTransition): string {
  return t.kind === 'failing'
    ? `[${label}] ${target} unavailable (${t.error}) — retrying with backoff, next in ${Math.round(t.nextDelayMs / 1000)}s`
    : `[${label}] ${target} reachable again after ${t.failures} failed attempt(s)`;
}

/** Log a transition: `console.warn` when failing starts, `console.log` on recovery. */
export function logPollTransition(label: string, target: string, t: BackoffTransition): void {
  const line = describePollTransition(label, target, t);
  if (t.kind === 'failing') console.warn(line);
  else console.log(line);
}
