/**
 * @file rateLimitStatus.ts
 * @description Whether the app is currently waiting out a 429 (TASK-482).
 *              Whatever backs off after a "too many requests" answer — the API
 *              client, the episode video player — registers the wait here, so
 *              one calm hint can say "retrying" while it lasts. The hint only
 *              appears once a wait has gone on for more than a moment: a
 *              back-off that resolves within a second and a half is invisible.
 * @feature api
 */

import { useSyncExternalStore } from 'react';

/** How long a wait may last before anything is said about it. */
export const RATE_LIMIT_HINT_DELAY_MS = 1500;

let waiting = 0;
let visible = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function setVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  for (const listener of [...listeners]) listener();
}

/**
 * Register one request (or video) that is waiting to retry after a 429.
 * Call the returned function when the wait is over, however it ended.
 */
export function beginRateLimitWait(): () => void {
  waiting += 1;
  if (!visible && timer === null) {
    timer = setTimeout(() => {
      timer = null;
      if (waiting > 0) setVisible(true);
    }, RATE_LIMIT_HINT_DELAY_MS);
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    waiting = Math.max(0, waiting - 1);
    if (waiting > 0) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    setVisible(false);
  };
}

/** True while a 429 wait has lasted long enough to be worth mentioning. */
export function isRateLimitHintVisible(): boolean {
  return visible;
}

export function subscribeRateLimitHint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding of {@link isRateLimitHintVisible}. */
export function useRateLimitHint(): boolean {
  return useSyncExternalStore(subscribeRateLimitHint, isRateLimitHintVisible, isRateLimitHintVisible);
}

/** Forget every wait. For tests. */
export function resetRateLimitStatus(): void {
  waiting = 0;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  setVisible(false);
}
