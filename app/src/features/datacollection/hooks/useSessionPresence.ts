/**
 * @file useSessionPresence.ts
 * @description Declares this page as a watcher of a data-collection session
 *              (TASK-414, D2): `teleop:watch` with its role on mount and every
 *              10 s, `teleop:unwatch` on unmount. The session page declares
 *              `assistant`; while its VR modal is open it declares nothing,
 *              because the headset's publisher has claimed `operator`. Who
 *              watches comes back as `teleop:session:presence` through
 *              `useTeleopEvents` into the store.
 *
 *              TASK-417: the assistant's socket also asks the headset for Stand
 *              up or Balance (`requestMode`). The operator allows it inside the
 *              headset, whose page sends the change under its own lease; this
 *              side only hears the outcome.
 * @feature datacollection
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  MODE_REQUEST_TTL_MS,
  newModeRequestId,
  openSessionWatch,
  type ModeRequestOutcome,
  type ModeRequestReply,
  type RelayedMode,
  type SessionWatch,
  type WatchRole,
} from '@/shared/utils/sessionWatch';
import { useAuthStore } from '@/features/auth/store/authStore';

/** Wait this long past the headset's own expiry before calling a request unanswered. */
export const MODE_REQUEST_ANSWER_GRACE_MS = 3_000;

/** What became of a request: the headset's answer, or why it never reached the headset. */
export type ModeRequestResult =
  | { outcome: ModeRequestOutcome; error?: string }
  | { outcome: 'rejected'; error: string }
  | { outcome: 'unsent'; error: string };

export interface UseSessionPresenceReturn {
  /** Ask the session's operator for a mode (assistant only). Resolves once with the outcome. */
  requestMode(mode: RelayedMode): Promise<ModeRequestResult>;
}

/** The pending requests of one socket: resolved by reply, by timeout, or by closing. */
export class ModeRequestWaiters {
  private readonly waiting = new Map<string, { resolve: (r: ModeRequestResult) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly timeoutMs: number = MODE_REQUEST_TTL_MS + MODE_REQUEST_ANSWER_GRACE_MS) {}

  wait(requestId: string): Promise<ModeRequestResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(requestId, { outcome: 'expired' }), this.timeoutMs);
      this.waiting.set(requestId, { resolve, timer });
    });
  }

  /** Settle one request; a reply for a request nobody waits on is dropped. */
  settle(requestId: string, result: ModeRequestResult): void {
    const entry = this.waiting.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.waiting.delete(requestId);
    entry.resolve(result);
  }

  reply(reply: ModeRequestReply): void {
    if (reply.kind === 'answer') {
      this.settle(reply.requestId, reply.error ? { outcome: reply.outcome, error: reply.error } : { outcome: reply.outcome });
    } else if (reply.requestId) {
      this.settle(reply.requestId, { outcome: 'rejected', error: reply.error });
    }
  }

  /** The socket closed: every request still waiting is unanswered. */
  closeAll(error: string): void {
    for (const id of [...this.waiting.keys()]) this.settle(id, { outcome: 'unsent', error });
  }
}

/**
 * Watch `sessionId` as `role` for as long as both are set. Pass a null role to
 * stop watching (the page's VR modal is open).
 */
export function useSessionPresence(sessionId: string | null | undefined, role: WatchRole | null): UseSessionPresenceReturn {
  const displayName = useAuthStore((s) => s.user?.name ?? s.user?.email ?? undefined);
  const watchRef = useRef<SessionWatch | null>(null);
  const waitersRef = useRef<ModeRequestWaiters | null>(null);

  useEffect(() => {
    if (!sessionId || !role || import.meta.env.VITE_DEMO_MODE === 'true') return undefined;
    const waiters = new ModeRequestWaiters();
    const watch = openSessionWatch({
      sessionId,
      role,
      displayName,
      onModeReply: (reply) => waiters.reply(reply),
    });
    watchRef.current = watch;
    waitersRef.current = waiters;
    return () => {
      watch.close();
      waiters.closeAll('This page stopped watching the session.');
      if (watchRef.current === watch) watchRef.current = null;
      if (waitersRef.current === waiters) waitersRef.current = null;
    };
  }, [sessionId, role, displayName]);

  const requestMode = useCallback(async (mode: RelayedMode): Promise<ModeRequestResult> => {
    const watch = watchRef.current;
    const waiters = waitersRef.current;
    if (!watch || !waiters) return { outcome: 'unsent', error: 'This page is not watching the session.' };
    const requestId = newModeRequestId();
    const answer = waiters.wait(requestId);
    if (!watch.sendModeRequest(mode, requestId)) {
      waiters.settle(requestId, { outcome: 'unsent', error: 'Not connected to the server yet.' });
    }
    return answer;
  }, []);

  return { requestMode };
}
