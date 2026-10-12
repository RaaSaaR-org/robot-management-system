/**
 * @file useImportJobsFeed.ts
 * @description Keeps the background-import tracker live (TASK-352): one
 *              WebSocket while any import runs, a backfill from the server's
 *              log route on every (re)connect, and a slow poll as the safety
 *              net for frames a dropped socket never delivered. Imports
 *              started elsewhere are discovered on load and on refocus, and
 *              the ones remembered from an earlier load are reconciled with
 *              the server (TASK-371).
 * @feature training
 *
 * Mounted once, in the app layout, so it follows an import whichever page the
 * operator has moved on to. With nothing running it holds no socket at all.
 */

import { useEffect } from 'react';
import { getWebSocketUrl, openServerSocket } from '@/shared/utils/websocket';
import { useImportJobsStore, type ImportFeedMessage } from '../store/importJobsStore';

/** How long a dropped socket waits before it tries again. */
export const IMPORT_FEED_RECONNECT_MS = 3000;
/** The least time between two asks for imports started elsewhere. */
export const IMPORT_DISCOVER_MIN_MS = 15_000;
/** How often running imports are re-read from the server regardless. */
export const IMPORT_FEED_POLL_MS = 10_000;

function backfillRunning(): void {
  const { jobs, order, backfill } = useImportJobsStore.getState();
  for (const id of order) {
    if (jobs[id]?.state === 'running') void backfill(id);
  }
}

export function useImportJobsFeed(): void {
  // Imports this browser did not start — another tab, another machine, the
  // API — are found by asking, on load and whenever the tab comes back into
  // view. Without this the panel only knew what this browser had started,
  // until the operator happened to open the datasets page (TASK-358).
  useEffect(() => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') return;
    // What this browser remembers is checked against this server once per
    // load, before anything else asks about it: jobs it does not know are
    // ghosts of an earlier server on this origin (TASK-371).
    void useImportJobsStore.getState().reconcile();
    let last = 0;
    const discover = () => {
      // Flicking between tabs is not a reason to ask again every time.
      if (document.visibilityState === 'hidden' || Date.now() - last < IMPORT_DISCOVER_MIN_MS) return;
      last = Date.now();
      void useImportJobsStore.getState().discover();
    };
    discover();
    document.addEventListener('visibilitychange', discover);
    return () => document.removeEventListener('visibilitychange', discover);
  }, []);

  const anyRunning = useImportJobsStore((state) =>
    state.order.some((id) => state.jobs[id]?.state === 'running'),
  );

  useEffect(() => {
    if (!anyRunning || import.meta.env.VITE_DEMO_MODE === 'true') return;

    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      try {
        socket = openServerSocket(getWebSocketUrl());
      } catch {
        reconnect = setTimeout(connect, IMPORT_FEED_RECONNECT_MS);
        return;
      }
      const ws = socket;
      // Anything that happened before this socket existed — between the POST
      // and here, or while the last one was down — comes from the log route.
      ws.onopen = () => backfillRunning();
      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as ImportFeedMessage;
          if (data.type?.startsWith('dataset:')) useImportJobsStore.getState().applyMessage(data);
        } catch {
          // Non-JSON frames belong to somebody else.
        }
      };
      ws.onclose = () => {
        if (stopped || socket !== ws) return;
        socket = null;
        reconnect = setTimeout(connect, IMPORT_FEED_RECONNECT_MS);
      };
    };

    connect();
    backfillRunning();
    const poll = setInterval(backfillRunning, IMPORT_FEED_POLL_MS);

    return () => {
      stopped = true;
      clearInterval(poll);
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
      socket = null;
    };
  }, [anyRunning]);
}
