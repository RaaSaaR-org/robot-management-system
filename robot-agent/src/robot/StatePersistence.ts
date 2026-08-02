/**
 * @file StatePersistence.ts
 * @description Debounced JSON state persistence for robot agent
 * @feature robot
 * @status live
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync } from '../utils/atomic-file.js';
import type { SimulatedRobotState, PushedTask } from './types.js';

// ============================================================================
// PERSISTED STATE INTERFACE
// ============================================================================

/**
 * Schema version of the state file. EXPORTED on purpose: `buildPersistedState()`
 * used to write the literal `1` while this constant lived privately here, so
 * bumping it alone produced a build that WROTE v1 and REJECTED v1 on the next
 * load — silent, total state loss on every boot. Never write a literal version.
 *
 * v1 → v2 (TASK-196): added {@link PersistedState.agentState}.
 */
export const PERSISTED_STATE_VERSION = 2;

/** The oldest version {@link migratePersistedState} can still read. */
const OLDEST_READABLE_VERSION = 1;

/**
 * How long a saved pose/place stays believable while the robot is powered off.
 *
 * A robot that was carried, re-parked or nudged while off must not come back
 * claiming its old pose: past this age the pose and the place are restored as
 * unknown, which is the honest answer. Same bug class as a resurrected
 * `heldObject` — an object the robot "knows" it is holding after someone took
 * it out of its hand.
 */
export const PLACE_STALE_MS = 10 * 60_000;

/**
 * Durable safety/agent state (TASK-196). A robot that was E-Stopped must come
 * back knowing it, or the latch that refuses motion silently vanishes on reboot
 * while the E-Stop *warning* survives — a rebooted robot that is MORE willing to
 * move than one that has been running.
 */
export interface PersistedAgentState {
  /** An E-Stop latch was held when this snapshot was written. */
  estopLatched: boolean;
  /** Original cause of that latch, for the boot banner and the UI badge. */
  estopReason: string | null;
  /** ISO-8601 timestamp of the latch. */
  estopAt: string | null;
  /** The base sat in a non-locomoting FSM (damp/sit/zero-torque). */
  damped: boolean;
  /** Last FSM id the base was commanded into, or null if never commanded. */
  lastFsmId: number | null;
  /** Named place the robot believed it was at (TASK-195); null when stale. */
  place: string | null;
  /** Incarnation that wrote this snapshot; `''` for a v1 upgrade (no lineage). */
  bootId: string;
}

/** Serialisable snapshot written to disk */
export interface PersistedState {
  /** Schema version — bump {@link PERSISTED_STATE_VERSION} when the shape changes */
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
  /** Durable safety state — see {@link PersistedAgentState} (v2+). */
  agentState: PersistedAgentState;
}

/**
 * The safe defaults for a robot with no record either way: not latched, not
 * damped, no place. A guess in the other direction would either strand a robot
 * that was fine or, worse, wave through one that was stopped.
 */
export function defaultPersistedAgentState(): PersistedAgentState {
  return {
    estopLatched: false,
    estopReason: null,
    estopAt: null,
    damped: false,
    lastFsmId: null,
    place: null,
    bootId: '',
  };
}

/** Coerce whatever is on disk into a complete {@link PersistedAgentState}. */
function coerceAgentState(raw: unknown): PersistedAgentState {
  const base = defaultPersistedAgentState();
  if (typeof raw !== 'object' || raw === null) return base;
  const obj = raw as Record<string, unknown>;
  return {
    estopLatched: obj.estopLatched === true,
    estopReason: typeof obj.estopReason === 'string' ? obj.estopReason : null,
    estopAt: typeof obj.estopAt === 'string' ? obj.estopAt : null,
    damped: obj.damped === true,
    lastFsmId: typeof obj.lastFsmId === 'number' ? obj.lastFsmId : null,
    place: typeof obj.place === 'string' ? obj.place : null,
    bootId: typeof obj.bootId === 'string' ? obj.bootId : '',
  };
}

/**
 * Migrate a blob read from disk to the current schema, or `null` when it cannot
 * be read at all (unknown/future version, structurally wrong).
 *
 * This is a REAL migration, not a version bump: v1 files carry a full robot
 * state — battery, location, task queue — and dropping them on upgrade is the
 * exact failure this function exists to prevent. Only the new fields are
 * defaulted; nothing that was already on disk is touched.
 */
export function migratePersistedState(data: unknown): PersistedState | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== 'number') return null;
  if (obj.version < OLDEST_READABLE_VERSION || obj.version > PERSISTED_STATE_VERSION) {
    return null;
  }
  if (typeof obj.savedAt !== 'string') return null;
  if (typeof obj.robotState !== 'object' || obj.robotState === null) return null;
  if (!Array.isArray(obj.taskQueue)) return null;

  return {
    ...(obj as unknown as PersistedState),
    version: PERSISTED_STATE_VERSION,
    // v1 had no agentState at all; a v2 file with a mangled one is repaired
    // rather than rejected — losing the battery/queue over it would be worse.
    agentState: coerceAgentState(obj.agentState),
  };
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
        path.dirname(fileURLToPath(import.meta.url)),
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
      // Temp file + rename, NOT a truncating write onto the live path: this is
      // the shutdown write, so the process is about to end and a death between
      // the truncate and the write would leave an empty file that `load()`
      // reads as "no record" — the E-Stop latch would silently not come back.
      atomicWriteFileSync(this.filePath, JSON.stringify(toWrite, null, 2));
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
      const readVersion =
        typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>).version
          : undefined;

      const migrated = migratePersistedState(data);
      if (!migrated) {
        console.warn('[StatePersistence] Invalid or unrecognised state file — ignoring');
        return null;
      }

      if (readVersion !== PERSISTED_STATE_VERSION) {
        console.log(
          `[StatePersistence] Migrated state file v${String(readVersion)} → v${PERSISTED_STATE_VERSION}`,
        );
      }
      console.log(
        `[StatePersistence] Loaded state from ${this.filePath} (saved ${migrated.savedAt})`,
      );
      return migrated;
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
      // See {@link saveSync}: a debounced write lands 500 ms after the state
      // changed, which on a crashing process is precisely the window in which
      // the machine dies mid-write.
      atomicWriteFileSync(this.filePath, JSON.stringify(this.pendingState, null, 2));
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

  // The old private `isValidPersistedState` guard lived here. It hard-rejected
  // anything but the current version, which made every schema bump a silent
  // wipe; {@link migratePersistedState} is both the guard and the upgrade path.
}
