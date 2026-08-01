/**
 * @file agentmode.types.ts
 * @description Agent Mode wire contract (TASK-194) mirrored from the robot-agent
 *              and server, plus the frontend store interface.
 * @feature agentmode
 */

import type { WebSocketStatus } from '@/shared/types';

// ============================================================================
// WIRE CONTRACT — identical shape in robot-agent, server and app
// ============================================================================

/** Executable block kinds the planner may emit (v1 — no `vla_skill`). */
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

/** Lifecycle of a single block. */
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

/** Exclusive owner of the robot's motion. */
export const ControlOwners = ['idle', 'teleop', 'vla', 'agent'] as const;
export type ControlOwner = (typeof ControlOwners)[number];

/** One executable step of a plan. */
export interface AgentBlock {
  id: string;
  kind: AgentBlockKind;
  params: Record<string, unknown>;
  status: AgentBlockStatus;
  /** One short planner sentence, shown on the block card. */
  reasoning?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  /**
   * What the block ACTUALLY achieved, from odometry — as opposed to what it was
   * commanded to do. Lets the UI tell "walked 0.98 m" from "did not move at
   * all" without parsing the result string. Absent when no odometry was
   * available, which is itself meaningful: the motion is then unverified.
   */
  measured?: { distanceM?: number; angleDeg?: number };
}

/** An ephemeral plan — never persisted, never a `SkillChain`. */
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
  createdAt: string;
  updatedAt: string;
}

/** One thing the vision model currently believes is in the room. */
export interface SceneEntity {
  label: string;
  /** World bearing, +x = 0, CCW positive, (-180, 180]. */
  bearingDeg: number;
  distanceEstM: number | null;
  /**
   * Where `distanceEstM` came from — the panel renders a measured metre
   * differently from a guessed one, so this drives real UI, not just docs.
   *
   * `'lidar'` is a measured range: the nearest surface inside a cone around
   * this bearing, from a real point cloud. Returns are unlabelled, so it means
   * "something solid is that far away in that direction", not "the named object
   * is". `'vlm-estimate'` is the vision model's guess (0.94 m MAE against known
   * geometry, usually null). `null` means no distance at all — never 0.
   *
   * Optional, like `fsmId`/`damped` below, because an older agent sends no
   * source field. Absent must be rendered as unverified, never as measured.
   */
  distanceSource?: 'lidar' | 'vlm-estimate' | null;
  /** 0..1 */
  confidence: number;
  lastSeen: string;
  /**
   * Monotonic count of merges that actually re-observed this entity —
   * distinguishes "the last look confirmed this" from "this is what the last
   * look that saw it said", which `lastSeen` cannot, since two merges inside
   * the same millisecond share a timestamp. Optional for the same older-agent
   * reason as `distanceSource`; deliberately not rendered in the scene table.
   */
  observedSeq?: number;
  note?: string;
}

/** In-memory scene memory — entity list plus a free-text "what I see". */
export interface SceneMemory {
  robotId: string;
  currentView: string;
  entities: SceneEntity[];
  personVisible: boolean;
  /**
   * Nearest surface straight ahead in metres, measured, or null when unknown —
   * no range sensor present, nothing returned, or every return rejected.
   *
   * Unknown is NOT "clear": the LiDAR's vertical fan does not cover everything
   * in front of the robot, so an object can be real and still produce no
   * return. Optional because an older agent omits the field entirely; the panel
   * therefore shows this row only when it is a real number, and says nothing at
   * all otherwise rather than claiming free space.
   */
  forwardClearanceM?: number | null;
  updatedAt: string;
}

/** Last known Agent Mode state for one robot. */
export interface AgentModeState {
  robotId: string;
  enabled: boolean;
  controlOwner: ControlOwner;
  plan: AgentPlan | null;
  scene: SceneMemory | null;
  /** Set while an E-Stop is latched; cleared by an explicit reset. */
  estopActive: boolean;
  /**
   * Last FSM id the base was commanded into, or null when it has not been
   * commanded in this process. Optional so an older agent stays compatible.
   */
  fsmId?: number | null;
  /**
   * True while the base sits in a non-locomoting FSM (damp/sit/zero-torque) —
   * the state an E-Stop leaves it in. Walk/turn/goto are still *accepted*
   * there and simply do nothing, so this has to be visible: clearing the
   * E-Stop latch does NOT re-arm the base, a `posture` "stand" does.
   */
  damped?: boolean;
}

// ============================================================================
// WEBSOCKET EVENTS (`/api/a2a/ws`, flat envelope, `agent:` prefix)
// ============================================================================

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
 * Broadcast envelope. `type`, `robotId` and `timestamp` are always present;
 * only the payload fields relevant to the event are sent.
 */
export interface AgentModeEvent {
  type: AgentModeEventType;
  robotId: string;
  plan?: AgentPlan;
  block?: AgentBlock;
  scene?: SceneMemory;
  state?: AgentModeState;
  timestamp: string;
}

