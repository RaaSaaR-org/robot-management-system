/**
 * @file sessionPresence.ts
 * @description Who is watching a data-collection session, and the operator's
 *              display-only state relayed from the headset to the desktop
 *              assistant (TASK-414). Pure: no socket, no database, no timers of
 *              its own except the relay's trailing send — `index.ts` wires it
 *              to `/api/a2a/ws`.
 * @feature datacollection
 *
 * Two people run a session: the operator in the Quest and the assistant at a
 * desktop. Both pages send `teleop:watch` heartbeats on the app socket (D2); the
 * headset additionally relays a small `OperatorState` (grip, link, why line,
 * targets) that the server only validates, throttles and fans out (D1).
 *
 * TASK-417 adds a question and its answer: the assistant asks the headset for
 * Stand up or Balance (`teleop:mode-request`), the operator allows it inside the
 * headset and its own page sends the mode change under its own lease. The relay
 * carries the question to the operator socket and the answer back to the asker,
 * and nothing else.
 *
 * None of these messages changes robot state: nothing here is forwarded to an agent.
 */

import { z } from 'zod';

/** A watcher not heard from for this long is gone (the client beats every 10 s). */
export const PRESENCE_TTL_MS = 24_000;
/** How often the server sweeps for silent watchers: a silent one is gone by TTL + sweep ≤ 25 s. */
export const PRESENCE_SWEEP_MS = 1_000;
/** The operator relay's rate per session: 5 Hz. */
export const OPERATOR_RELAY_INTERVAL_MS = 200;
/** The largest operator state the relay accepts, serialized, in bytes. */
export const OPERATOR_STATE_MAX_BYTES = 2048;
/** The longest display name a watcher may announce. */
export const DISPLAY_NAME_MAX = 40;

export type PresenceRole = 'operator' | 'assistant';

/** One watcher of a session, as broadcast. */
export interface PresenceViewer {
  userId: string;
  displayName: string;
  role: PresenceRole;
  /** When this socket first watched the session, ISO. */
  since: string;
}

interface Entry {
  userId: string;
  displayName: string;
  role: PresenceRole;
  since: number;
  lastSeen: number;
}

/** A display name as the client announced it: trimmed, no control characters, capped; else the fallback. */
export function cleanDisplayName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback.slice(0, DISPLAY_NAME_MAX);
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, DISPLAY_NAME_MAX);
  return text || fallback.slice(0, DISPLAY_NAME_MAX);
}

export function isPresenceRole(value: unknown): value is PresenceRole {
  return value === 'operator' || value === 'assistant';
}

/**
 * sessionId → socket → watcher. Every mutation answers whether the session's
 * viewer list changed, so the caller broadcasts only on a change.
 */
export class SessionPresence<S extends object> {
  private readonly sessions = new Map<string, Map<S, Entry>>();

  /** Declare or refresh a watcher. True when the viewer list changed (joined or switched role/name). */
  watch(
    socket: S,
    sessionId: string,
    who: { userId: string; displayName: string; role: PresenceRole },
    now: number
  ): boolean {
    let viewers = this.sessions.get(sessionId);
    if (!viewers) {
      viewers = new Map();
      this.sessions.set(sessionId, viewers);
    }
    const existing = viewers.get(socket);
    if (existing) {
      existing.lastSeen = now;
      const changed =
        existing.role !== who.role || existing.displayName !== who.displayName || existing.userId !== who.userId;
      existing.role = who.role;
      existing.displayName = who.displayName;
      existing.userId = who.userId;
      return changed;
    }
    viewers.set(socket, { ...who, since: now, lastSeen: now });
    return true;
  }

  /** Stop watching one session. True when the socket was watching it. */
  unwatch(socket: S, sessionId: string): boolean {
    const viewers = this.sessions.get(sessionId);
    if (!viewers || !viewers.delete(socket)) return false;
    if (viewers.size === 0) this.sessions.delete(sessionId);
    return true;
  }

  /** A closed socket leaves every session it watched; returns those sessions. */
  dropSocket(socket: S): string[] {
    const changed: string[] = [];
    for (const sessionId of [...this.sessions.keys()]) {
      if (this.unwatch(socket, sessionId)) changed.push(sessionId);
    }
    return changed;
  }

  /** Drop watchers silent for longer than `ttlMs`; returns the sessions that changed. */
  sweep(now: number, ttlMs: number = PRESENCE_TTL_MS): string[] {
    const changed = new Set<string>();
    for (const [sessionId, viewers] of [...this.sessions]) {
      for (const [socket, entry] of [...viewers]) {
        if (now - entry.lastSeen > ttlMs) {
          viewers.delete(socket);
          changed.add(sessionId);
        }
      }
      if (viewers.size === 0) this.sessions.delete(sessionId);
    }
    return [...changed];
  }

