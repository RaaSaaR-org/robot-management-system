/**
 * @file sessionWatch.ts
 * @description One socket that watches a data-collection session on the app
 *              socket (`/api/a2a/ws`, TASK-414): it declares a role with
 *              `teleop:watch` on open and every 10 s, says `teleop:unwatch` when
 *              closed, and — for the headset — relays the operator's state with
 *              `teleop:operator`. Display only: the server fans these out and
 *              forwards nothing to a robot.
 *
 *              TASK-417: the same socket carries a mode question from the
 *              assistant (`teleop:mode-request`, Stand up or Balance only) and
 *              the headset's answer (`teleop:mode-request:answer`). The relay
 *              forwards neither to a robot: the headset sends the change itself,
 *              under its own lease, through the base-mode route.
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

/** The modes the desktop may ask the headset for (TASK-417, D2): never Limp, never walking. */
export type RelayedMode = 'stand' | 'balance';
/** How the headset answered a mode request. */
export type ModeRequestOutcome = 'allowed' | 'declined' | 'expired' | 'failed';
/** Why the server would not relay a request. */
export type ModeRequestRejection = 'no_operator' | 'not_assistant' | 'invalid' | 'rate_limited';
/** How long the headset shows a request before it answers `expired`. Mirrors the server. */
export const MODE_REQUEST_TTL_MS = 10_000;

/** A request as the headset receives it. */
export interface ModeRequestIn {
  requestId: string;
  mode: RelayedMode;
  /** How long the prompt may stay up, ms. */
  ttlMs: number;
}

/** What the asker hears back: the headset's answer, or the server's refusal. */
export type ModeRequestReply =
  | { kind: 'answer'; requestId: string; outcome: ModeRequestOutcome; error?: string }
  | { kind: 'rejected'; requestId: string | null; error: ModeRequestRejection | string };

/** A fresh request id: short, URL-safe, unique enough for one session. */
export function newModeRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `mr-${Date.now().toString(36)}-${rand}`;
}

export interface SessionWatchOptions {
  sessionId: string;
  /** The role to declare; null opens the socket without watching yet (see `setRole`). */
  role: WatchRole | null;
  displayName?: string;
  /** The server accepted the watch (again). */
  onWatched?: () => void;
  /** The server refused it: `unauthenticated`, `session_not_found`, `forbidden`… */
  onRejected?: (error: string) => void;
  /** TASK-417, headset: the assistant asks for a mode. */
  onModeRequest?: (request: ModeRequestIn) => void;
  /** TASK-417, desktop: the answer to (or refusal of) a request this socket sent. */
  onModeReply?: (reply: ModeRequestReply) => void;
}

export interface SessionWatch {
  /** Relay one operator state; false when the socket is not (yet) the accepted operator. */
  sendOperator(state: OperatorState): boolean;
  /** TASK-417, desktop: ask the operator for a mode; false when the socket is not an accepted watcher. */
  sendModeRequest(mode: RelayedMode, requestId: string): boolean;
  /** TASK-417, headset: answer a request this socket received. */
  answerModeRequest(requestId: string, outcome: ModeRequestOutcome, error?: string): boolean;
  /** The server has acknowledged this socket's watch. */
  isWatched(): boolean;
  /**
   * Declare another role at once, or stop watching (null) without closing the
   * socket — the headset keeps its socket open while the modal is, so entering
   * VR costs one message rather than a connect.
   */
  setRole(role: WatchRole | null): void;
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
  let role: WatchRole | null = options.role;
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
    if (!role) return;
    send({ type: 'teleop:watch', sessionId: options.sessionId, role, displayName: options.displayName });
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
      if (!event.data.includes('"teleop:watch') && !event.data.includes('"auth"')
        && !event.data.includes('"teleop:mode-request')) return;
      let msg: {
        type?: unknown; sessionId?: unknown; authenticated?: unknown; error?: unknown;
        requestId?: unknown; mode?: unknown; ttlMs?: unknown; outcome?: unknown;
      };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'auth' && msg.authenticated === true) {
        watch();
      } else if (msg.type === 'teleop:watched' && msg.sessionId === options.sessionId) {
        // An acknowledgement of a role this socket has since given up is not a watch.
        if (!role || (msg as { role?: unknown }).role !== role) return;
        watched = true;
        options.onWatched?.();
      } else if (msg.type === 'teleop:watch:rejected' && msg.sessionId === options.sessionId) {
        watched = false;
        options.onRejected?.(typeof msg.error === 'string' ? msg.error : 'rejected');
      } else if (msg.sessionId !== options.sessionId) {
        // Another session's mode traffic is not ours.
      } else if (msg.type === 'teleop:mode-request') {
        if (typeof msg.requestId !== 'string' || (msg.mode !== 'stand' && msg.mode !== 'balance')) return;
        const ttl = typeof msg.ttlMs === 'number' && Number.isFinite(msg.ttlMs)
          ? Math.min(MODE_REQUEST_TTL_MS, Math.max(1_000, msg.ttlMs))
          : MODE_REQUEST_TTL_MS;
        options.onModeRequest?.({ requestId: msg.requestId, mode: msg.mode, ttlMs: ttl });
      } else if (msg.type === 'teleop:mode-request:answer') {
        const outcome = msg.outcome;
        if (typeof msg.requestId !== 'string'
          || (outcome !== 'allowed' && outcome !== 'declined' && outcome !== 'expired' && outcome !== 'failed')) return;
        options.onModeReply?.({
          kind: 'answer',
          requestId: msg.requestId,
          outcome,
          ...(typeof msg.error === 'string' ? { error: msg.error } : {}),
        });
      } else if (msg.type === 'teleop:mode-request:rejected') {
        options.onModeReply?.({
          kind: 'rejected',
          requestId: typeof msg.requestId === 'string' ? msg.requestId : null,
          error: typeof msg.error === 'string' ? msg.error : 'invalid',
        });
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
    sendModeRequest: (mode, requestId) => {
      if (!watched) return false;
      return send({ type: 'teleop:mode-request', sessionId: options.sessionId, mode, requestId });
    },
    answerModeRequest: (requestId, outcome, error) =>
      send({
        type: 'teleop:mode-request:answer',
        sessionId: options.sessionId,
        requestId,
        outcome,
        ...(error ? { error: error.slice(0, 160) } : {}),
      }),
    isWatched: () => watched,
    setRole: (next) => {
      if (closed || next === role) return;
      const previous = role;
      role = next;
      watched = false;
      if (next) watch();
      else if (previous) send({ type: 'teleop:unwatch', sessionId: options.sessionId });
    },
    close: () => {
      if (closed) return;
      closed = true;
      if (beat) clearInterval(beat);
      if (reconnect) clearTimeout(reconnect);
      if (role) send({ type: 'teleop:unwatch', sessionId: options.sessionId });
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
