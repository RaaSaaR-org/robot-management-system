/**
 * @file types.ts
 * @description Agent Mode wire contract — block/plan/scene/control-owner shapes
 *              shared verbatim with the server (`server/src/types/agent-mode.types.ts`)
 *              and the app (`app/src/features/agentmode/`). Any change here is a
 *              wire-breaking change and must land in all three at once.
 * @feature agentmode
 * @status live
 */

/** Executable block vocabulary (v1). No `vla_skill` — deferred to TASK-188. */
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

export const AgentBlockStatuses = [
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
  'aborted',
] as const;
export type AgentBlockStatus = (typeof AgentBlockStatuses)[number];

export const AgentPlanStatuses = ['planning', 'running', 'done', 'failed', 'aborted'] as const;
export type AgentPlanStatus = (typeof AgentPlanStatuses)[number];

/** Exclusive control arbitration. Only one owner drives the robot at a time. */
export const ControlOwners = ['idle', 'teleop', 'vla', 'agent'] as const;
export type ControlOwner = (typeof ControlOwners)[number];

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
   * What the block ACHIEVED, from odometry — see {@link BlockOutcome.measured}.
   * Carried on the block so a caller that only sees finished blocks (the
   * navigator, the UI) can tell "walked 0.98 m" from "did not move at all"
   * without parsing the message.
   */
  measured?: { distanceM?: number; angleDeg?: number };
}

export interface AgentPlan {
  id: string;
  robotId: string;
  /** The original utterance. */
  command: string;
  /** A2A context id, when the command arrived over A2A. */
  contextId?: string;
  blocks: AgentBlock[];
  /** Index of the running block; -1 when nothing runs. */
  cursor: number;
  status: AgentPlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SceneEntity {
  /** Free-text label as the VLM named it, e.g. "table", "hat", "person". */
  label: string;
  /** World bearing: +x = 0, CCW positive, normalized to (-180, 180]. */
  bearingDeg: number;
  /** Rough distance estimate in metres, or null when the VLM did not give one. */
  distanceEstM: number | null;
  /**
   * Where `distanceEstM` came from — the difference between a metre we measured
   * and a metre we guessed, which the operator must be able to see.
   *
   * `'lidar'` is a measured range: the nearest surface inside a cone around this
   * entity's bearing, taken from a real point cloud. LiDAR returns carry no
   * labels, so it means "something solid is that far away in that direction" —
   * not "the object I named is that far away". `'vlm-estimate'` is the vision
   * model's own guess, which measured 0.94 m MAE against known geometry and is
   * usually null anyway. `null` means there is no distance at all, which is
   * never the same as 0.
   */
  distanceSource: 'lidar' | 'vlm-estimate' | null;
  confidence: number;
  lastSeen: string;
  /**
   * Monotonic count of merges that actually re-observed this entity. Callers
   * that must tell "the last look confirmed this" from "this is what the last
   * look that saw it said" compare this across a look — `lastSeen` cannot serve
   * there, because two merges inside the same millisecond share a timestamp.
   * Display-irrelevant; not rendered in the scene table.
   */
  observedSeq: number;
  note?: string;
}

export interface SceneMemory {
  robotId: string;
  /** Free-text "what I currently see", straight from the VLM. */
  currentView: string;
  entities: SceneEntity[];
  personVisible: boolean;
  /**
   * Nearest surface straight ahead in metres, measured, or null when unknown —
   * no range sensor present, nothing returned, or every return rejected.
   *
   * Unknown is NOT "clear". The MID-360's vertical fan does not cover
   * everything in front of the robot, so an object can be real and still
   * produce no return; absence of a return is absence of evidence, and a
   * consumer that reads null as free space will walk into things.
   */
  forwardClearanceM: number | null;
  updatedAt: string;
}

export interface AgentModeState {
  robotId: string;
  enabled: boolean;
  controlOwner: ControlOwner;
  plan: AgentPlan | null;
  scene: SceneMemory | null;
  /** Set while an E-Stop is latched; cleared only by an explicit reset. */
  estopActive: boolean;
  /**
   * Last FSM id the base was commanded into, or null when it has not been
   * commanded in this process. Optional so an older server/app mirror stays
   * structurally compatible.
   */
  fsmId?: number | null;
  /**
   * True while the base is in a non-locomoting FSM (damp/sit/zero-torque) — the
   * state an E-Stop leaves it in. Locomotion commands are still accepted there
   * and do nothing, so this must be visible: clearing the E-Stop latch does NOT
   * re-arm the base, `posture stand` does.
   */
  damped?: boolean;
}

/**
 * Flat-envelope event types broadcast to the server and, from there, over the
 * existing `/api/a2a/ws`. The `agent:` prefix is the house convention clients
 * prefix-filter on.
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
 * Only the fields relevant to the event need to be present; `type`, `robotId`
 * and `timestamp` always are.
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

/** Response of `POST /robots/:id/agent-mode/command`. */
export interface AgentCommandResult {
  accepted: boolean;
  planId?: string;
  message: string;
}

/** Walking direction in the robot's own frame. */
export type WalkDirection = 'forward' | 'backward' | 'left' | 'right';

/** Posture presets mapped onto `LocoClient.SetFsmId`. */
export type PostureName = 'stand' | 'high' | 'low' | 'sit' | 'damp';

/** Outcome of executing a single block. Never thrown — always returned. */
export interface BlockOutcome {
  ok: boolean;
  /** Short human-readable result (`result` on success, `error` on failure). */
  message: string;
  /**
   * What the robot ACTUALLY achieved, measured from odometry — as opposed to
   * what it was commanded to do. Absent when no odometry was available, which
   * is itself meaningful: the caller then knows the motion is unverified rather
   * than assuming the command succeeded in full.
   */
  measured?: { distanceM?: number; angleDeg?: number };
}

/** Normalize any angle in degrees into (-180, 180]. */
export function normalizeDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d > 180) d -= 360;
  // `<=` (not `<`) so exactly -180 folds up to +180, making the range (-180, 180].
  if (d <= -180) d += 360;
  return d;
}

export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
