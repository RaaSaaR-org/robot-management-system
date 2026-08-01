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
  /**
   * What the block ACTUALLY achieved, from odometry — as opposed to what it was
   * commanded to do. Carried on the block so a consumer that only sees finished
   * blocks (the UI) can tell "walked 0.98 m" from "did not move at all" without
   * parsing the message. Absent when no odometry was available, which is itself
   * meaningful: the motion is then unverified, not confirmed.
   */
  measured?: { distanceM?: number; angleDeg?: number };
}

/** A full block list produced by the planner for one utterance. */
/**
 * Languages the robot can be spoken to and answer in. Mirrors
 * `SpokenLanguages` in the robot-agent's agent-mode types.
 */
export const SpokenLanguages = ['en', 'de'] as const;
export type SpokenLanguage = (typeof SpokenLanguages)[number];

export interface AgentPlan {
  id: string;
  robotId: string;
  /** The original utterance. */
  command: string;
  /** A2A context, when the command came in over A2A. */
  contextId?: string;
  /**
   * Language the operator SPOKE, when the command arrived over the voice
   * channel; absent for every typed command. Set by the robot-agent — the one
   * reliable marker that a plan came in through the microphone rather than
   * from a keyboard somewhere.
   */
  language?: SpokenLanguage;
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
  /**
   * Where `distanceEstM` came from — a measured metre and a guessed one must
   * not be presented alike.
   *
   * `'lidar'` is a measured range: the nearest surface inside a cone around
   * this bearing, from a real point cloud. Returns are unlabelled, so it means
   * "something solid is that far away in that direction", not "the named object
   * is". `'vlm-estimate'` is the vision model's guess (0.94 m MAE against known
   * geometry, usually null). `null` means no distance at all — never 0.
   *
   * Optional, like `fsmId`/`damped` below: an older robot-agent sends no source
   * field, and the server mirrors what it is given rather than inventing one.
   * Consumers must treat "absent" as unverified, not as measured.
   */
  distanceSource?: 'lidar' | 'vlm-estimate' | null;
  /**
   * How many separate things the last look called by this label — present only
   * when it was more than one.
   *
   * Scene memory is keyed by label, so two doorways in one frame are two real
   * objects competing for the key "door". The robot-agent keeps the most
   * central one; this says the choice was made, because "walk to the door" is
   * a different instruction when the robot can see two.
   */
  duplicatesInView?: number;
  /** 0..1 */
  confidence: number;
  /** ISO timestamp */
  lastSeen: string;
  /**
   * Monotonic count of merges that actually re-observed this entity. Lets a
   * consumer tell "the last look confirmed this" from "this is what the last
   * look that saw it said" — `lastSeen` cannot serve there, because two merges
   * inside the same millisecond share a timestamp. Optional for the same
   * older-agent reason as `distanceSource`; display-irrelevant.
   */
  observedSeq?: number;
  note?: string;
}

/** The robot's in-memory picture of the room. Never persisted. */
export interface SceneMemory {
  robotId: string;
  /** Free-text "what I currently see", from the VLM. */
  currentView: string;
  entities: SceneEntity[];
  personVisible: boolean;
  /**
   * Nearest surface straight ahead in metres, measured, or null when unknown —
   * no range sensor present, nothing returned, or every return rejected.
   *
   * Unknown is NOT "clear": the LiDAR's vertical fan does not cover everything
   * in front of the robot, so an object can be real and still produce no
   * return. Optional because an older robot-agent omits the field entirely;
   * absent and null both mean "we do not know", never "the way is free".
   */
  forwardClearanceM?: number | null;
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
