/**
 * @file sessionWatch.ts
 * @description One socket that watches a data-collection session on the app
 *              socket (`/api/a2a/ws`, TASK-414): it declares a role with
 *              `teleop:watch` on open and every 10 s, says `teleop:unwatch` when
 *              closed, and — for the headset — relays the operator's state with
 *              `teleop:operator`. Display only: the server fans these out and
 *              forwards nothing to a robot.
 *
 *              Shared by the session page's presence (datacollection) and the
 *              headset's operator publisher (robots/vr), which is why it lives
 *              here rather than in either feature.
 * @feature datacollection
 */

import { getWebSocketUrl, openServerSocket } from './websocket';

/** How often a watcher repeats `teleop:watch`; the server forgets one silent for ~25 s. */
export const WATCH_INTERVAL_MS = 10_000;
/** Wait before reopening a socket that dropped. */
export const WATCH_RECONNECT_MS = 3_000;
/** Skip a relayed state while the socket is this far behind (it is replaced 200 ms later). */
const MAX_BUFFERED_BYTES = 16_384;

export type WatchRole = 'operator' | 'assistant';

/** A pose in the robot's frame, relative to its eye point: +x forward, +y left, +z up; q is (x, y, z, w). */
export interface OperatorPose {
  p: [number, number, number];
  q: [number, number, number, number];
}

/** What the headset relays about its operator at 5 Hz. Mirrors the server's `operatorStateSchema`. */
export interface OperatorState {
  inVr: boolean;
  link: 'live' | 'stale' | 'lost';
  rttMs: number | null;
  clutch: { left: boolean; right: boolean };
  /** Grip axis per hand, 0..1. */
  grip: { left: number; right: number };
  /** The agent's last `held` answer while it is fresh. */
  held: { side: 'left' | 'right' | 'both'; reason: string } | null;
  /** The headset's why line. */
  why: { code: string; severity: 'block' | 'warn' | 'ok'; text: string };
  head: OperatorPose | null;
  /** Commanded wrist targets (IK mode); null for a side that is not driving. */
  targets: { left: OperatorPose | null; right: OperatorPose | null };
}

export interface SessionWatchOptions {
  sessionId: string;
  role: WatchRole;
  displayName?: string;
  /** The server accepted the watch (again). */
  onWatched?: () => void;
  /** The server refused it: `unauthenticated`, `session_not_found`, `forbidden`… */
  onRejected?: (error: string) => void;
}

export interface SessionWatch {
  /** Relay one operator state; false when the socket is not (yet) the accepted operator. */
  sendOperator(state: OperatorState): boolean;
  /** The server has acknowledged this socket's watch. */
  isWatched(): boolean;
  /** Unwatch and close for good. */
  close(): void;
}

/** Seams for tests. */
export interface SessionWatchDeps {
  open: (url: string) => WebSocket;
  url: string;
}

const OPEN = 1;

/**
 * Open a watching socket. It reconnects on its own after a drop and repeats
 * the watch after the server identifies it (`auth`), so a race between the
 * auth frame and the first watch heals within one round trip.
 */
export function openSessionWatch(options: SessionWatchOptions, deps?: Partial<SessionWatchDeps>): SessionWatch {
  const open = deps?.open ?? ((url: string) => openServerSocket(url));
  const url = deps?.url ?? getWebSocketUrl('/api/a2a/ws');
  let ws: WebSocket | null = null;
  let watched = false;
  let closed = false;
  let beat: ReturnType<typeof setInterval> | null = null;
  let reconnect: ReturnType<typeof setTimeout> | null = null;

  const send = (body: unknown): boolean => {
    if (!ws || ws.readyState !== OPEN) return false;
    try {
      ws.send(JSON.stringify(body));
      return true;
    } catch {
      return false;
    }
  };
  const watch = (): void => {
    send({ type: 'teleop:watch', sessionId: options.sessionId, role: options.role, displayName: options.displayName });
  };

  const connect = (): void => {
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = open(url);
    } catch {
      reconnect = setTimeout(connect, WATCH_RECONNECT_MS);
      return;
    }
    ws = socket;
    socket.addEventListener('open', () => {
      watch();
      if (beat) clearInterval(beat);
      beat = setInterval(watch, WATCH_INTERVAL_MS);
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      // Cheap pre-filter: this socket also receives every event of the tenant.
      if (!event.data.includes('"teleop:watch') && !event.data.includes('"auth"')) return;
      let msg: { type?: unknown; sessionId?: unknown; authenticated?: unknown; error?: unknown };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'auth' && msg.authenticated === true) {
        watch();
      } else if (msg.type === 'teleop:watched' && msg.sessionId === options.sessionId) {
        watched = true;
        options.onWatched?.();
      } else if (msg.type === 'teleop:watch:rejected' && msg.sessionId === options.sessionId) {
        watched = false;
        options.onRejected?.(typeof msg.error === 'string' ? msg.error : 'rejected');
      }
    });
    socket.addEventListener('close', () => {
      if (ws !== socket) return;
      watched = false;
      ws = null;
      if (beat) clearInterval(beat);
      beat = null;
      if (!closed) reconnect = setTimeout(connect, WATCH_RECONNECT_MS);
    });
  };

  connect();

  return {
    sendOperator: (state) => {
      if (!watched || !ws || ws.readyState !== OPEN) return false;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return false;
      return send({ type: 'teleop:operator', sessionId: options.sessionId, state });
    },
    isWatched: () => watched,
    close: () => {
      if (closed) return;
      closed = true;
      if (beat) clearInterval(beat);
      if (reconnect) clearTimeout(reconnect);
      send({ type: 'teleop:unwatch', sessionId: options.sessionId });
      const socket = ws;
      ws = null;
      watched = false;
      try {
        socket?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