  /** Whether `socket` declared itself the operator of `sessionId`. */
  isOperator(socket: S, sessionId: string): boolean {
    return this.sessions.get(sessionId)?.get(socket)?.role === 'operator';
  }

  /** Whether `socket` declared itself an assistant of `sessionId` (TASK-417). */
  isAssistant(socket: S, sessionId: string): boolean {
    return this.sessions.get(sessionId)?.get(socket)?.role === 'assistant';
  }

  /** The sockets that declared themselves the session's operator (normally one). */
  operatorSockets(sessionId: string): S[] {
    const viewers = this.sessions.get(sessionId);
    if (!viewers) return [];
    return [...viewers].filter(([, entry]) => entry.role === 'operator').map(([socket]) => socket);
  }

  /** Whether any socket is the session's declared operator. */
  hasOperator(sessionId: string): boolean {
    const viewers = this.sessions.get(sessionId);
    if (!viewers) return false;
    for (const entry of viewers.values()) if (entry.role === 'operator') return true;
    return false;
  }

  /** The session's watchers, oldest first. */
  viewers(sessionId: string): PresenceViewer[] {
    const viewers = this.sessions.get(sessionId);
    if (!viewers) return [];
    return [...viewers.values()]
      .sort((a, b) => a.since - b.since)
      .map((e) => ({ userId: e.userId, displayName: e.displayName, role: e.role, since: new Date(e.since).toISOString() }));
  }

  /** Sessions with at least one watcher (tests, diagnostics). */
  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }
}

// ---------------------------------------------------------------------------
// Operator state
// ---------------------------------------------------------------------------

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const quat = z.tuple([finite, finite, finite, finite]);
const pose = z.object({ p: vec3, q: quat });
const side = z.object({ left: z.boolean(), right: z.boolean() });
const unit = z.number().finite().min(0).max(1);

/**
 * What the headset relays. Unknown keys are dropped (zod's default strip), and
 * every string is bounded so the 2 KB cap is about the shape, not one field.
 */
export const operatorStateSchema = z.object({
  inVr: z.boolean(),
  link: z.enum(['live', 'stale', 'lost']),
  rttMs: z.number().finite().min(0).max(600_000).nullable(),
  clutch: side,
  grip: z.object({ left: unit, right: unit }),
  held: z
    .object({ side: z.enum(['left', 'right', 'both']), reason: z.string().max(40) })
    .nullable(),
  why: z.object({
    code: z.string().max(40),
    severity: z.enum(['block', 'warn', 'ok']),
    text: z.string().max(160),
  }),
  head: pose.nullable(),
  targets: z.object({ left: pose.nullable(), right: pose.nullable() }),
});

export type OperatorState = z.infer<typeof operatorStateSchema>;

export type OperatorStateCheck =
  | { ok: true; state: OperatorState }
  | { ok: false; error: 'too_large' | 'invalid' };

/** Validate one relayed state: at most 2 KB serialized, and the schema's shape. */
export function parseOperatorState(raw: unknown): OperatorStateCheck {
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (size > OPERATOR_STATE_MAX_BYTES) return { ok: false, error: 'too_large' };
  const parsed = operatorStateSchema.safeParse(raw);
  return parsed.success ? { ok: true, state: parsed.data } : { ok: false, error: 'invalid' };
}

/**
 * At most one relayed state per session per `intervalMs`, trailing: a state
 * that arrives inside the window replaces any one already waiting and goes out
 * when the window ends, so the desktop always ends on the operator's latest.
 */
export class OperatorRelay<T> {
  private readonly lastSent = new Map<string, number>();
  private readonly pending = new Map<string, { value: T; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly emit: (sessionId: string, value: T) => void,
    private readonly intervalMs: number = OPERATOR_RELAY_INTERVAL_MS,
    private readonly now: () => number = Date.now
  ) {}

  offer(sessionId: string, value: T): void {
    const now = this.now();
    const last = this.lastSent.get(sessionId);
    const waiting = this.pending.get(sessionId);
    if (waiting) {
      waiting.value = value;
      return;
    }
    if (last === undefined || now - last >= this.intervalMs) {
      this.lastSent.set(sessionId, now);
      this.emit(sessionId, value);
      return;
    }
    const timer = setTimeout(() => {
      const entry = this.pending.get(sessionId);
      this.pending.delete(sessionId);
      if (!entry) return;
      this.lastSent.set(sessionId, this.now());
      this.emit(sessionId, entry.value);
    }, this.intervalMs - (now - last));
    this.pending.set(sessionId, { value, timer });
  }

