/**
 * @file vrSession.ts
 * @description The teleop socket, as pure logic: a reconnecting link with a
 *              status enum instead of a boolean, the E-Stop send order, the
 *              gate that stops the rig streaming once latched, and the
 *              liveness classification the HUD renders. Pure — no React, no
 *              three.js, no WebXR. The only DOM touch is the default
 *              `WebSocket` factory, which is injectable.
 * @feature robots
 */

/**
 * Where the socket is, replacing the `connected: boolean` the modal used to
 * hold.
 *
 * A boolean cannot say "we dropped and are coming back", and the rig was
 * rendered as `{connected && <VrTeleopRig/>}` — so on a drop the rig simply
 * unmounted. Inside the headset NOTHING changed: the scene kept rendering, the
 * robot kept its last pose, and the operator went on moving their hands at a
 * robot that was no longer listening.
 */
export type LinkStatus = 'connecting' | 'open' | 'closed' | 'error';

/** How fresh the agent's `{type:'state'}` echo is — what the HUD's LINK line shows. */
export type LinkState = 'live' | 'stale' | 'lost';

/**
 * Boundaries for `linkState`, in milliseconds.
 *
 * The agent answers EVERY `{positions}` frame with a `{type:'state'}`
 * synchronously (`robot-agent/src/api/keyboard-teleop.ts`), and the rig streams
 * positions at 20 Hz, so a healthy link produces a state every ~50 ms.
 *
 * - 500 ms is ten missed replies. Wi-Fi jitter on a Quest does not do that.
 * - 2000 ms means the socket is open and the agent has stopped answering
 *   entirely. By then the agent's own dead man (MOVE_TTL_S = 0.35 s) has already
 *   stopped the base, so 'lost' is not a warning about what might happen — it is
 *   a report of what has.
 *
 * These only mean anything while the rig is STREAMING: with no arm engaged the
 * rig sends nothing and the agent has nothing to answer, so the caller must not
 * classify an idle link as lost.
 */
export const LINK_STALE_AFTER_MS = 500;
export const LINK_LOST_AFTER_MS = 2000;

/**
 * Classify the link from the age of the last `{type:'state'}` message.
 *
 * Never having received one is 'lost', not 'live': the fail-safe direction for
 * a control link is to assume it is down until it proves otherwise.
 */
export function linkState(now: number, lastStateMsgAt: number | null | undefined): LinkState {
  if (lastStateMsgAt == null || !Number.isFinite(lastStateMsgAt) || !Number.isFinite(now)) {
    return 'lost';
  }
  const age = now - lastStateMsgAt;
  // A clock that went backwards (a resumed tab, a corrected system clock) is
  // not evidence of a dead link.
  if (age < 0) return 'live';
  if (age >= LINK_LOST_AFTER_MS) return 'lost';
  if (age >= LINK_STALE_AFTER_MS) return 'stale';
  return 'live';
}

/**
 * Reconnect delays in milliseconds; the last entry repeats forever.
 *
 * Bounded at 4 s on purpose. The agent is on the same LAN as the headset and the
 * operator is standing in a room wearing it — an exponential backoff that walks
 * out to 30 s would leave them staring at a frozen scene long after the link
 * could have come back, and they have no way to press a button they cannot see.
 */
export const RECONNECT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000];

/** The zero-velocity frame the E-Stop sends first. */
export const STOP_FRAME = { move: { vx: 0, vy: 0, omega: 0 } } as const;

/** Default reason recorded with an E-Stop raised from the headset. */
export const ESTOP_REASON = 'VR teleop operator E-Stop';

export type EstopRestOutcome = 'skipped' | 'ok' | 'failed';

export interface EstopSequenceResult {
  /** Whether both socket frames went out. */
  socket: 'sent' | 'failed';
  rest: EstopRestOutcome;
}

/**
 * Raise the E-Stop, in the order that survives the most failures.
 *
 * 1. `{move:{vx:0,vy:0,omega:0}}` FIRST, on the socket that is already open.
 *    This is the frame that actually stops a walking robot, and it is one
 *    already-established TCP write away — no DNS, no TLS handshake, no auth.
 * 2. `{estop:{reason}}` second, on the same socket. The agent latches it
 *    durably and disables teleop.
 * 3. The REST safety call in PARALLEL, never in sequence, and its failure is
 *    never allowed to affect 1 and 2. It exists for the fleet alert and the
 *    audit trail, and it goes to a DIFFERENT host than the socket — the headset
 *    browser and the desktop that opened this page do not always have the same
 *    reachability, which is exactly the situation where awaiting it before
 *    sending the stop frame would cost the robot several seconds of floor.
 */
export async function estopSequence(
  send: (payload: unknown) => void,
  restCall?: () => Promise<unknown>,
  reason: string = ESTOP_REASON,
): Promise<EstopSequenceResult> {
  let socket: EstopSequenceResult['socket'] = 'sent';
  try {
    send(STOP_FRAME);
    send({ estop: { reason } });
  } catch {
    // A closed socket must not stop the REST call from raising the alert.
    socket = 'failed';
  }

  if (!restCall) return { socket, rest: 'skipped' };
  // Started only after the two synchronous socket writes have already gone out,
  // so the stop frame can never be queued behind an HTTP request.
  try {
    await restCall();
    return { socket, rest: 'ok' };
  } catch {
    return { socket, rest: 'failed' };
  }
}

