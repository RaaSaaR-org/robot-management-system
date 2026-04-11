/**
 * @file StatePersistence.ts
 * @description Debounced JSON state persistence for robot agent
 * @feature robot
 * @status live
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SimulatedRobotState, PushedTask } from './types.js';

// ============================================================================
// PERSISTED STATE INTERFACE
// ============================================================================

/** Schema version for future migration support */
const CURRENT_VERSION = 1;

/** Serialisable snapshot written to disk */
export interface PersistedState {
  /** Schema version — bump when the shape changes */
  version: number;
  /** ISO-8601 timestamp of last save */
  savedAt: string;
  /** Subset of SimulatedRobotState worth persisting across restarts */
  robotState: {
    status: SimulatedRobotState['status'];
    batteryLevel: number;
    location: SimulatedRobotState['location'];
    heldObject?: string;
    speed: number;
    errors: string[];
    warnings: string[];
  };
  /** Queued tasks (serialised) */
  taskQueue: PushedTask[];
}

// ============================================================================
// STATE PERSISTENCE
// ============================================================================

const DEBOUNCE_MS = 500;

/**
 * Handles reading / writing robot state to a JSON file with debounced writes
 * and synchronous shutdown writes.
 */
export class StatePersistence {
  private readonly filePath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: PersistedState | null = null;

  constructor(filePath?: string) {
    this.filePath =
      filePath ??
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../data/state.json',
      );
  }

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  /**
   * Schedule a debounced write. Multiple rapid calls collapse into one write.
   */
  save(state: PersistedState): void {
    this.pendingState = state;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, DEBOUNCE_MS);
  }

  /**
   * Synchronous write — use during SIGTERM / SIGINT shutdown.
   * Writes whatever is pending, or the explicitly provided state.
   */
  saveSync(state?: PersistedState): void {
    const toWrite = state ?? this.pendingState;
    if (!toWrite) return;

    // Cancel any pending debounce
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    try {
      this.ensureDir();
      fs.writeFileSync(this.filePath, JSON.stringify(toWrite, null, 2), 'utf-8');
    } catch (err) {
      console.error('[StatePersistence] Sync write failed:', err);
    }
  }

  /**
   * Load persisted state from disk.
   * Returns `null` when the file is missing, corrupt, or has an unknown version.
   */
  load(): PersistedState | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data: unknown = JSON.parse(raw);

      if (!this.isValidPersistedState(data)) {
        console.warn('[StatePersistence] Invalid or unrecognised state file — ignoring');
        return null;
      }

      console.log(`[StatePersistence] Loaded state from ${this.filePath} (saved ${data.savedAt})`);
      return data;
    } catch (err) {
      console.warn('[StatePersistence] Failed to load state file — starting fresh:', err);
      return null;
    }
  }

  /**
   * Delete the persisted state file.
   */
  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
        console.log('[StatePersistence] State file cleared');
      }
    } catch (err) {
      console.error('[StatePersistence] Failed to clear state file:', err);
    }
  }

  // --------------------------------------------------------------------------
  // INTERNAL
  // --------------------------------------------------------------------------

  /** Flush pending state to disk (async-safe, non-blocking) */
  private flush(): void {
    if (!this.pendingState) return;

    try {
      this.ensureDir();
      fs.writeFileSync(this.filePath, JSON.stringify(this.pendingState, null, 2), 'utf-8');
    } catch (err) {
      console.error('[StatePersistence] Write failed:', err);
    }

    this.pendingState = null;
  }

  /** Ensure the parent directory exists */
  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** Runtime type guard for loaded JSON */
  private isValidPersistedState(data: unknown): data is PersistedState {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;

    if (obj.version !== CURRENT_VERSION) return false;
    if (typeof obj.savedAt !== 'string') return false;
    if (typeof obj.robotState !== 'object' || obj.robotState === null) return false;
    if (!Array.isArray(obj.taskQueue)) return false;

    return true;
  }
}
