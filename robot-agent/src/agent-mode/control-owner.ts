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
  /**
   * True for the two edges of a {@link ControlOwnerLock.lend} — `previous`
   * handed the lock to `next` for one nested operation and will take it back,
   * or is taking it back now.
   *
   * A subscriber that reacts to "somebody ELSE is driving now" must skip these:
   * nothing changed about who is in charge, only about which of that owner's
   * own subsystems is holding the wheel. See the scene-memory wipe in
   * `agent-mode-controller.ts`, which must not fire when Agent Mode lends the
   * lock to its own VLA rollout (TASK-226).
   */
  handover: boolean;
}

/**
 * A lock lent to a nested owner by {@link ControlOwnerLock.lend}.
 *
 * `end()` is the ONLY way back and is safe to call from a `finally` on every
 * path — success, throw, timeout and abort — which is the whole reason this
 * exists rather than a release/claim pair at the call site.
 */
export interface LendResult {
  ok: boolean;
  /** Honest reason when refused. */
  reason?: string;
  /** True while the borrower still owns the lock. */
  held(): boolean;
  /**
   * Give the lock back to whoever lent it. Idempotent, and a NO-OP once
   * something else has taken the lock: a teleop preemption during the nested
   * operation must not be undone by that operation finishing.
   */
  end(): void;
}

/** A refused lend — nothing was taken, so `end()` has nothing to give back. */
function lendRefused(reason: string): LendResult {
  return { ok: false, reason, held: () => false, end: () => {} };
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
   * Lend the lock to `next` for ONE nested operation, then take it back.
   *
   * The refcounted {@link claim} cannot express this. Agent Mode holds `agent`
   * for the whole life of a plan, so `claim('vla')` from inside a `vla_skill`
   * block is refused ("Control is held by Agent Mode"), and releasing `agent`
   * first would open a window in which a third party could take control out
   * from under a running plan. So the lender's holders are PARKED and restored
   * by `end()`, and the lock never passes through `idle`.
   *
   * Refused for exactly the same reasons {@link claim} is: a lend to anything
   * but `teleop` needs the lock to be idle or already held by somebody, and a
   * borrower cannot take it from an owner that outranks the rule. In practice
   * the only refusal is "somebody else is already borrowing".
   *
   * Ending a lend is idempotent and gives up quietly when the lock has moved
   * on — see {@link LendResult.end}.
   */
  lend(next: ActiveControlOwner): LendResult {
    const lender = this.owner;

    // Nothing to park: this is a plain claim with a `finally`-safe release.
    if (lender === 'idle' || lender === next) {
      const claim = this.claim(next);
      if (!claim.ok) return lendRefused(claim.reason ?? 'control is busy.');
      let done = false;
      return {
        ok: true,
        held: () => !done && this.owner === next,
        end: () => {
          if (done) return;
          done = true;
          this.release(next);
        },
      };
    }

    const parkedHolders = this.holders;
    this.holders = 1;
    this.set(next, false, true);

    let done = false;
    return {
      ok: true,
      held: () => !done && this.owner === next,
      end: () => {
        if (done) return;
        done = true;
        // Somebody preempted the borrower (teleop), or an E-Stop `reset()` came
        // through. The lender no longer owns anything to be given back, and
        // forcing it back here would hand a plan the lock a human just took.
        if (this.owner !== next) return;
        this.holders = parkedHolders;
        this.set(lender, false, true);
      },
    };
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

  private set(next: ControlOwner, preempted: boolean, handover = false): void {
    const previous = this.owner;
    if (previous === next) return;
    this.owner = next;
    const change: OwnerChange = { previous, next, preempted, handover };
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
