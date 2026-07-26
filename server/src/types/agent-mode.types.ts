/**
 * @file agent-mode.types.ts
 * @description Type definitions for Agent Mode (TASK-194) — the server-side
 *              mirror of the robot-agent's local-LLM block planner. Plans are
 *              ephemeral: nothing here is persisted, the server only keeps the
 *              last known state per robot in memory and fans events out over
 *              the existing A2A WebSocket.
 * @feature agentmode
 *
 * These types are the binding wire contract; the robot-agent
 * (`robot-agent/src/agent-mode/types.ts`) and the app
 * (`app/src/features/agentmode/types.ts`) mirror them verbatim. Deliberately
 * standalone — no import from `skill.types.ts`, because Agent Mode blocks are
 * NOT `SkillChain` steps and must not drift with them.
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

/** The v1 block vocabulary the planner may emit. No `vla_skill` in v1. */
export const AgentBlockKinds = [
  'walk',
  'turn',
  'goto',
  'look',
  'scan_room',
  'wave',
  'greet',
  'posture',
  'speak',
  'wait',
] as const;
export type AgentBlockKind = (typeof AgentBlockKinds)[number];

/** Lifecycle of a single block. Completed blocks are frozen by the planner. */
export const AgentBlockStatuses = [
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
  'aborted',
] as const;
export type AgentBlockStatus = (typeof AgentBlockStatuses)[number];

/** Lifecycle of a whole plan. */
export const AgentPlanStatuses = [
  'planning',
  'running',
  'done',
  'failed',
  'aborted',
] as const;
export type AgentPlanStatus = (typeof AgentPlanStatuses)[number];

/** Exclusive control arbitration. Human teleop preempts and discards the plan. */
export const ControlOwners = ['idle', 'teleop', 'vla', 'agent'] as const;
export type ControlOwner = (typeof ControlOwners)[number];

// ============================================================================
// PLAN & BLOCK
// ============================================================================

/** One executable step of a plan. */
export interface AgentBlock {
  id: string;
  kind: AgentBlockKind;
  params: Record<string, unknown>;
  status: AgentBlockStatus;
  /** One short planner sentence, shown on the block card. */
  reasoning?: string;
  /** ISO timestamp */
  startedAt?: string;
  /** ISO timestamp */
  finishedAt?: string;
  result?: string;
  error?: string;
}

/** A full block list produced by the planner for one utterance. */
export interface AgentPlan {
  id: string;
  robotId: string;
  /** The original utterance. */
  command: string;
  /** A2A context, when the command came in over A2A. */
  contextId?: string;
  blocks: AgentBlock[];
  /** Index of the running block; -1 when nothing runs. */
  cursor: number;
  status: AgentPlanStatus;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp */
  updatedAt: string;
}

// ============================================================================
// SCENE MEMORY
// ============================================================================

/** One thing the VLM reported seeing, with a world bearing. */
export interface SceneEntity {
  /** "table", "hat", "chair", "person" */
  label: string;
  /** World bearing, +x = 0, CCW positive, (-180, 180]. */
  bearingDeg: number;
  distanceEstM: number | null;
  /** 0..1 */
  confidence: number;
  /** ISO timestamp */
  lastSeen: string;
  note?: string;
}

/** The robot's in-memory picture of the room. Never persisted. */
export interface SceneMemory {
  robotId: string;
  /** Free-text "what I currently see", from the VLM. */
  currentView: string;
  entities: SceneEntity[];
  personVisible: boolean;
  /** ISO timestamp */
  updatedAt: string;
}

// ============================================================================
// AGENT MODE STATE
// ============================================================================

/** Everything a client needs to render Agent Mode for one robot. */
export interface AgentModeState {
  robotId: string;
  enabled: boolean;
  controlOwner: ControlOwner;
  plan: AgentPlan | null;
  scene: SceneMemory | null;
  /** Set while an E-Stop is latched; cleared by an explicit reset. */
  estopActive: boolean;
  /** Last FSM id the agent commanded, when known (G1: 0 zero-torque, 1 damp, 3 sit, 500 main). */
  fsmId?: number;
  /**
   * True while the base sits in a non-locomoting FSM (damp/sit/zero-torque) —
   * after an E-Stop, most commonly FSM 1. The robot physically cannot walk,
   * turn or goto until a `posture` block stands it back up, and nothing does
   * that automatically: Agent Mode is manual-E-Stop-only by decision, so the
   * operator has to be told rather than silently re-armed.
   */
  damped?: boolean;
}

// ============================================================================
// WEBSOCKET EVENT TYPES
// ============================================================================

/**
 * Colon-namespaced so WebSocket clients can prefix-filter on `agent:`
 * (same convention as `teleop:*` / `training:job:*`).
 */
export const AgentModeEventTypes = [
  'agent:plan:started',
  'agent:plan:updated',
  'agent:plan:finished',
  'agent:block:started',
  'agent:block:finished',
  'agent:scene:updated',
  'agent:state:changed',
] as const;
export type AgentModeEventType = (typeof AgentModeEventTypes)[number];

/**
 * Event pushed by the robot-agent and re-broadcast verbatim (flat) over
 * `/api/a2a/ws`. `type`, `robotId` and `timestamp` are always present; the
 * remaining fields carry only what is relevant to the event.
 */
export interface AgentModeEvent {
  type: AgentModeEventType;
  robotId: string;
  plan?: AgentPlan;
  block?: AgentBlock;
  scene?: SceneMemory;
  state?: AgentModeState;
  /** ISO timestamp */
  timestamp: string;
}

export type AgentModeEventCallback = (event: AgentModeEvent) => void;
