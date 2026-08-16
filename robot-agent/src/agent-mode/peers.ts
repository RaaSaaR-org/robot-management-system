/**
 * @file peers.ts
 * @description Where the OTHER robots are (TASK-207). Polls the server's
 *              `GET /api/robots/:id/peers`, keeps the last pose per peer, drops
 *              every peer whose odometry frame is not ours (and counts it), and
 *              expires a peer that goes quiet — quiet on OUR clock (polls
 *              failing) or on the peer's (a pose the server keeps repeating). Pure state + one fetch; no LLM,
 *              no map writes — the controller reads {@link PeerTracker.obstacles}
 *              into the map's dynamic overlay.
 * @feature agentmode
 * @status live
 */

import type { OdometryFrame } from '../hardware/HardwareClient.js';
import type { DynamicObstacle } from './occupancy-map.js';

/** One other robot, as the server reports it. */
export interface FleetPeer {
  robotId: string;
  name: string;
  x: number;
  y: number;
  /** Degrees, +x = 0, CCW positive; null when the peer never reported one. */
  headingDeg: number | null;
  /** The frame the peer's pose is in; null when the peer does not say. */
  frame: OdometryFrame | null;
  place: string | null;
  zone: string | null;
  /** ISO time the SERVER last saw this pose. */
  updatedAt: string | null;
  /**
   * How old that pose was when the server answered, in ms — measured on the
   * server's clock, so it carries no agent/server skew. Null when the server
   * does not say (older server, or a peer never pose-synced), and then we can
   * only age the peer by our own polling as before.
   */
  poseAgeMs: number | null;
  footprintRadiusM: number;
}

/** A peer we accepted, plus when WE last heard of it. */
export interface TrackedPeer extends FleetPeer {
  seenAtMs: number;
  /**
   * When the peer's pose was taken, translated onto OUR clock at ingest
   * (`now - poseAgeMs`). Null when the server reported no age.
   */
  poseAtMs: number | null;
}

export interface PeerTrackerStatus {
  enabled: boolean;
  /** Our own frame at the last poll, null when we have none (then every peer is dropped). */
  frame: OdometryFrame | null;
  peers: number;
  /** Peers the last poll dropped for being in another frame (or no frame). */
  dropped: number;
  lastPollAt: string | null;
  lastError: string | null;
}

export interface PeerTrackerDeps {
  /** Off: nothing is polled, `list()` is empty, `status().enabled` is false. */
  enabled: boolean;
  serverUrl: string;
  robotId: string;
  /** Poll cadence; ≤ 0 disables. */
  pollMs: number;
  /** Our own odometry frame — the thing a peer must share to be drawn. */
  getFrame: () => OdometryFrame | null;
  /** Added to a peer's footprint radius when it becomes an obstacle (default 0.25 m). */
  marginM?: number;
  /**
   * Silence after which a peer is forgotten (default 3 × pollMs). Silence
   * means EITHER: our polls stopped arriving, or the pose the server keeps
   * handing us stopped advancing. Both mean the same thing — nobody knows
   * where that robot is any more.
   */
  expireMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
  /** Called after every poll that changed the accepted set (added, moved, dropped, expired). */
  onChange?: (peers: TrackedPeer[]) => void;
}

/** Same rule `place-frame.ts` lives by: two frames match on kind AND id, never by assumption. */
export function sameFrame(a: OdometryFrame | null, b: OdometryFrame | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.id === b.id;
}

const DEFAULT_MARGIN_M = 0.25;
const DEFAULT_FOOTPRINT_M = 0.35;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Read one peer off the wire; null when it is not one. Never throws. */
export function parseFleetPeer(raw: unknown): FleetPeer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const robotId = str(o.robotId);
  const x = num(o.x);
  const y = num(o.y);
  if (!robotId || x === null || y === null) return null;
  let frame: OdometryFrame | null = null;
  if (typeof o.frame === 'object' && o.frame !== null) {
    const f = o.frame as Record<string, unknown>;
    const id = str(f.id);
    if ((f.kind === 'sim' || f.kind === 'odom') && id) frame = { kind: f.kind, id };
  }
  return {
    robotId,
    name: str(o.name) ?? robotId,
    x,
    y,
    headingDeg: num(o.headingDeg),
    frame,
    place: str(o.place),
    zone: str(o.zone),
    updatedAt: str(o.updatedAt),
    poseAgeMs: num(o.poseAgeMs),
    footprintRadiusM: num(o.footprintRadiusM) ?? DEFAULT_FOOTPRINT_M,
  };
}

/**
 * The fleet, as seen from one robot. Never throws out of a poll — a peer feed
 * is a passenger on the robot, and a robot that cannot see its peers must keep
 * driving exactly as it did before this file existed.
 */
export class PeerTracker {
  private readonly enabled: boolean;
  private readonly url: string;
  private readonly pollMs: number;
  private readonly getFrame: () => OdometryFrame | null;
  private readonly marginM: number;
  private readonly expireMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly onChange: ((peers: TrackedPeer[]) => void) | null;

