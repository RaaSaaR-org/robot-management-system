/**
 * @file action-buffer.ts
 * @description Thread-safe circular buffer for VLA action queue management
 * @feature vla
 */

import { EventEmitter } from 'events';
import { Mutex } from 'async-mutex';
import type { Action, ActionBufferConfig, BufferLevel, ActionBufferEvent } from './types.js';

const DEFAULT_CONFIG: ActionBufferConfig = {
  capacity: 16, // 320ms at 50Hz
  lowThreshold: 0.25,
  prefetchThreshold: 0.5,
};

/**
 * Thread-safe circular buffer for storing VLA actions.
 * Provides buffering for network latency tolerance at 50Hz control rate.
 *
 * @example
 * ```typescript
 * const buffer = new ActionBuffer({ capacity: 16 });
 *
 * buffer.on('buffer:low', () => {
 *   // Trigger prefetch for more actions
 * });
 *
 * // Push actions from inference response
 * buffer.push(actionChunk.actions);
 *
 * // Pop actions in control loop
 * const action = await buffer.pop();
 * ```
 */
export class ActionBuffer extends EventEmitter {
  private buffer: Action[];
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  private readonly config: ActionBufferConfig;
  private readonly mutex: Mutex;

  // Metrics
  private underrunCount: number = 0;
  private refillCount: number = 0;
  private lastLevel: BufferLevel = 'empty';
  private prefetchRequested: boolean = false;

  constructor(config: Partial<ActionBufferConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.buffer = new Array(this.config.capacity);
    this.mutex = new Mutex();
  }

  /**
   * Push multiple actions to the buffer.
   * Actions are added in order, oldest first.
   * @param actions Actions to add to the buffer
   * @returns Number of actions actually added (may be less if buffer full)
   */
  async push(actions: Action[]): Promise<number> {
    return await this.mutex.runExclusive(() => {
      let added = 0;

      for (const action of actions) {
        if (this.count >= this.config.capacity) {
          // Buffer full, emit event on first overflow
          if (added === 0) {
            this.emit('buffer:full' as ActionBufferEvent);
          }
          break;
        }

        this.buffer[this.tail] = action;
        this.tail = (this.tail + 1) % this.config.capacity;
        this.count++;
        added++;
      }

      if (added > 0) {
        this.refillCount++;
        this.prefetchRequested = false;
        this.emit('buffer:refill' as ActionBufferEvent, { added, count: this.count });
      }

      this.checkAndEmitLevelChange();

      return added;
    });
  }

  /**
   * Pop the next action from the buffer.
   * @returns The next action, or null if buffer is empty
   */
  async pop(): Promise<Action | null> {
    return await this.mutex.runExclusive(() => {
      if (this.count === 0) {
        this.underrunCount++;
        this.emit('buffer:empty' as ActionBufferEvent);
        return null;
      }

      const action = this.buffer[this.head];
      this.head = (this.head + 1) % this.config.capacity;
      this.count--;

      this.checkAndEmitLevelChange();

      return action;
    });
  }

  /**
   * Peek at the next action without removing it.
   * @returns The next action, or null if buffer is empty
   */
  async peek(): Promise<Action | null> {
    return await this.mutex.runExclusive(() => {
      if (this.count === 0) {
        return null;
      }
      return this.buffer[this.head];
    });
  }

  /**
   * Peek at multiple upcoming actions without removing them.
   * @param count Number of actions to peek
   * @returns Array of upcoming actions
   */
  async peekMany(count: number): Promise<Action[]> {
    return await this.mutex.runExclusive(() => {
      const result: Action[] = [];
      const toRead = Math.min(count, this.count);

      for (let i = 0; i < toRead; i++) {
        const idx = (this.head + i) % this.config.capacity;
        result.push(this.buffer[idx]);
      }

      return result;
    });
  }

  /**
   * Clear all actions from the buffer.
   */
  async clear(): Promise<void> {
    await this.mutex.runExclusive(() => {
      this.head = 0;
      this.tail = 0;
      this.count = 0;
      this.prefetchRequested = false;
      this.checkAndEmitLevelChange();
    });
  }

  /**
   * Get the current buffer fill level.
   */
  getLevel(): BufferLevel {
    const fillRatio = this.count / this.config.capacity;

    if (this.count === 0) return 'empty';
    if (fillRatio < this.config.lowThreshold) return 'low';
    if (this.count >= this.config.capacity) return 'full';
    return 'normal';
  }

  /**
   * Get the current number of actions in the buffer.
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Get the buffer capacity.
   */
  getCapacity(): number {
    return this.config.capacity;
  }

  /**
   * Get the fill ratio (0.0 - 1.0).
   */
  getFillRatio(): number {
    return this.count / this.config.capacity;
  }

  /**
   * Check if the buffer needs a prefetch (below prefetch threshold).
   */
  needsPrefetch(): boolean {
    return (
      !this.prefetchRequested &&
      this.count / this.config.capacity < this.config.prefetchThreshold
    );
  }

  /**
   * Mark that a prefetch has been requested.
   * Prevents duplicate prefetch requests.
   */
  markPrefetchRequested(): void {
    this.prefetchRequested = true;
  }

  /**
   * Check if a prefetch is currently in flight.
   */
  isPrefetchInFlight(): boolean {
    return this.prefetchRequested;
  }

  /**
   * Get the total number of underrun events.
   */
  getUnderrunCount(): number {
    return this.underrunCount;
  }

  /**
   * Get the total number of refill events.
   */
  getRefillCount(): number {
    return this.refillCount;
  }

  /**
   * Reset metrics counters.
   */
  resetMetrics(): void {
    this.underrunCount = 0;
    this.refillCount = 0;
  }

  /**
   * Get buffer statistics.
   */
  getStats(): {
    count: number;
    capacity: number;
    fillRatio: number;
    level: BufferLevel;
    underrunCount: number;
    refillCount: number;
    prefetchInFlight: boolean;
  } {
    return {
      count: this.count,
      capacity: this.config.capacity,
      fillRatio: this.getFillRatio(),
      level: this.getLevel(),
      underrunCount: this.underrunCount,
      refillCount: this.refillCount,
      prefetchInFlight: this.prefetchRequested,
    };
  }

  /**
   * Check for level changes and emit appropriate events.
   */
  private checkAndEmitLevelChange(): void {
    const newLevel = this.getLevel();

    if (newLevel !== this.lastLevel) {
      // Emit low warning when transitioning to low
      if (newLevel === 'low' && this.lastLevel !== 'empty') {
        this.emit('buffer:low' as ActionBufferEvent, { count: this.count });
      }

      this.lastLevel = newLevel;
    }

    // Always check for prefetch trigger
    if (this.needsPrefetch()) {
      this.emit('buffer:low' as ActionBufferEvent, { count: this.count, needsPrefetch: true });
    }
  }
}
