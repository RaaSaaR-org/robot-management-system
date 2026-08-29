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
 * Who may hand the wheel to whom, by NAME. A lend parks a live owner's holders
 * and gives its lock to somebody else, so the pairing has to be one where the
 * borrower is genuinely a subsystem of the lender: Agent Mode runs a learned
 * policy inside a `vla_skill` block, and that is the entire list.
 *
 * Absence is a REFUSAL, deliberately. Without this table `lend` parked and
 * reassigned unconditionally, so `lend('vla')` while a human held `teleop`
 * returned ok and took the lock out of the operator's hands — and because the
 * lend edges are flagged `handover`, not `preempted`, the takeover hook in
 * `agent-mode-controller.ts` did not fire and nothing aborted. That is the one
 * thing this whole module exists to make impossible, so the check is stated as
 * a list of what is allowed rather than a list of what is not.
 *
 * A lend from `idle`, or to the owner that already holds the lock, never
 * reaches this table: nothing is being taken from anybody there, and `claim`
 * already decides those two cases.
 */
const LENDABLE_TO: Partial<Record<ControlOwner, ReadonlySet<ActiveControlOwner>>> = {
  agent: new Set<ActiveControlOwner>(['vla']),
};

/**
 * A loan created by {@link ControlOwnerLock.lend}: the borrower currently owns
 * the lock, the lender's holders are parked, and `id` tells one loan from the
 * next so a stale `end()` cannot cancel somebody else's.
 */
interface Loan {
  id: number;
  borrower: ActiveControlOwner;
  lender: ControlOwner;
}

/**
 * The arbitration rules, in one place:
 *
 * - `teleop` **always** succeeds. A human at the controls outranks every
 *   autonomous owner; the displaced owner is reported back as `preempted` so it
 *   can abort its work (Agent Mode marks the running plan `aborted`).
 * - `agent` succeeds only from `idle` (or when it already holds the lock).
 * - `vla` succeeds only from `idle` (or when it already holds the lock) — in
 *   particular it is refused while Agent Mode owns control.
 * - a lock that is out on loan ({@link ControlOwnerLock.lend}) is EXCLUSIVE to
 *   its borrower: "it already holds the lock" stops being a reason to admit
 *   anybody, because the borrower is one nested operation and not a party that
 *   can share. Teleop is the exception it always is.
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
  /** The outstanding {@link lend}, or null. See {@link claim} for what it buys. */
  private loan: Loan | null = null;
  private loanSeq = 0;
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

  /** True while a {@link lend} is outstanding. Mostly for tests. */
  isLent(): boolean {
    return this.loan !== null;
  }

  claim(next: ActiveControlOwner): ClaimResult {
    const previous = this.owner;

    // Same owner again: one more holder, no ownership change and no event.
    if (previous === next) {
      // …unless the lock is LENT. A loan is exclusive to its borrower, and this
      // is the one place where "same owner" is not the harmless case it looks
      // like: while Agent Mode has lent the lock to its own `vla_skill`
      // rollout the owner reads `vla`, so an external `POST /vla/start` or
      // `/skills/execute` took this branch, incremented the refcount and was
      // ADMITTED — two SkillExecutors streaming action vectors into the same
      // 43-DOF humanoid at once. Before `lend` existed the same call was
      // refused with "Control is held by Agent Mode", so the loan must not be
      // allowed to turn an exclusive lock into a shared one in exactly the
      // window where sharing is most dangerous. (`RobotStateManager`'s own
      // `vlaActiveLocal` guard does not cover this: it is set only by the
      // direct path, never by the agent one.)
      //
      // Teleop is exempt, and stays exempt: a second `/ws/keyboard-teleop`
      // socket is a human's other window, never a competing driver, and the
      // refcount exists precisely so that both may hold at once.
      if (this.loan && next !== 'teleop') {
        return { ok: false, reason: this.loanBusyReason(this.loan) };
      }
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
   * Refused for the reasons {@link claim} is, and for one of its own:
   *
   * - taking the lock from a live owner is allowed only for the pairings in
   *   {@link LENDABLE_TO} — in practice only `agent` → `vla`. A lend is a
   *   delegation, so the borrower has to be something the lender actually runs
   *   inside itself; anything else is a takeover wearing a handover's clothes,
   *   and a human at the sticks is never lent past.
   * - a lock that is already lent out is exclusive to its borrower, so a
   *   second lend of the same owner is refused rather than counted.
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
      const loan: Loan = { id: ++this.loanSeq, borrower: next, lender };
      this.loan = loan;
      let done = false;
      return {
        ok: true,
        held: () => !done && this.owner === next,
        end: () => {
          if (done) return;
          done = true;
          if (this.loan?.id === loan.id) this.loan = null;
          this.release(next);
        },
      };
    }

    // The rank rule. `lender` is a live owner here, and only the pairings in
    // LENDABLE_TO may park one — see that table for the teleop takeover this
    // refusal is really about.
    if (!LENDABLE_TO[lender]?.has(next)) {
      return lendRefused(`Control is held by ${HUMAN_LABELS[lender]}.`);
    }

    const parkedHolders = this.holders;
    const loan: Loan = { id: ++this.loanSeq, borrower: next, lender };
    this.holders = 1;
    this.set(next, false, true);
    this.loan = loan;

    let done = false;
    return {
      ok: true,
      held: () => !done && this.owner === next,
      end: () => {
        if (done) return;
        done = true;
        // Somebody preempted the borrower (teleop), or an E-Stop `reset()` came
        // through. Both clear the loan on their way past, and the lender no
        // longer owns anything to be given back: forcing it back here would
        // hand a plan the lock a human just took, or undo an E-Stop.
        if (this.owner !== next || this.loan?.id !== loan.id) return;
        this.loan = null;
        this.holders = parkedHolders;
        this.set(lender, false, true);
      },
    };
  }

  /**
   * What a caller is told when it asks for a lock that is out on loan. Named
   * for what is actually true: the borrower is driving, and somebody else is
   * waiting to have it back.
   */
  private loanBusyReason(loan: Loan): string {
    return loan.lender === 'idle' || loan.lender === loan.borrower
      ? `Control is held by ${HUMAN_LABELS[loan.borrower]}.`
      : `Control is held by ${HUMAN_LABELS[loan.borrower]}, lent out by ${HUMAN_LABELS[loan.lender]}.`;
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

  /**
   * Force back to `idle`, dropping every holder. Used by E-Stop and by tests.
   *
   * The loan goes with them: an E-Stop that landed mid-rollout must leave
   * nothing behind that a late `LendResult.end()` could restore, and `end()`
   * checks the loan it was given before it hands anything back.
   */
  reset(): void {
    this.holders = 0;
    this.loan = null;
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
    // Any ownership change that is NOT one of a lend's own two edges ends the
    // loan — a teleop preemption, a release to idle, a reset. Leaving it set
    // would make the human's second `/ws/keyboard-teleop` socket look like a
    // second borrower and get it refused.
    if (!handover) this.loan = null;
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
