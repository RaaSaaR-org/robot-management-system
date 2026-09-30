/**
 * @file socket-binding.ts
 * @description Binds one motion WebSocket to the installed control lease and
 *              answers, per frame, whether that socket may still drive
 *              (TASK-315 / TASK-316).
 * @feature robot
 * @status live
 *
 * The contract every motion socket shares:
 *
 *  - The client sends `{bind:{leaseId, generation}}`. The registry `verify`s the
 *    raw secret against the installed, held generation; success binds the
 *    socket to that generation, failure leaves it unbound (`lease_invalid`).
 *  - {@link LeaseSocketBinding.admits} is checked at PROCESSING time for every
 *    motion frame — never cached from an earlier frame — so a fence or expiry
 *    stops forwarding at once, including frames already queued.
 *  - On `fenced` / `expired` of the bound generation the socket is unbound and
 *    `onRevoked` fires. There is no auto-rebind.
 *  - The registry's `bound` count is the number of live bindings to its current
 *    generation, across EVERY socket kind: this class and keyboard teleop's own
 *    binding (TASK-315) both count through {@link adjustBoundCount}, so neither
 *    overwrites the other's count.
 *
 * Enforcement follows the registry's `observe().enforced`
 * (`CONTROL_LEASE_REQUIRED`); with it off every frame is admitted and a bind
 * frame is the caller's to ignore.
 */

import type { ControlLeaseRegistry, LeaseEvent } from './control-lease.js';

export type BindResult =
  | { ok: true; generation: number }
  | { ok: false; code: 'lease_invalid' };

export interface BindRequest {
  leaseId: string;
  generation: number;
}

/** Live bound sockets per registry and generation — the source of its `bound` count. */
const boundCounts = new WeakMap<ControlLeaseRegistry, Map<number, number>>();

/**
 * Add `delta` (+1 on bind, -1 on unbind) to the sockets bound to `generation`
 * and publish the total to the registry. EVERY motion socket kind (keyboard
 * teleop, bilateral) goes through this one counter, so neither overwrites the
 * other's count with its own.
 */
export function adjustBoundCount(leases: ControlLeaseRegistry, generation: number, delta: number): void {
  let counts = boundCounts.get(leases);
  if (!counts) {
    counts = new Map();
    boundCounts.set(leases, counts);
  }
  const n = Math.max(0, (counts.get(generation) ?? 0) + delta);
  if (n === 0) counts.delete(generation);
  else counts.set(generation, n);
  leases.setBoundCount(generation, n);
}

/**
 * Parse `{bind:{leaseId, generation}}` out of an already-JSON-parsed frame.
 * Returns `undefined` when the frame is not a bind frame at all and `null`
 * when it is one but malformed.
 */
export function parseBindFrame(msg: unknown): BindRequest | null | undefined {
  if (!msg || typeof msg !== 'object' || !('bind' in msg)) return undefined;
  const bind = (msg as { bind: unknown }).bind;
  if (!bind || typeof bind !== 'object') return null;
  const { leaseId, generation } = bind as { leaseId?: unknown; generation?: unknown };
  if (typeof leaseId !== 'string' || leaseId.length === 0) return null;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation)) return null;
  return { leaseId, generation };
}

export class LeaseSocketBinding {
  private boundGeneration: number | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly leases: ControlLeaseRegistry,
    private readonly onRevoked: (event: LeaseEvent) => void = () => {},
  ) {
    this.unsubscribe = leases.subscribe((event) => this.onLeaseEvent(event));
  }

  /** Whether `CONTROL_LEASE_REQUIRED` is on (read live, never cached). */
  get enforced(): boolean {
    return this.leases.observe().enforced;
  }

  /** The generation this socket is bound to, or `null`. */
  get generation(): number | null {
    return this.boundGeneration;
  }

  /** Verify the secret and bind; a failure leaves any previous binding untouched. */
  bind(req: BindRequest): BindResult {
    if (!this.leases.verify(req.leaseId, req.generation)) return { ok: false, code: 'lease_invalid' };
    const previous = this.boundGeneration;
    if (previous === req.generation) return { ok: true, generation: req.generation };
    this.boundGeneration = req.generation;
    if (previous !== null) adjustBoundCount(this.leases, previous, -1);
    adjustBoundCount(this.leases, req.generation, +1);
    return { ok: true, generation: req.generation };
  }

  /**
   * May a motion frame be forwarded right now? Always true with enforcement
   * off; otherwise only while the bound generation is the held one.
   */
  admits(): boolean {
    const o = this.leases.observe();
    if (!o.enforced) return true;
    return this.boundGeneration !== null && o.state === 'held' && o.generation === this.boundGeneration;
  }

  /** Socket closed: drop the binding, fix the count, stop listening. */
  dispose(): void {
    this.unsubscribe();
    this.unbind();
  }

  private unbind(): void {
    const generation = this.boundGeneration;
    this.boundGeneration = null;
    if (generation !== null) adjustBoundCount(this.leases, generation, -1);
  }

  private onLeaseEvent(event: LeaseEvent): void {
    if (event.type !== 'fenced' && event.type !== 'expired') return;
    if (this.boundGeneration === null || event.generation !== this.boundGeneration) return;
    this.unbind();
    this.onRevoked(event);
  }
}