  private peers = new Map<string, TrackedPeer>();
  private frame: OdometryFrame | null = null;
  private dropped = 0;
  private lastPollAt: string | null = null;
  private lastError: string | null = null;
  private lastErrorLogMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(deps: PeerTrackerDeps) {
    this.pollMs = Number.isFinite(deps.pollMs) ? deps.pollMs : 0;
    this.enabled = deps.enabled && this.pollMs > 0;
    const base = deps.serverUrl.replace(/\/+$/, '');
    this.url = `${base}/api/robots/${encodeURIComponent(deps.robotId)}/peers`;
    this.getFrame = deps.getFrame;
    this.marginM = deps.marginM ?? DEFAULT_MARGIN_M;
    this.expireMs = deps.expireMs ?? this.pollMs * 3;
    this.timeoutMs = deps.timeoutMs ?? Math.max(500, Math.min(this.pollMs, 3000));
    this.fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? ((m) => console.log(m));
    this.onChange = deps.onChange ?? null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Begin polling. Idempotent; a no-op when disabled. */
  start(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollMs);
    this.timer.unref?.();
    void this.pollOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.peers.clear();
  }

  /** Accepted, unexpired peers — the only ones anyone may draw or avoid. */
  list(): TrackedPeer[] {
    if (!this.enabled) return [];
    this.expire();
    return [...this.peers.values()].map((p) => ({ ...p }));
  }

  /** Peers as discs for the map's dynamic overlay: footprint + margin. */
  obstacles(): DynamicObstacle[] {
    return this.list().map((p) => ({
      x: p.x,
      y: p.y,
      radiusM: p.footprintRadiusM + this.marginM,
      label: `robot ${p.name}`,
    }));
  }

  status(): PeerTrackerStatus {
    return {
      enabled: this.enabled,
      frame: this.frame ? { ...this.frame } : null,
      peers: this.list().length,
      dropped: this.dropped,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
    };
  }

  /**
   * One poll. Public so a test (or a caller that just registered) can drive it
   * without the timer. Resolves after the accepted set is updated; never rejects.
   */
  async pollOnce(): Promise<void> {
    if (!this.enabled || this.inFlight) return;
    this.inFlight = true;
    try {
      const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      const raw =
        typeof body === 'object' && body !== null && Array.isArray((body as { peers?: unknown }).peers)
          ? ((body as { peers: unknown[] }).peers)
          : null;
      if (!raw) throw new Error('malformed peers payload');
      this.ingest(raw.map(parseFleetPeer).filter((p): p is FleetPeer => p !== null));
      this.lastError = null;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.lastError = why;
      const t = this.now();
      if (t - this.lastErrorLogMs > 60_000) {
        this.lastErrorLogMs = t;
        this.log(`[Peers] poll failed: ${why} — keeping the last set until it expires`);
      }
      // A failed poll still ages the set: peers we cannot hear from must go.
      if (this.expire()) this.onChange?.(this.list());
    } finally {
      this.inFlight = false;
    }
  }

  /** Feed a peer list directly (tests, or a future push channel). */
  ingest(peers: readonly FleetPeer[]): void {
    const t = this.now();
    this.lastPollAt = new Date(t).toISOString();
    this.frame = this.getFrame();
    let dropped = 0;
    let changed = false;
    const seen = new Set<string>();
    for (const p of peers) {
      if (!sameFrame(this.frame, p.frame)) {
        dropped++;
        continue;
      }
      seen.add(p.robotId);
      const prev = this.peers.get(p.robotId);
      if (!prev || prev.x !== p.x || prev.y !== p.y || prev.headingDeg !== p.headingDeg || prev.name !== p.name) {
        changed = true;
      }
      this.peers.set(p.robotId, {
        ...p,
        seenAtMs: t,
        // Anchor the server-reported pose age on our clock once, at ingest, so
        // expire() can age it further without parsing timestamps or trusting
        // that our clock agrees with the server's.
        poseAtMs: p.poseAgeMs === null ? null : t - p.poseAgeMs,
      });
    }
    // A peer the server no longer lists (offline, unregistered) leaves now, not
    // after the expiry — the server is authoritative for who exists.
    for (const id of [...this.peers.keys()]) {
      if (!seen.has(id)) {
        this.peers.delete(id);
        changed = true;
      }
    }
    // Age the set here too, not only on a failed poll: a peer whose agent went
    // silent is still LISTED by the server (its `isConnected` only flips on the
    // 30 s health check) at a frozen pose, so nothing above marks it changed
    // and it would sit in the map's dynamic overlay as a phantom obstacle,
    // blocking the planner over floor the robot has long left.
    if (this.expire()) changed = true;
    if (dropped !== this.dropped) changed = true;
    this.dropped = dropped;
    if (changed) this.onChange?.(this.list());
  }

  /**
   * Forget peers silent for longer than `expireMs` — on either clock: OUR
   * polls (`seenAtMs`) and the PEER's pose (`poseAtMs`). The second is the one
   * that matters when the network drops on the far side: our polls keep
   * succeeding, the server keeps listing the peer, and only the age of the
   * pose it carries reveals that nobody has heard from that robot in a while.
   * A peer whose age the server does not report keeps the old poll-only
   * behaviour rather than being dropped for a missing field.
   */
  private expire(): boolean {
    if (this.expireMs <= 0) return false;
    const t = this.now();
    let removed = false;
    for (const [id, p] of this.peers) {
      const poseStale = p.poseAtMs !== null && t - p.poseAtMs > this.expireMs;
      if (t - p.seenAtMs > this.expireMs || poseStale) {
        this.peers.delete(id);
        removed = true;
      }
    }
    return removed;
  }
}
