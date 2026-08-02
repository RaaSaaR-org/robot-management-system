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
export class AgentModeService {
  private eventCallbacks: Set<AgentModeEventCallback> = new Set();
  private states: Map<string, AgentModeState> = new Map();
  private recentEvents: AgentModeEvent[] = [];
  /**
   * When this mirror last INGESTED anything for a robot, ISO (TASK-200).
   *
   * The mirror is event-driven, so the age of an entry is the only thing that
   * separates "what the robot is doing" from "what a process that died an hour
   * ago was doing". Without recording it, that age is not knowable by any
   * downstream consumer — a client reading `GET /:id/agent-mode` could only
   * stamp its own fetch time, which is always "just now" and always a lie about
   * the snapshot. Observed live: the mirror served a dead duplicate agent's
   * `self` (incarnation 200, uptime 0) for 68 minutes while the live agent ran
   * as incarnation 199, and the page rendered it as current.
   *
   * This is the SERVER's clock, deliberately: it is the one clock that both
   * ends of this contract (ingest and read) share.
   */
  private mirroredAt: Map<string, string> = new Map();
  /**
   * When this mirror last ingested a valid SNAPSHOT per robot, ISO (TASK-200).
   *
   * {@link mirroredAt} dates the last event of ANY kind; this one dates the
   * last event that actually replaced the stored state. They diverge exactly
   * when a plan/block/scene event arrives after a snapshot: the stamp moves,
   * the `self`, `enabled` and `estopActive` in the entry do not.
   *
   * A consumer rendering the age of those fields has to use THIS one. Using
   * `mirroredAt` would make a snapshot appear younger than it is every time a
   * block event fires — the same "just now" lie, one indirection further in.
   */
  private stateMirroredAt: Map<string, string> = new Map();
  private readonly now: () => number;

  constructor(deps: { now?: () => number } = {}) {
    this.now = deps.now ?? (() => Date.now());
  }
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
   *
   * ABSENT is not `null`, on the snapshot as much as on the event: a periodic
   * liveness re-assertion (TASK-200) carries neither `plan` nor `scene`, and
   * treating that as "the plan is now gone" would blank the console's timeline
   * four times a minute for the whole life of every plan.
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
    const stored = this.states.get(robotId);
    const next: AgentModeState = snapshot
      ? { ...snapshot, robotId }
      : { ...(stored ?? this.emptyState(robotId)) };
    if (snapshot) {
      this.hydrated.add(robotId);
      // A snapshot that OMITS plan/scene says nothing about them — it is a
      // heartbeat, not a claim that the robot has neither. Carry the stored
      // values across; an explicit `null` still clears, which is how a robot
      // that really has no plan says so.
      if (snapshot.plan === undefined) next.plan = stored?.plan ?? null;
      if (snapshot.scene === undefined) next.scene = stored?.scene ?? null;
    }

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
    // Stamped for EVERY ingested event, not only for snapshots: a plan or block
    // event is proof the pushing process is alive, which is exactly the
    // question `mirroredAt` answers. It deliberately does NOT move on a read —
    // reading a mirror does not make its contents any younger.
    const at = new Date(this.now()).toISOString();
    this.mirroredAt.set(robotId, at);
    // …and separately, the age of the STATE now stored. Only a snapshot
    // replaced it, so only a snapshot may re-date it.
    if (snapshot) this.stateMirroredAt.set(robotId, at);
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
   * When this mirror last ingested an event for a robot (ISO), or null when it
   * never has. The AGE OF THE ANSWER, which the answer itself cannot carry:
   * nothing in `AgentModeState` is a wall-clock timestamp, and the reader's own
   * clock only records when it asked.
   */
  getMirroredAt(robotId: string): string | null {
    return this.mirroredAt.get(robotId) ?? null;
  }

  /**
   * When this mirror last ingested a SNAPSHOT for a robot (ISO), or null when
   * it never has. The age of the state {@link getState} returns — including its
   * `self`, which is what an operator reads as the robot's identity, battery
   * and uptime.
   *
   * Never newer than {@link getMirroredAt}, and usually older: proof that the
   * agent is alive is not proof that what it last SAID is current.
   */
  getStateMirroredAt(robotId: string): string | null {
    return this.stateMirroredAt.get(robotId) ?? null;
  }

  /**
   * This service's own clock, ISO — the frame both stamps above live in.
   *
   * Handed to clients so the age of a snapshot can be computed inside one
   * clock. Subtracting `mirroredAt` from a browser's `Date.now()` measures the
   * skew between two machines as much as the age of the data.
   */
  nowIso(): string {
    return new Date(this.now()).toISOString();
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
