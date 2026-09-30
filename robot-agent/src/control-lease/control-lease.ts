/**
 * @file control-lease.ts
 * @description The robot's one installed control lease: a fenced, generation-
 *              numbered, locally-expiring grant of motion authority (TASK-314).
 * @feature robot
 * @status live
 *
 * The server decides WHO may drive the robot and hands this agent a lease; the
 * agent is the one place that can say, at the instant a velocity arrives,
 * whether that lease is still the current one. Three rules make it safe:
 *
 *  1. **Fencing by generation.** Every install carries a strictly increasing
 *     generation. Anything at or below the high-water mark is refused, so a
 *     delayed install, renew or release from an older grant can never undo a
 *     newer one.
 *  2. **The high-water survives restarts.** It is persisted (atomically) BEFORE
 *     an install returns ok. The installed lease itself is NOT persisted: a
 *     restart kills all authority, and the old generation stays unusable.
 *     An unreadable high-water file fails closed — every install is refused
 *     until an operator repairs it, because guessing 0 would re-open every
 *     generation ever issued.
 *  3. **Expiry on the agent's own clock.** The deadline is `performance.now()`
 *     based, so wall-clock jumps and server clock skew cannot extend it. A late
 *     renew never resurrects an expired lease.
 *
 * The registry emits events; it never moves hardware itself.
 * {@link wireControlLeaseStops} turns `fenced`/`expired` into a zero-velocity
 * stop — `index.ts` calls it with the real hardware client.
 *
 * The registry itself never refuses motion. With `CONTROL_LEASE_REQUIRED` on,
 * its consumers do: `motion-guard.ts` refuses REST motion starts while a lease
 * is held, and `socket-binding.ts` admits a motion socket's frames only while it
 * is bound to the held generation (TASK-316). Flag off: nothing consults it.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync } from '../utils/atomic-file.js';
import { config } from '../config/config.js';

export type LeaseState = 'held' | 'expired' | 'released';

export interface InstalledLease {
  /** Strictly increasing across the robot's lifetime. */
  generation: number;
  /** sha256 hex of the client's raw leaseId — the raw secret never lands here. */
  leaseIdHash: string;
  sessionId: string;
  userId: string;
  displayName: string;
  tenantId: string | null;
  /** `now()`-based deadline, local clock only. */
  deadline: number;
  state: LeaseState;
}

export interface InstallRequest {
  generation: number;
  leaseIdHash: string;
  sessionId: string;
  userId: string;
  displayName: string;
  tenantId: string | null;
  ttlMs: number;
}

export type InstallResult =
  | { ok: true; generation: number; fencedGeneration: number | null }
  | { ok: false; code: 'stale_generation'; highWater: number }
  | { ok: false; code: 'high_water_unreadable' }
  | { ok: false; code: 'high_water_unwritable' };

export type RenewResult =
  | { ok: true; bound: number }
  | { ok: false; code: 'not_installed' | 'expired' };

export interface ReleaseResult {
  ok: true;
  released: boolean;
}

export interface LeaseObservation {
  enforced: boolean;
  state: 'none' | LeaseState;
  generation: number | null;
  userId: string | null;
  displayName: string | null;
  sessionId: string | null;
  expiresInMs: number | null;
  bound: number;
  error?: 'high_water_unreadable';
}

export type LeaseEventType = 'installed' | 'renewed' | 'fenced' | 'expired';

export interface LeaseEvent {
  type: LeaseEventType;
  generation: number;
}

export type LeaseListener = (event: LeaseEvent) => void;

export interface ControlLeaseRegistryDeps {
  robotId: string;
  /** Override for the high-water file (tests use a temp dir). */
  filePath?: string;
  /** Monotonic clock in ms. Defaults to `performance.now()`. */
  now?: () => number;
  /** Whether `CONTROL_LEASE_REQUIRED` is on — only reported, never enforced here. */
  enforced?: () => boolean;
}

interface HighWaterFile {
  robotId: string;
  highWater: number;
  updatedAt: string;
}

/** Default path of the high-water file, resolved like `incarnations.ts` does. */
export function defaultControlLeaseFile(robotId: string): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    `../../data/control-lease-${robotId}.json`,
  );
}

/** sha256 hex of a raw lease id — the only form the registry ever compares. */
export function hashLeaseId(rawLeaseId: string): string {
  return crypto.createHash('sha256').update(rawLeaseId, 'utf8').digest('hex');
}

