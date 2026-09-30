/**
 * @file useControlLease.ts
 * @description The teleop console's side of the robot-wide control lease
 *              (TASK-319): read the capability, take control on an explicit
 *              click, bind the agent socket, renew while bound, and stop and
 *              release on every loss path. The secret lives in a ref and in
 *              nothing else — never state, storage, a log or a URL.
 * @feature robots
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { tokenStorage } from '@/api/client';
import { getWebSocketUrl } from '@/shared/utils/websocket';
import {
  controlLeaseApi as defaultApi,
  type ControlLeaseApi,
  type ControlLeaseCapability,
  type ControlLeaseHolder,
} from '../api/controlLeaseApi';

// ============================================================================
// TYPES
// ============================================================================

/**
 * `observing → acquiring → bound → observing`. Loss and release are not
 * resting states: they land back in `observing` and leave a `notice`.
 */
export type ControlLeaseState = 'observing' | 'acquiring' | 'bound';

/** Why a lease ended — what the lost-control banner explains. */
export type ControlLeaseEndReason =
  | 'released'
  | 'renew_refused'
  | 'deadline'
  | 'revoked'
  | 'expired'
  | 'socket_closed'
  | 'hidden'
  | 'bind_refused'
  | 'bind_timeout'
  | 'robot_changed'
  | 'unmounted';

export interface ControlLeaseNotice {
  kind: 'lost' | 'conflict' | 'error';
  message: string;
  reason?: ControlLeaseEndReason;
  /** The server's refusal code, when it gave one. */
  code?: string;
}

/**
 * One agent socket the lease can be bound on. `send` answers false when the
 * socket is not open; `isOpen` lets renewal skip a socket that is closing.
 */
export interface LeaseSocket {
  send(payload: unknown): boolean;
  isOpen?(): boolean;
}

/** The part of a WebSocket the observer uses, so tests can supply a fake. */
export interface LeaseObserverSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
}

export interface UseControlLeaseOptions {
  api?: ControlLeaseApi;
  /** Monotonic clock for the local deadline; `performance.now()` by default. */
  now?: () => number;
  /** Opens the `/api/a2a/ws` observer socket; return null to not observe. */
  observerFactory?: (url: string) => LeaseObserverSocket | null;
  /**
   * Called when motion is gated (loss or release), BEFORE the release call,
   * while the agent still accepts this socket's frames — the place for a view
   * to zero its own inputs. The hook itself sends one zero `move`.
   */
  onMotionGate?: (reason: ControlLeaseEndReason) => void;
}

export interface UseControlLeaseReturn {
  /** null while unknown or unreachable — treated exactly like `enabled:false`. */
  capability: ControlLeaseCapability | null;
  /** The server advertises leases: the view must take control to drive. */
  enabled: boolean;
  state: ControlLeaseState;
  /** Who holds the robot, from the GET and the observer events. */
  holder: ControlLeaseHolder | null;
  notice: ControlLeaseNotice | null;
  /** Take control. Only ever call it from an explicit user action. */
  acquire(): Promise<void>;
  /** Stop and give control back. Idempotent. */
  release(): void;
  /** The view's own agent socket (null when it closes — that releases). */
  attachSocket(socket: LeaseSocket | null): void;
  /** Feed every agent-socket message through; true when it was a lease message. */
  handleSocketMessage(msg: unknown): boolean;
  /** Join an extra socket to the current lease (TASK-320). */
  bindSocket(socket: LeaseSocket): boolean;
  dismissNotice(): void;
}

