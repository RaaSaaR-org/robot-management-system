/**
 * @file control-owner.ts
 * @description Exclusive `idle | teleop | vla | agent` control arbitration.
 *              One owner drives the robot at a time; human teleop always wins
 *              and preempts whatever was running.
 * @feature agentmode
 * @status live
 */

import type { ControlOwner } from './types.js';

/** Anything that can actually take the lock (`idle` is the released state). */
export type ActiveControlOwner = Exclude<ControlOwner, 'idle'>;

export interface ClaimResult {
  ok: boolean;
  /** Honest reason when refused, e.g. "VLA control is active". */
  reason?: string;
  /** Owner that was forcibly displaced (teleop preemption only). */
  preempted?: ActiveControlOwner;
}

export interface OwnerChange {
  previous: ControlOwner;
  next: ControlOwner;
  /** True when `next` took the lock from a non-idle `previous` by force. */
  preempted: boolean;
}

const HUMAN_LABELS: Record<ControlOwner, string> = {
  idle: 'nothing',
  teleop: 'human teleoperation',
  vla: 'a VLA skill rollout',
  agent: 'Agent Mode',
};

/**
 * The arbitration rules, in one place:
 *
 * - `teleop` **always** succeeds. A human at the controls outranks every
 *   autonomous owner; the displaced owner is reported back as `preempted` so it
 *   can abort its work (Agent Mode marks the running plan `aborted`).
 * - `agent` succeeds only from `idle` (or when it already holds the lock).
 * - `vla` succeeds only from `idle` (or when it already holds the lock) — in
 *   particular it is refused while Agent Mode owns control.
 *
 * The lock is **refcounted per owner**: an owner can legitimately have more than
 * one holder at a time. Teleop is the real case — four frontend views open
 * `/ws/keyboard-teleop` (keyboard, VR, gamepad, simulated VR) and every socket
 * claims `teleop`. With a single-token lock the *first* socket to close handed
 * control back to `idle` while a human was still streaming joint targets from
 * another one, which let Agent Mode take the lock and drive `loco.move` under
 * the operator's hands. `release()` therefore only frees the owner when its last
 * holder goes away.
 */
export class ControlOwnerLock {
  private owner: ControlOwner = 'idle';
  /** Independent holders of the CURRENT owner; always 0 while `idle`. */
  private holders = 0;
  private listeners = new Set<(change: OwnerChange) => void>();

  get(): ControlOwner {
    return this.owner;
  }

  isOwnedBy(who: ControlOwner): boolean {
    return this.owner === who;
  }

  /** How many holders the current owner has (0 while idle). Mostly for tests. */
  holderCount(): number {
    return this.holders;
  }

  claim(next: ActiveControlOwner): ClaimResult {
    const previous = this.owner;

    // Same owner again: one more holder, no ownership change and no event.
    if (previous === next) {
      this.holders++;
      return { ok: true };
    }

    if (next === 'teleop') {
      // A preempting claim replaces the previous owner's holders wholesale —
      // they no longer own anything to release.
      this.holders = 1;
      this.set(next, previous !== 'idle');
      return previous === 'idle' ? { ok: true } : { ok: true, preempted: previous };
    }

    if (previous !== 'idle') {
      return {
        ok: false,
        reason: `Control is held by ${HUMAN_LABELS[previous]}.`,
      };
    }

    this.holders = 1;
    this.set(next, false);
    return { ok: true };
  }

  /**
   * Drop one holder of `who`. A no-op unless `who` currently owns the lock; the
   * owner only goes back to `idle` once its last holder has released.
   */
  release(who: ActiveControlOwner): void {
    if (this.owner !== who) return;
    this.holders = Math.max(0, this.holders - 1);
    if (this.holders > 0) return;
    this.set('idle', false);
  }

  /** Force back to `idle`, dropping every holder. Used by E-Stop and by tests. */
  reset(): void {
    this.holders = 0;
    if (this.owner === 'idle') return;
    this.set('idle', false);
  }

  subscribe(cb: (change: OwnerChange) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(next: ControlOwner, preempted: boolean): void {
    const previous = this.owner;
    if (previous === next) return;
    this.owner = next;
    const change: OwnerChange = { previous, next, preempted };
    for (const cb of this.listeners) {
      try {
        cb(change);
      } catch (err) {
        console.error('[ControlOwner] listener error:', err);
      }
    }
  }
}

/** Process-wide singleton — the robot has exactly one control lock. */
export const controlOwnerLock = new ControlOwnerLock();
