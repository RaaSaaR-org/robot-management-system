/**
 * @file AgentModeService.ts
 * @description In-memory mirror of the robot-agent's Agent Mode (TASK-194).
 *              Holds the last known AgentModeState per robot plus a bounded
 *              recent-event log, and fans ingested events out to subscribers
 *              (the A2A WebSocket). No Prisma, no migration — Agent Mode plans
 *              are ephemeral by design.
 * @feature agentmode
 */

import {
  ControlOwners,
  type AgentModeEvent,
  type AgentModeEventCallback,
  type AgentModeState,
  type ControlOwner,
  type SceneMemory,
} from '../types/agent-mode.types.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Recent events kept for late-joining clients / debugging. */
const MAX_RECENT_EVENTS = 200;

/** Default page size for getRecentEvents(). */
const DEFAULT_EVENT_LIMIT = 50;

// ============================================================================
// SNAPSHOT VALIDATION
// ============================================================================

/**
 * True when `state` is a snapshot the mirror may honestly serve: the fields an
 * operator acts on (`enabled`, `estopActive`) plus a known `controlOwner` must
 * be present with the right types — the same fields {@link
 * AgentModeService.isHydrated} vouches for. Anything less (an empty object, a
 * truthy non-object, a snapshot missing `estopActive`) must never mark a robot
 * hydrated: the missing fields would be backfilled by `emptyState()` defaults
 * and served as the robot's own answer.
 */
export function isValidAgentModeSnapshot(state: unknown): state is AgentModeState {
  if (typeof state !== 'object' || state === null) {
    return false;
  }
  const s = state as Partial<AgentModeState>;
  return (
    typeof s.enabled === 'boolean' &&
    typeof s.estopActive === 'boolean' &&
    ControlOwners.includes(s.controlOwner as ControlOwner)
  );
}

// ============================================================================
// AGENT MODE SERVICE
// ============================================================================

/**
 * AgentModeService — last-known Agent Mode state per robot, in memory only.
 */
class AgentModeService {
  private eventCallbacks: Set<AgentModeEventCallback> = new Set();
  private states: Map<string, AgentModeState> = new Map();
  private recentEvents: AgentModeEvent[] = [];
  /**
   * Robots whose stored state came from a real snapshot (`event.state` passing
   * {@link isValidAgentModeSnapshot}), not from {@link emptyState}. Only
   * `agent:state:changed` carries a snapshot; a plan/block/scene event arriving
   * first would otherwise leave the mirror asserting `enabled: false` and
   * `estopActive: false` purely as defaults.
   */
  private hydrated: Set<string> = new Set();

  // ==========================================================================
  // INGEST
  // ==========================================================================

  /**
   * Merge an event pushed by the robot-agent into the stored state and notify
   * subscribers. Returns the merged state so the caller can echo it back.
   *
   * Merge order (most authoritative last): stored state → `event.state`
   * (a full snapshot, when the agent sends a valid one) → the specific `plan` / `scene`
   * fields → `event.block` spliced into the plan by id. Explicit `null` for
   * `plan`/`scene` clears the field, so a cleared plan is not resurrected from
   * the previous state.
   */
  ingest(event: AgentModeEvent): AgentModeState {
    const robotId = event.robotId;
    // Only a snapshot that actually asserts `enabled`/`estopActive` may replace
    // the stored state and mark the robot hydrated. An invalid `event.state`
    // (e.g. `{}` POSTed to /events) is treated as no snapshot at all: the
    // event's plan/scene/block fields still merge as usual, but the entry is
    // never marked hydrated — otherwise emptyState() defaults would be served
    // as the robot's own answer.
    const snapshot = isValidAgentModeSnapshot(event.state) ? event.state : undefined;
    const next: AgentModeState = snapshot
      ? { ...snapshot, robotId }
      : { ...(this.states.get(robotId) ?? this.emptyState(robotId)) };
    if (snapshot) this.hydrated.add(robotId);

    if (event.plan !== undefined) {
      next.plan = event.plan;
    }
    if (event.scene !== undefined) {
      next.scene = event.scene;
    }

    // Block-level events may omit the plan; keep the stored plan consistent by
    // replacing the matching block in place (no-op if the ids don't match).
    if (event.block && next.plan) {
      const index = next.plan.blocks.findIndex((b) => b.id === event.block?.id);
      if (index >= 0) {
        const blocks = [...next.plan.blocks];
        blocks[index] = event.block;
        next.plan = { ...next.plan, blocks };
      }
    }

    this.states.set(robotId, next);
    this.logEvent(event);
    this.emitEvent(event);

    return next;
  }

  // ==========================================================================
  // QUERIES
  // ==========================================================================

  /** Last known state for a robot, or null when nothing was ingested yet. */
  getState(robotId: string): AgentModeState | null {
    return this.states.get(robotId) ?? null;
  }

  /**
   * True when the stored state's own fields (`enabled`, `controlOwner`,
   * `estopActive`) came from the robot rather than from {@link emptyState}.
   * Callers that report those fields to an operator must check this and ask the
   * robot instead — a fabricated `estopActive: false` reads as "E-Stop clear".
   */
  isHydrated(robotId: string): boolean {
    return this.hydrated.has(robotId);
  }

  /** Last known scene memory for a robot, or null. */
  getScene(robotId: string): SceneMemory | null {
    return this.states.get(robotId)?.scene ?? null;
  }

  /** Recent events, newest first, optionally filtered by robot. */
  getRecentEvents(robotId?: string, limit = DEFAULT_EVENT_LIMIT): AgentModeEvent[] {
    const events = robotId
      ? this.recentEvents.filter((e) => e.robotId === robotId)
      : this.recentEvents;
    return events.slice(0, limit);
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  /**
   * Subscribe to Agent Mode events. Returns an unsubscribe function.
   */
  onAgentModeEvent(callback: AgentModeEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /** Append to the bounded recent-event log (newest first). */
  private logEvent(event: AgentModeEvent): void {
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.pop();
    }
  }

  /** Emit an event to all subscribers; one bad callback must not stop the rest. */
  private emitEvent(event: AgentModeEvent): void {
    this.eventCallbacks.forEach((cb) => {
      try {
        cb(event);
      } catch (error) {
        console.error('[AgentModeService] Event callback error:', error);
      }
    });
  }

  /** Neutral state for a robot we have not heard from yet. */
  private emptyState(robotId: string): AgentModeState {
    return {
      robotId,
      enabled: false,
      controlOwner: 'idle',
      plan: null,
      scene: null,
      estopActive: false,
    };
  }
}

// Singleton instance
export const agentModeService = new AgentModeService();