interface ActiveLease {
  leaseId: string;
  generation: number;
  ttlMs: number;
  renewEveryMs: number;
  primary: LeaseSocket;
  sockets: Set<LeaseSocket>;
  lastRenewAt: number;
  bound: boolean;
  renewTimer: ReturnType<typeof setTimeout> | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  renewInFlight: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

const ZERO_MOVE = { move: { vx: 0, vy: 0, omega: 0 } } as const;
const OBSERVER_RETRY_MS = 3_000;

const LOSS_MESSAGES: Record<ControlLeaseEndReason, string> = {
  released: 'You released control.',
  renew_refused: 'The server refused to renew your control lease.',
  deadline: 'Your control lease could not be renewed in time.',
  revoked: 'The robot revoked your control lease.',
  expired: 'Your control lease expired on the robot.',
  socket_closed: 'The connection to the robot closed.',
  hidden: 'Control was released because the page was hidden.',
  bind_refused: 'The robot refused to bind this console to the lease.',
  bind_timeout: 'The robot did not confirm the lease in time, so control was given back.',
  robot_changed: 'Control was released because the robot changed.',
  unmounted: 'Control was released.',
};

/** Ends that the operator caused on purpose need no "control lost" banner. */
const QUIET_ENDS: ReadonlySet<ControlLeaseEndReason> = new Set(['released', 'unmounted', 'robot_changed']);

const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const defaultObserverFactory = (url: string): LeaseObserverSocket | null => {
  if (typeof WebSocket === 'undefined') return null;
  return new WebSocket(url) as unknown as LeaseObserverSocket;
};

/** Local deadline: last successful renew + `ttl − 2 × renew`. */
export function localDeadlineMs(ttlMs: number, renewEveryMs: number): number {
  return Math.max(0, ttlMs - 2 * renewEveryMs);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * The control lease for one robot, as seen from one console.
 *
 * With the capability off (or unknown) nothing here does anything and the view
 * behaves as before leases. With it on, the view drives only while `bound`.
 */
export function useControlLease(
  robotId: string,
  options: UseControlLeaseOptions = {},
): UseControlLeaseReturn {
  const api = options.api ?? defaultApi;
  const now = options.now ?? defaultNow;
  const observerFactory = options.observerFactory ?? defaultObserverFactory;

  const [capability, setCapability] = useState<ControlLeaseCapability | null>(null);
  const [state, setState] = useState<ControlLeaseState>('observing');
  const [holder, setHolder] = useState<ControlLeaseHolder | null>(null);
  const [notice, setNotice] = useState<ControlLeaseNotice | null>(null);

  // Everything the timers and socket handlers read lives in refs, so a stale
  // closure can never act on a lease that has already ended.
  const activeRef = useRef<ActiveLease | null>(null);
  /** Bumped by every end and robot change; an acquire that returns to a newer epoch lets go at once. */
  const epochRef = useRef(0);
  const acquiringRef = useRef(false);
  const primaryRef = useRef<LeaseSocket | null>(null);
  const robotIdRef = useRef(robotId);
  const mountedRef = useRef(true);
  const apiRef = useRef(api);
  const nowRef = useRef(now);
  const gateRef = useRef(options.onMotionGate);
  const factoryRef = useRef(observerFactory);
  apiRef.current = api;
  nowRef.current = now;
  gateRef.current = options.onMotionGate;
  factoryRef.current = observerFactory;

  const enabled = capability?.enabled === true;

  // --------------------------------------------------------------------------
  // End — the single exit for every loss path. Idempotent by construction:
  // the lease is taken out of the ref before anything else happens.
  // --------------------------------------------------------------------------
  const end = useCallback((reason: ControlLeaseEndReason, code?: string) => {
    const lease = activeRef.current;
    if (!lease) return;
    activeRef.current = null;
    if (lease.renewTimer !== null) clearTimeout(lease.renewTimer);
    if (lease.deadlineTimer !== null) clearTimeout(lease.deadlineTimer);

    // Gate motion first, while the agent still accepts these sockets.
    try {
      gateRef.current?.(reason);
    } catch {
      /* a view's gate callback must not keep the lease alive */
    }
    for (const socket of lease.sockets) {
      try {
        socket.send(ZERO_MOVE);
      } catch {
        /* closed socket */
      }
    }

    void apiRef.current
      .releaseControlLease(robotIdRef.current, lease.leaseId, lease.generation)
      .catch(() => {
        /* the server and the agent expire it on their own */
      });

    if (!mountedRef.current) return;
    setState('observing');
    if (!QUIET_ENDS.has(reason)) {
      setNotice({ kind: 'lost', reason, code, message: LOSS_MESSAGES[reason] });
    }
  }, []);

  const armDeadline = useCallback(
    (lease: ActiveLease) => {
      if (lease.deadlineTimer !== null) clearTimeout(lease.deadlineTimer);
      const deadlineAt = lease.lastRenewAt + localDeadlineMs(lease.ttlMs, lease.renewEveryMs);
      const check = (): void => {
        lease.deadlineTimer = null;
        if (activeRef.current !== lease) return;
        const left = deadlineAt - nowRef.current();
        if (left <= 0) {
          end(lease.bound ? 'deadline' : 'bind_timeout');
          return;
        }
        lease.deadlineTimer = setTimeout(check, left);
      };
      lease.deadlineTimer = setTimeout(check, Math.max(0, deadlineAt - nowRef.current()));
    },
    [end],
  );

  const scheduleRenew = useCallback(
    (lease: ActiveLease) => {
      if (lease.renewTimer !== null) clearTimeout(lease.renewTimer);
      lease.renewTimer = setTimeout(() => {
        lease.renewTimer = null;
        if (activeRef.current !== lease || !lease.bound) return;
        const socketOpen = !lease.primary.isOpen || lease.primary.isOpen();
        if (!socketOpen || lease.renewInFlight) {
          // Never renew over a dead socket; the close (or the deadline) ends it.
          scheduleRenew(lease);
          return;
        }
        lease.renewInFlight = true;
        const sentAt = nowRef.current();
        apiRef.current
          .renewControlLease(robotIdRef.current, lease.leaseId, lease.generation)
          .then((result) => {
            lease.renewInFlight = false;
            if (activeRef.current !== lease) return;
            if (!result.ok) {
              end('renew_refused', result.code);
              return;
            }
            lease.lastRenewAt = sentAt;
            armDeadline(lease);
            scheduleRenew(lease);
          })
          .catch(() => {
            // A network failure is not a refusal: keep the cadence and let the
            // local deadline decide.
            lease.renewInFlight = false;
            if (activeRef.current === lease) scheduleRenew(lease);
          });
      }, lease.renewEveryMs);
    },
    [armDeadline, end],
  );

  // --------------------------------------------------------------------------
  // Lifecycle: mount, robot change, capability.
  // --------------------------------------------------------------------------

  // Declared first so its cleanup runs first: an unmount's release sets no state.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A robot change or an unmount releases whatever this console holds.
  useEffect(() => {
    robotIdRef.current = robotId;
    return () => {
      epochRef.current += 1;
      acquiringRef.current = false;
      end(mountedRef.current ? 'robot_changed' : 'unmounted');
    };
  }, [robotId, end]);

  useEffect(() => {
    let cancelled = false;
    setCapability(null);
    setHolder(null);
    setNotice(null);
    setState('observing');
    apiRef.current
      .getControlLease(robotId)
      .then((status) => {
        if (cancelled) return;
        setCapability(status.capability);
        setHolder(status.holder);
      })
      .catch(() => {
        // Unreachable or an older server: behave as before leases.
      });
    return () => {
      cancelled = true;
    };
  }, [robotId]);

  // --------------------------------------------------------------------------
  // Stop — `end` plus abandoning an acquire still in flight, so a grant that
  // arrives after the operator already let go is handed straight back.
  // --------------------------------------------------------------------------
  const stop = useCallback(
    (reason: ControlLeaseEndReason, code?: string) => {
      if (acquiringRef.current) {
        acquiringRef.current = false;
        epochRef.current += 1;
        if (mountedRef.current) setState('observing');
      }
      end(reason, code);
    },
    [end],
  );

  // Hiding the page or leaving it releases: a lease must not outlive the operator's attention.
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') stop('hidden');
    };
    const onPageHide = (): void => stop('hidden');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled, stop]);

  // Observer events on `/api/a2a/ws`: who holds this robot, as it changes.
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let socket: LeaseObserverSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const open = (): void => {
      if (disposed) return;
      try {
        socket = factoryRef.current(getWebSocketUrl('/api/a2a/ws'));
      } catch {
        socket = null;
      }
      if (!socket) return;
      const ws = socket;
      ws.onopen = () => {
        // In-band, so the token never lands in a URL or a server log line.
        const token = tokenStorage.getAccessToken();
        if (token) {
          try {
            ws.send(JSON.stringify({ type: 'auth', token }));
          } catch {
            /* closing */
          }
        }
      };
      ws.onmessage = (ev) => {
        let data: unknown;
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (!isRecord(data) || data.type !== 'control_lease' || data.robotId !== robotId) return;
        const s = data.state;
        if (s === 'released' || s === 'expired') {
          setHolder(null);
          return;
        }
        if (s !== 'held' && s !== 'stopping' && s !== 'unconfirmed') return;
        const h = isRecord(data.holder) ? data.holder : {};
        setHolder({
          userId: String(h.userId ?? ''),
          displayName: String(h.displayName ?? 'another user'),
          state: s,
          generation: typeof data.generation === 'number' ? data.generation : undefined,
          expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
        });
      };
      ws.onerror = () => {
        /* onclose follows */
      };
      ws.onclose = () => {
        if (disposed || socket !== ws) return;
        socket = null;
        retry = setTimeout(open, OBSERVER_RETRY_MS);
      };
    };

    open();
    return () => {
      disposed = true;
      if (retry !== null) clearTimeout(retry);
      const ws = socket;
      socket = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      }
    };
  }, [enabled, robotId]);

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  const acquire = useCallback(async (): Promise<void> => {
    if (!enabled || activeRef.current || acquiringRef.current) return;
    const primary = primaryRef.current;
    if (!primary) {
      setNotice({ kind: 'error', message: 'Connect to the robot before taking control.' });
      return;
    }
    const epoch = epochRef.current;
    const robot = robotIdRef.current;
    const stale = (): boolean =>
      epoch !== epochRef.current || !mountedRef.current || primaryRef.current !== primary;
    acquiringRef.current = true;
    setNotice(null);
    setState('acquiring');
    const requestedAt = nowRef.current();

    let result: Awaited<ReturnType<ControlLeaseApi['acquireControlLease']>>;
    try {
      result = await apiRef.current.acquireControlLease(robot);
    } catch (err) {
      if (stale()) return;
      acquiringRef.current = false;
      setState('observing');
      setNotice({
        kind: 'error',
        message: err instanceof Error && err.message ? err.message : 'Could not take control.',
      });
      return;
    }

    if (!result.ok) {
      if (stale()) return;
      acquiringRef.current = false;
      setState('observing');
      if (result.holder) setHolder(result.holder);
      if (result.code === 'lease_held' || result.code === 'lease_unconfirmed') {
        const who = result.holder?.displayName ?? 'another user';
        setNotice({
          kind: 'conflict',
          code: result.code,
          message:
            result.code === 'lease_held'
              ? `${who} is controlling this robot.`
              : `The robot has not confirmed ${who}'s lease yet. Try again in a moment.`,
        });
      } else {
        setNotice({ kind: 'error', code: result.code, message: 'The robot could not grant control right now.' });
      }
      return;
    }

    const { grant } = result;
    if (stale()) {
      // The operator let go, the robot changed or the socket went while we waited.
      void apiRef.current.releaseControlLease(robot, grant.leaseId, grant.generation).catch(() => {
        /* the server and the agent expire it on their own */
      });
      return;
    }
    acquiringRef.current = false;
    const lease: ActiveLease = {
      leaseId: grant.leaseId,
      generation: grant.generation,
      ttlMs: grant.ttlMs,
      renewEveryMs: grant.renewEveryMs,
      primary,
      sockets: new Set([primary]),
      // Conservative: the server's clock started no earlier than our request.
      lastRenewAt: requestedAt,
      bound: false,
      renewTimer: null,
      deadlineTimer: null,
      renewInFlight: false,
    };
    activeRef.current = lease;
    // The same deadline bounds the bind: an agent that never answers `bound`
    // (one that does not enforce leases) loses the lease before the server does.
    armDeadline(lease);
    if (!primary.send({ bind: { leaseId: grant.leaseId, generation: grant.generation } })) {
      end('socket_closed');
    }
  }, [enabled, armDeadline, end]);

  const release = useCallback(() => stop('released'), [stop]);

  const attachSocket = useCallback(
    (socket: LeaseSocket | null) => {
      const previous = primaryRef.current;
      primaryRef.current = socket;
      // A closed socket — or a replacement, which is unbound — ends the lease.
      if (previous !== socket && (activeRef.current || acquiringRef.current)) stop('socket_closed');
    },
    [stop],
  );

  const handleSocketMessage = useCallback(
    (msg: unknown): boolean => {
      if (!isRecord(msg)) return false;
      const lease = activeRef.current;
      if (msg.type === 'lease') {
        if (!lease) return true;
        if (typeof msg.generation === 'number' && msg.generation !== lease.generation) return true;
        if (msg.state === 'bound') {
          if (!lease.bound) {
            lease.bound = true;
            setState('bound');
            scheduleRenew(lease);
          }
        } else if (msg.state === 'revoked' || msg.state === 'expired') {
          stop(msg.state);
        }
        return true;
      }
      if (msg.type === 'error' && (msg.code === 'lease_invalid' || msg.code === 'lease_required')) {
        if (lease && msg.code === 'lease_invalid') stop('bind_refused', msg.code);
        else if (lease?.bound) stop('revoked', 'lease_required');
        return true;
      }
      return false;
    },
    [scheduleRenew, stop],
  );

  const bindSocket = useCallback((socket: LeaseSocket): boolean => {
    const lease = activeRef.current;
    if (!lease) return false;
    const sent = socket.send({ bind: { leaseId: lease.leaseId, generation: lease.generation } });
    if (sent) lease.sockets.add(socket);
    return sent;
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    capability,
    enabled,
    state,
    holder,
    notice,
    acquire,
    release,
    attachSocket,
    handleSocketMessage,
    bindSocket,
    dismissNotice,
  };
}