/** Narrowing guard for the flat WebSocket envelope. */
export function isAgentModeEvent(value: unknown): value is AgentModeEvent {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return (
    typeof type === 'string' &&
    (AgentModeEventTypes as readonly string[]).includes(type) &&
    typeof (value as { robotId?: unknown }).robotId === 'string'
  );
}

// ============================================================================
// REST PAYLOADS
// ============================================================================

/** Response of `POST /robots/:id/agent-mode/command`. */
export interface AgentCommandResponse {
  accepted: boolean;
  planId?: string;
  message: string;
}

/**
 * Response of `POST /robots/:id/agent-mode/estop`.
 *
 * Receiving this at all is the agent's acknowledgement that it latched the
 * E-Stop in software. `stopped` answers the narrower question "was a live plan
 * aborted?" (`wasRunning` in the controller) — the UI must not turn a plan
 * into an aborted one without it. `delivered` is the separate hardware claim:
 * StopMove AND Damp were acked by the sidecar. `false` means the stop latched
 * in software only — the robot may physically still be moving.
 */
export interface AgentEstopResponse {
  ok: true;
  stopped: boolean;
  /**
   * StopMove and Damp both reached the robot. An older robot-agent omits the
   * field; only an explicit `false` may downgrade the stop to unconfirmed.
   */
  delivered?: boolean;
  /** Which hardware call failed, when `delivered` is false. */
  deliveryError?: string;
}

/**
 * Lifecycle of the operator's manual E-Stop, tracked separately from the latch
 * itself. Manual E-Stop is the only safety mechanism in v1, so the UI must
 * never present a stop it could not verify as a completed one.
 *
 * - `idle`         — no stop requested and none reported by the agent
 * - `requesting`   — the POST is in flight; the robot is NOT confirmed stopped
 * - `acknowledged` — the agent answered (or reports `estopActive` itself)
 * - `unconfirmed`  — the agent latched in software but reported the hardware
 *                    stop as NOT delivered; the robot may still be moving
 * - `failed`       — the request never reached the agent; nothing is confirmed
 */
export const AgentEstopStatuses = [
  'idle',
  'requesting',
  'acknowledged',
  'unconfirmed',
  'failed',
] as const;
export type AgentEstopStatus = (typeof AgentEstopStatuses)[number];

// ============================================================================
// UI TYPES
// ============================================================================

/** One line of the Agent Mode conversation. */
export interface AgentChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: string;
  /** Plan this message produced (user) or reports on (agent). */
  planId?: string;
  /**
   * Set on the acknowledgement only. The plan's block cards render underneath
   * this bubble, so the conversation reads command → ack → blocks and the
   * later plan summary does not repeat them.
   */
  showsPlan?: boolean;
  /** Rendered as an error bubble. */
  isError?: boolean;
}

/** The command a plan is expected for — drives the demo-mode plan driver. */
export interface AgentPendingCommand {
  planId: string;
  text: string;
  robotId: string;
}

// ============================================================================
// STORE
// ============================================================================

export interface AgentModeStore {
  /** Robot the page is currently bound to. */
  robotId: string | null;
  enabled: boolean;
  controlOwner: ControlOwner;
  /** The local latch: set the moment STOPP is pressed, refuses new commands. */
  estopActive: boolean;
  /** Whether that latch is merely requested, agent-acknowledged, or failed. */
  estopStatus: AgentEstopStatus;
  /** Why the stop request failed — the evidence that it never left the browser. */
  estopError: string | null;
  /** True while the base cannot locomote (damped/sit/zero-torque FSM). */
  damped: boolean;
  /** Last FSM id the base was commanded into; null when never commanded. */
  fsmId: number | null;
  plan: AgentPlan | null;
  /** Superseded plans, oldest first — keeps older block cards in the chat. */
  planHistory: AgentPlan[];
  scene: SceneMemory | null;
  messages: AgentChatMessage[];
  pendingCommand: AgentPendingCommand | null;
  connectionStatus: WebSocketStatus;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;

  /** Bind the store to a robot (clears per-robot state on change). */
  selectRobot: (robotId: string | null) => void;
  /** Load the last known state + scene memory for a robot. */
  fetchState: (robotId: string) => Promise<void>;
  /** Send a plain-language command; resolves once the agent accepted it. */
  sendCommand: (robotId: string, text: string) => Promise<void>;
  /** Turn Agent Mode on/off for a robot. */
  toggle: (robotId: string, enabled: boolean) => Promise<void>;
  /**
   * Latch the E-Stop locally, then ask the agent to stop. The plan is only
   * rewritten once the agent confirms it aborted one.
   */
  estop: (robotId: string, reason?: string) => Promise<void>;
  /** Clear a latched E-Stop. */
  resetEstop: (robotId: string) => Promise<void>;
  /** WebSocket reducer — the single entry point for `agent:*` events. */
  applyEvent: (event: AgentModeEvent) => void;
  setConnectionStatus: (status: WebSocketStatus) => void;
  clearError: () => void;
  reset: () => void;
}