  /** Forget a session (no operator left): a waiting state is dropped. */
  forget(sessionId: string): void {
    const waiting = this.pending.get(sessionId);
    if (waiting) clearTimeout(waiting.timer);
    this.pending.delete(sessionId);
    this.lastSent.delete(sessionId);
  }

  dispose(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.lastSent.clear();
  }
}

// ---------------------------------------------------------------------------
// Mode requests (TASK-417)
// ---------------------------------------------------------------------------

/** At most one mode request per session in this window. */
export const MODE_REQUEST_INTERVAL_MS = 2_000;
/** How long the headset shows a request before it answers `expired`. */
export const MODE_REQUEST_TTL_MS = 10_000;
/** A request the operator never answered is forgotten this long after its TTL. */
export const MODE_REQUEST_GRACE_MS = 5_000;
/** The largest request or answer the relay accepts, serialized, in bytes. */
export const MODE_REQUEST_MAX_BYTES = 512;

/**
 * Only Stand up and Balance are ever relayed (D2): Limp stays a direct,
 * lease-gated desktop action, and walking or zero torque are never offered.
 */
export const RELAYED_MODES = ['stand', 'balance'] as const;
export type RelayedMode = (typeof RELAYED_MODES)[number];
export type ModeRequestOutcome = 'allowed' | 'declined' | 'expired' | 'failed';
export type ModeRequestRejection = 'no_operator' | 'not_assistant' | 'invalid' | 'rate_limited';

const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const modeRequestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  mode: z.enum(RELAYED_MODES),
  requestId,
});

export const modeAnswerSchema = z.object({
  sessionId: z.string().min(1).max(128),
  requestId,
  outcome: z.enum(['allowed', 'declined', 'expired', 'failed']),
  error: z.string().max(160).optional(),
});

export type ModeRequest = z.infer<typeof modeRequestSchema>;
export type ModeAnswer = z.infer<typeof modeAnswerSchema>;

/** Validate a relayed message: at most 512 bytes serialized, then the schema. Null when invalid. */
export function parseModeMessage<T>(schema: z.ZodType<T>, raw: unknown): T | null {
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
  } catch {
    return null;
  }
  if (size > MODE_REQUEST_MAX_BYTES) return null;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

interface PendingModeRequest<S> {
  sessionId: string;
  from: S;
  to: Set<S>;
  forgetAt: number;
}

/**
 * Which assistant asked which operator sockets, so an answer goes back to the
 * asker and nobody else; and the per-session rate limit. Pure: the caller owns
 * the sockets and the clock.
 */
export class ModeRequestLedger<S> {
  private readonly lastAt = new Map<string, number>();
  private readonly pending = new Map<string, PendingModeRequest<S>>();

  constructor(
    private readonly intervalMs: number = MODE_REQUEST_INTERVAL_MS,
    private readonly keepMs: number = MODE_REQUEST_TTL_MS + MODE_REQUEST_GRACE_MS
  ) {}

  /**
   * Record a request about to be relayed to `to`. Refused when the session sent
   * one less than `intervalMs` ago, or when the id is already pending.
   */
  open(sessionId: string, id: string, from: S, to: readonly S[], now: number): { ok: true } | { ok: false; error: 'rate_limited' | 'invalid' } {
    const last = this.lastAt.get(sessionId);
    if (last !== undefined && now - last < this.intervalMs) return { ok: false, error: 'rate_limited' };
    if (this.pending.has(id)) return { ok: false, error: 'invalid' };
    this.lastAt.set(sessionId, now);
    this.pending.set(id, { sessionId, from, to: new Set(to), forgetAt: now + this.keepMs });
    return { ok: true };
  }

  /**
   * The asker of request `id`, when `from` is one of the sockets it went to and
   * the session matches; the request is then closed. Null otherwise.
   */
  answer(sessionId: string, id: string, from: S): S | null {
    const entry = this.pending.get(id);
    if (!entry || entry.sessionId !== sessionId || !entry.to.has(from)) return null;
    this.pending.delete(id);
    return entry.from;
  }

  /** A closed socket: its own requests go, and it no longer answers any. */
  dropSocket(socket: S): void {
    for (const [id, entry] of [...this.pending]) {
      entry.to.delete(socket);
      if (entry.from === socket || entry.to.size === 0) this.pending.delete(id);
    }
  }

  /** Forget requests nobody answered in time, and rate-limit marks long past. */
  sweep(now: number): void {
    for (const [id, entry] of [...this.pending]) if (now >= entry.forgetAt) this.pending.delete(id);
    for (const [sessionId, at] of [...this.lastAt]) if (now - at >= this.intervalMs) this.lastAt.delete(sessionId);
  }

  /** Open requests (tests, diagnostics). */
  size(): number {
    return this.pending.size;
  }
}
