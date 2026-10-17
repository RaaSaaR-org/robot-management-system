/**
 * @file takeLedger.ts
 * @description The take bookkeeping of a recorder that lives in this server
 *              (TASK-408): which take is open, which ones finished, which were
 *              discarded, and why each one stopped. The agent's recorder keeps
 *              the same ledger on the robot (TASK-402); this is its twin for
 *              the SimFrameRecorder and for sessions whose frames a client
 *              posts. Pure — the clock is injected.
 * @feature datacollection
 */

import type { EpisodeStopReason } from '../../types/teleoperation.types.js';

export interface TakeRecord {
  take: number;
  startedAtMs: number;
  endedAtMs: number | null;
  frames: number;
  discarded: boolean;
  stopReason: EpisodeStopReason | null;
}

export type LedgerBegin =
  | { ok: true; take: number; startedAtMs: number }
  | { ok: false; code: 'already_capturing' };

export type LedgerEnd =
  | { ok: true; record: TakeRecord }
  | { ok: false; code: 'not_capturing' };

export interface TakeLedgerOptions {
  /** The number the first `begin()` hands out. Take numbers are never reused. */
  nextTake?: number;
  now?: () => number;
}

export class TakeLedger {
  private readonly now: () => number;
  private nextTake: number;
  private open: TakeRecord | null = null;
  private readonly finished: TakeRecord[] = [];
  private lastStopValue: { take: number; reason: EpisodeStopReason; atMs: number } | null = null;

  constructor(options: TakeLedgerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.nextTake = options.nextTake ?? 0;
  }

  get phase(): 'between' | 'capturing' {
    return this.open ? 'capturing' : 'between';
  }

  /** The open take, or null between takes. */
  current(): TakeRecord | null {
    return this.open;
  }

  /** The open take, else the last one that finished; null before the first. */
  latest(): TakeRecord | null {
    return this.open ?? this.finished[this.finished.length - 1] ?? null;
  }

  /** Every take so far, in order, the open one last. */
  all(): TakeRecord[] {
    return this.open ? [...this.finished, this.open] : [...this.finished];
  }

  get lastStop(): { take: number; reason: EpisodeStopReason; atMs: number } | null {
    return this.lastStopValue;
  }

  /** Finished takes that were kept and have frames. */
  keptCount(): number {
    return this.finished.filter((t) => !t.discarded && t.frames > 0).length;
  }

  discardedCount(): number {
    return this.finished.filter((t) => t.discarded).length;
  }

  begin(): LedgerBegin {
    if (this.open) return { ok: false, code: 'already_capturing' };
    const startedAtMs = this.now();
    this.open = {
      take: this.nextTake++,
      startedAtMs,
      endedAtMs: null,
      frames: 0,
      discarded: false,
      stopReason: null,
    };
    return { ok: true, take: this.open.take, startedAtMs };
  }

  end(reason: EpisodeStopReason = 'operator'): LedgerEnd {
    const record = this.open;
    if (!record) return { ok: false, code: 'not_capturing' };
    const at = this.now();
    record.endedAtMs = at;
    record.stopReason = reason;
    this.finished.push(record);
    this.open = null;
    this.lastStopValue = { take: record.take, reason, atMs: at };
    return { ok: true, record };
  }

  /** Close the open take (reason `next`) and open the next; between takes, just open one. */
  next(): number {
    if (this.open) this.end('next');
    const begun = this.begin();
    // begin() cannot refuse right after end(); the guard keeps the type honest.
    return begun.ok ? begun.take : this.nextTake - 1;
  }

  /** Count one frame into the open take. Ignored between takes. */
  countFrame(): void {
    if (this.open) this.open.frames += 1;
  }

  /**
   * Discard a take. A finished one is marked and stays listed so its number
   * stays taken; the OPEN one is restarted (its frames go, it stays open) —
   * the same rule the agent's recorder applies (TASK-402 D2).
   */
  discard(take: number): TakeRecord | null {
    if (this.open && this.open.take === take) {
      this.open.frames = 0;
      this.open.startedAtMs = this.now();
      return this.open;
    }
    const found = this.finished.find((t) => t.take === take);
    if (!found) return null;
    found.discarded = true;
    found.frames = 0;
    return found;
  }
}
