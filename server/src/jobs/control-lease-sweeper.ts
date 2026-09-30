/**
 * @file control-lease-sweeper.ts
 * @description Fences control leases nobody renewed within their TTL
 *              (TASK-318, epic TASK-313): every `renewEveryMs` the rows still
 *              `held` past `expiresAt` are fenced — agent `release`, row →
 *              `expired` (or `unconfirmed` when the agent does not ack).
 * @feature robots
 *
 * Runs on every replica. That is safe: the service claims each row with a
 * conditional update, so exactly one replica fences it. A tick does nothing
 * while `CONTROL_LEASES_ENABLED` is off, and ticks never overlap.
 */

import { controlLeasesEnabled, controlLeaseRenewMs } from '../services/ControlLeaseService.js';

/** The part of `ControlLeaseService` the sweeper drives. */
export interface ControlLeaseSweepTarget {
  sweepExpired(): Promise<number>;
}

export class ControlLeaseSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly target: () => ControlLeaseSweepTarget,
    private readonly enabled: () => boolean = controlLeasesEnabled,
    private readonly intervalMs: () => number = () => controlLeaseRenewMs()
  ) {}

  /** One sweep; returns how many leases this replica fenced. */
  async tick(): Promise<number> {
    if (this.running || !this.enabled()) return 0;
    this.running = true;
    try {
      return await this.target().sweepExpired();
    } catch {
      // Never echo the error (it may come from Prisma); the next tick retries.
      console.error('[ControlLeaseSweeper] sweep failed');
      return 0;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs());
    // Never keeps the process alive on its own.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