export class ControlLeaseRegistry {
  private readonly filePath: string;
  private readonly robotId: string;
  private readonly now: () => number;
  private readonly enforced: () => boolean;
  private highWater = 0;
  private highWaterError: 'high_water_unreadable' | null = null;
  private lease: InstalledLease | null = null;
  private boundCount = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<LeaseListener>();

  constructor(deps: ControlLeaseRegistryDeps) {
    this.robotId = deps.robotId;
    this.filePath = deps.filePath ?? defaultControlLeaseFile(deps.robotId);
    this.now = deps.now ?? (() => performance.now());
    this.enforced = deps.enforced ?? (() => false);
    this.loadHighWater();
  }

  /** The persisted high-water generation (0 when none was ever issued). */
  get highWaterMark(): number {
    return this.highWater;
  }

  install(req: InstallRequest): InstallResult {
    if (this.highWaterError) return { ok: false, code: this.highWaterError };
    if (req.generation <= this.highWater) {
      return { ok: false, code: 'stale_generation', highWater: this.highWater };
    }

    // Persist first: an install that returned ok must never be re-issuable
    // after a crash, and a failed write must leave the old lease in charge.
    try {
      this.persistHighWater(req.generation);
    } catch (err) {
      console.error(
        `[ControlLease] could not persist high-water ${req.generation} to ${this.filePath}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
      return { ok: false, code: 'high_water_unwritable' };
    }
    this.highWater = req.generation;

    const previous = this.lease;
    const fencedGeneration = previous ? previous.generation : null;
    if (previous) this.transitionToReleased(previous);

    this.lease = {
      generation: req.generation,
      leaseIdHash: req.leaseIdHash.toLowerCase(),
      sessionId: req.sessionId,
      userId: req.userId,
      displayName: req.displayName,
      tenantId: req.tenantId,
      deadline: this.now() + req.ttlMs,
      state: 'held',
    };
    this.boundCount = 0;
    this.scheduleExpiry();
    console.log(
      `[ControlLease] installed generation ${req.generation} for user ${req.userId}` +
        (fencedGeneration !== null ? ` (fenced ${fencedGeneration})` : ''),
    );
    this.emit({ type: 'installed', generation: req.generation });
    return { ok: true, generation: req.generation, fencedGeneration };
  }

  renew(req: { generation: number; ttlMs: number }): RenewResult {
    this.checkExpiry();
    const lease = this.lease;
    if (!lease || lease.generation !== req.generation || lease.state === 'released') {
      return { ok: false, code: 'not_installed' };
    }
    if (lease.state === 'expired') return { ok: false, code: 'expired' };
    lease.deadline = this.now() + req.ttlMs;
    this.scheduleExpiry();
    this.emit({ type: 'renewed', generation: lease.generation });
    return { ok: true, bound: this.bound() };
  }

  release(req: { generation: number }): ReleaseResult {
    const lease = this.lease;
    if (!lease || lease.generation !== req.generation || lease.state === 'released') {
      return { ok: true, released: false };
    }
    this.transitionToReleased(lease);
    console.log(`[ControlLease] released generation ${lease.generation}`);
    return { ok: true, released: true };
  }

  /** True only for the installed, held, unexpired generation with a matching secret. */
  verify(rawLeaseId: string, generation: number): boolean {
    this.checkExpiry();
    const lease = this.lease;
    if (!lease || lease.state !== 'held' || lease.generation !== generation) return false;
    if (typeof rawLeaseId !== 'string') return false;
    const presented = Buffer.from(hashLeaseId(rawLeaseId), 'hex');
    const expected = Buffer.from(lease.leaseIdHash, 'hex');
    if (presented.length !== expected.length) return false;
    return crypto.timingSafeEqual(presented, expected);
  }

  /** The teleop socket (TASK-315) reports how many live sockets hold `generation`. */
  setBoundCount(generation: number, n: number): void {
    if (!this.lease || this.lease.generation !== generation) return;
    this.boundCount = Math.max(0, Math.floor(n));
  }

  bound(): number {
    return this.lease ? this.boundCount : 0;
  }

  /** Everything a UI may see — never the hash. */
  observe(): LeaseObservation {
    this.checkExpiry();
    const lease = this.lease;
    const base: LeaseObservation = {
      enforced: this.enforced(),
      state: lease ? lease.state : 'none',
      generation: lease ? lease.generation : null,
      userId: lease ? lease.userId : null,
      displayName: lease ? lease.displayName : null,
      sessionId: lease ? lease.sessionId : null,
      expiresInMs: lease && lease.state === 'held' ? Math.max(0, Math.round(lease.deadline - this.now())) : null,
      bound: this.bound(),
    };
    if (this.highWaterError) {
      base.state = 'none';
      base.error = this.highWaterError;
    }
    return base;
  }

  subscribe(cb: LeaseListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Stop the expiry timer (tests, shutdown). */
  dispose(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------

  private transitionToReleased(lease: InstalledLease): void {
    if (lease.state === 'released') return;
    const wasHeld = lease.state === 'held';
    lease.state = 'released';
    this.boundCount = 0;
    this.clearTimer();
    // `fenced` means live authority was revoked. An expired lease already
    // emitted `expired` (and got its stop); replacing or releasing it again
    // must not send a second stop into a successor's first commands.
    if (wasHeld) this.emit({ type: 'fenced', generation: lease.generation });
  }

  /** Flip a held lease past its deadline to `expired` — timer or lazy check. */
  private checkExpiry(): void {
    const lease = this.lease;
    if (!lease || lease.state !== 'held') return;
    if (this.now() < lease.deadline) return;
    lease.state = 'expired';
    this.boundCount = 0;
    this.clearTimer();
    console.log(`[ControlLease] generation ${lease.generation} expired`);
    this.emit({ type: 'expired', generation: lease.generation });
  }

  private scheduleExpiry(): void {
    this.clearTimer();
    const lease = this.lease;
    if (!lease || lease.state !== 'held') return;
    const delay = Math.max(0, lease.deadline - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.checkExpiry();
      // A timer that fired early (clock granularity) must not leave the lease
      // held forever: re-arm for the remainder.
      if (this.lease && this.lease.state === 'held') this.scheduleExpiry();
    }, delay);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(event: LeaseEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch (err) {
        console.error('[ControlLease] listener threw:', err);
      }
    }
  }

  private loadHighWater(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.highWater = 0;
        return;
      }
      this.failClosed(err);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<HighWaterFile>;
      const hw = parsed?.highWater;
      if (typeof hw !== 'number' || !Number.isSafeInteger(hw) || hw < 0) {
        throw new Error('highWater is not a non-negative safe integer');
      }
      this.highWater = hw;
    } catch (err) {
      this.failClosed(err);
    }
  }

  private failClosed(err: unknown): void {
    this.highWaterError = 'high_water_unreadable';
    console.error(
      `[ControlLease] high-water file ${this.filePath} is unreadable ` +
        `(${err instanceof Error ? err.message : String(err)}). Every lease install is refused ` +
        'until an operator repairs or removes it.',
    );
  }

  private persistHighWater(generation: number): void {
    const body: HighWaterFile = {
      robotId: this.robotId,
      highWater: generation,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteFileSync(this.filePath, `${JSON.stringify(body, null, 2)}\n`);
  }
}

/** Minimal slice of the hardware client the stop wiring needs. */
export interface LocoStopClient {
  locoMove(vx: number, vy: number, omega: number, ttlS: number): Promise<unknown>;
}

/**
 * On `fenced` and `expired`, send ONE zero-TTL stop — the same call
 * `keyboard-teleop.ts` makes on socket close. Returns the unsubscribe.
 */
export function wireControlLeaseStops(registry: ControlLeaseRegistry, client: LocoStopClient): () => void {
  return registry.subscribe((event) => {
    if (event.type !== 'fenced' && event.type !== 'expired') return;
    const fail = (err: unknown): void => {
      console.error(
        `[ControlLease] zero stop after ${event.type} of generation ${event.generation} failed:`,
        err,
      );
    };
    try {
      void client.locoMove(0, 0, 0, 0).catch(fail);
    } catch (err) {
      fail(err);
    }
  });
}

/**
 * The process singleton. Construction only READS the high-water file (a
 * missing one is generation 0); nothing is written until the first install.
 */
export const controlLease = new ControlLeaseRegistry({
  robotId: config.robotId,
  enforced: () => config.controlLease.required,
});