export interface StreamGateState {
  estopLatched: boolean;
  status: LinkStatus;
}

/**
 * Whether the rig should be emitting `{positions}` and `{move}` at all.
 *
 * Once an E-Stop is latched the agent DISCARDS teleop input and answers with
 * `{type:'error', code:'estop_latched'}`. Streaming into that does nothing
 * useful and produces one refusal per frame; worse, it means the moment the
 * latch is cleared the robot receives a pose stream from hands that have been
 * moving freely while it was stopped. Stop at the source.
 */
export function shouldStream(state: StreamGateState): boolean {
  return !state.estopLatched && state.status === 'open';
}

/** The subset of `WebSocket` this module uses, so tests can supply a fake. */
export interface TeleopSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export type TeleopSocketFactory = (url: string) => TeleopSocketLike;

/** `WebSocket.OPEN`, spelled out so this module needs no DOM globals to reason. */
const SOCKET_OPEN = 1;

export interface TeleopLinkOptions {
  url: string;
  /** Called with each parsed inbound message and the time it arrived. */
  onMessage: (msg: unknown, at: number) => void;
  onStatus: (status: LinkStatus) => void;
  /** Clock, injectable so tests do not depend on wall time. */
  now?: () => number;
  socketFactory?: TeleopSocketFactory;
  backoffMs?: readonly number[];
}

export interface TeleopLink {
  connect(): void;
  /** Serialises and sends; false when the socket is not open. */
  send(payload: unknown): boolean;
  status(): LinkStatus;
  /** When the last message arrived, for `linkState`. */
  lastMessageAt(): number | null;
  /** Close and cancel any pending retry. Idempotent. */
  dispose(): void;
}

/**
 * A teleop socket that comes back.
 *
 * WHAT THIS REPLACES: `connect()` ran once from a mount effect with no retry at
 * all, and its only failure signal was `setConnected(false)`. Combined with the
 * rig being rendered as `{connected && <VrTeleopRig/>}`, a dropped link
 * unmounted the rig and left the wearer inside a scene that looked exactly the
 * same as a working one.
 *
 * The socket-identity guard (`current === ws` on every handler) is kept and is
 * not optional: React StrictMode double-mounts the effect, so a previous,
 * closing socket's async `onclose` can otherwise fire AFTER the live socket is
 * installed and tear it down — leaving the UI 'open' while every send silently
 * no-ops.
 */
export function createTeleopLink(options: TeleopLinkOptions): TeleopLink {
  const {
    url,
    onMessage,
    onStatus,
    now = () => Date.now(),
    // One cast, at the boundary: the real `WebSocket`'s handlers are typed with
    // their DOM events, which are contravariantly incompatible with the
    // narrower shape this module needs. The handlers below use only `ev.data`,
    // which a `MessageEvent` has.
    socketFactory = (u: string) => new WebSocket(u) as unknown as TeleopSocketLike,
    backoffMs = RECONNECT_BACKOFF_MS,
  } = options;

  let current: TeleopSocketLike | null = null;
  let status: LinkStatus = 'closed';
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastAt: number | null = null;
  let disposed = false;

  const setStatus = (next: LinkStatus): void => {
    if (status === next) return;
    status = next;
    onStatus(next);
  };

  const scheduleRetry = (): void => {
    // One timer at a time: a real WebSocket fires 'error' AND then 'close' for
    // the same failure, and scheduling from both would halve the backoff.
    if (disposed || retryTimer !== null) return;
    const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 1000;
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const connect = (): void => {
    if (disposed) return;
    if (current !== null) return;
    setStatus('connecting');
    let ws: TeleopSocketLike;
    try {
      ws = socketFactory(url);
    } catch {
      // A malformed URL throws synchronously in the constructor. Retrying will
      // not fix that, but neither will giving up silently — the backoff caps at
      // 4 s and the status stays 'error', which is what the HUD shows.
      setStatus('error');
      scheduleRetry();
      return;
    }
    current = ws;

    ws.onopen = () => {
      if (current !== ws) return;
      // Reset only on a SUCCESSFUL open. Resetting on every connect attempt
      // would turn the backoff into a fixed 1 s retry against a dead agent.
      attempt = 0;
      setStatus('open');
    };
    ws.onmessage = (ev) => {
      if (current !== ws) return;
      lastAt = now();
      try {
        onMessage(JSON.parse(String(ev.data)), lastAt);
      } catch {
        /* a frame we cannot parse is not a reason to drop the link */
      }
    };
    ws.onerror = () => {
      if (current !== ws) return;
      setStatus('error');
      scheduleRetry();
    };
    ws.onclose = () => {
      if (current !== ws) return;
      current = null;
      if (status !== 'error') setStatus('closed');
      scheduleRetry();
    };
  };

  const detach = (ws: TeleopSocketLike): void => {
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
  };

  return {
    connect,
    send(payload: unknown): boolean {
      const ws = current;
      if (!ws || ws.readyState !== SOCKET_OPEN) return false;
      try {
        ws.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    },
    status: () => status,
    lastMessageAt: () => lastAt,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      const ws = current;
      current = null;
      if (ws) {
        // Detach BEFORE close: otherwise our own close handler schedules a
        // retry that dispose() has already cancelled, and the link comes back
        // after the modal is gone.
        detach(ws);
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      }
      setStatus('closed');
    },
  };
}
