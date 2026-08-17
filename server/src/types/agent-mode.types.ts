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
  /**
   * Write one operator-authored line into durable memory (TASK-197). The only
   * block that touches the memory workspace, and the only WRITE path the
   * planner has into it — retrieval is injection, never a planned step.
   */
  'remember',
  /**
   * Patrol (TASK-212). `patrol` is the top-level block the controller expands
   * into legs (like `scan_room` expands into turns); `capture` takes the
   * control photo at a checkpoint (stored only when no person is in frame);
   * `inspect` compares the checkpoint against its baseline. Never planned by
   * the LLM — only `PatrolRunner` emits them.
   */
  'patrol',
  'capture',
  'inspect',
  /**
   * Host mode (TASK-213). `tour` is the top-level block `TourRunner` expands
   * into legs (exactly as `patrol` is); `present` says ONE authored chunk of a
   * stop's talk track; `demo` runs — or honestly narrates — the VLA skill that
   * belongs to a stop. Never planned by the LLM: a stop's words are authored by
   * an operator and a model may not rephrase them in front of a visitor.
   */
  'tour',
  'present',
  'demo',
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
  /**
   * For a `goto` block: whether the navigator planned its route on the
   * occupancy map or is walking by sight (TASK-208). Optional — older agents
   * never set it.
   */
  nav?: AgentBlockNav;
}

/** How a `goto` is being driven (TASK-208) — the card's "planned 3.2 m in 2 segments" / "walking by sight". */
export interface AgentBlockNav {
  planned: boolean;
  /** Planned path length in metres, null when walking by sight. */
  lengthM: number | null;
  /** Number of straight segments in the plan (0 when walking by sight). */
  segments: number;
  /** Why the route is not planned, or null when it is. */
  reason: string | null;
}

/**
 * The navigator's current route (TASK-208): mirrored in `AgentModeState.nav`
 * and served on the agent's `/map`, where the map panel draws the polyline.
 * Null between navigations. Coordinates are the odometry frame the map is in.
 */
export interface AgentNavPlan extends AgentBlockNav {
  /** The entity being walked to. */
  target: string;
  /** Odometry-frame polyline, robot first; null when walking by sight. */
  path: Array<[number, number]> | null;
  /** Where the target is believed to be, in the odometry frame; null when unmeasured. */
  goal: { x: number; y: number } | null;
  updatedAt: string;
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
  distanceSource?: 'lidar' | 'vlm-estimate' | 'fleet' | null;
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

/**
 * Closed vocabulary of place types (TASK-195). Industry-first: the robot
 * reports warehouse geography, and house rooms ride along as `cell` until a
 * later task adds room-shaped types additively.
 */
export const PlaceTypes = [
  'aisle',
  'rack_face',
  'dock',
  'staging',
  'cell',
  'charging',
  'corridor',
  'office',
  'unknown',
] as const;
export type PlaceType = (typeof PlaceTypes)[number];

/** How a place's geometry was obtained — a survey, an observation, or a claim. */
export type PlaceSource = 'surveyed' | 'observed' | 'declared';

/**
 * `stale` means the pose behind the place has accumulated more translation than
 * the drift budget without a re-anchor. The geometry is still right; the pose
 * fed into it has had no correction for a long walk.
 */
export type PlaceConfidence = 'confident' | 'stale';

/**
 * The place a robot believes it is standing in (TASK-195).
 *
 * `null` means UNKNOWN, and UNKNOWN is never rendered as the last known place:
 * a robot that has lost its pose has lost its place, and saying otherwise sends
 * an operator to the wrong aisle.
 */
export interface ScenePlace {
  /** Stable id from the robot's place graph, e.g. `AISLE-3`. */
  id: string;
  name: string;
  placeType: PlaceType;
  confidence: PlaceConfidence;
  source: PlaceSource;
}

/** The robot's in-memory picture of the room. Never persisted. */
export interface SceneMemory {
  robotId: string;
  /** Free-text "what I currently see", from the VLM. */
  currentView: string;
  entities: SceneEntity[];
  personVisible: boolean;
  /**
   * Named place the robot is standing in, or null for UNKNOWN. Optional
   * because an older robot-agent omits the field entirely; absent and null both
   * mean "we do not know where it is", never "wherever it was last".
   */
  place?: ScenePlace | null;
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

/**
 * What a robot's current boot inherited from its previous one (TASK-196).
 *
 * Non-null while no human has acknowledged it. The robot-agent persists its
 * E-Stop latch and its boot lineage across restarts, so a robot that was
 * stopped comes back stopped — and this is how the operator is told, instead of
 * meeting a robot that silently refuses to move.
 */
export interface AgentRecoveryState {
  /** The previous process never shut down cleanly: it crashed or was killed. */
  fromCrash: boolean;
  /** The E-Stop latch was restored from disk rather than taken in this process. */
  estopLatched: boolean;
  /** ISO timestamp of the boot that inherited it. */
  at: string;
}

/**
 * Who the robot is and what it has been through (TASK-198), assembled by the
 * agent per turn from `IDENTITY.md`, its boot lineage and its journal.
 *
 * Mirrored verbatim from `robot-agent/src/agent-mode/types.ts`. The server does
 * not compute any of it: the robot is authoritative for its own identity, which
 * is also why `RobotManager.buildIdentityUpdate` ADOPTS a reported name rather
 * than overwriting it.
 */
export interface AgentSelfState {
  /** What a person calls this robot. Agent-writable in `IDENTITY.md`. */
  name: string;
  emoji: string | null;
  /** The machine this is — from the robot's configuration, never from the file. */
  unit: string;
  robotId: string;
  operator: string | null;
  site: string | null;
  /** There is no `IDENTITY.md` yet: the robot has not been named. */
  bootstrapRequired: boolean;
  bootId: string | null;
  /**
   * Which life this is — the lifetime boot ordinal the agent carries in its
   * lineage line, so it survives that file rotating. It never decreases.
   */
  incarnation: number;
  /**
   * Whether {@link incarnation} is exact rather than a lower bound. Optional on
   * the wire: an agent from before this field computed a floor from a rotating
   * ring buffer, and a missing flag is therefore read as "not exact".
   */
  incarnationExact?: boolean;
  uptimeS: number;
  /** `exit: 'crash'` means the previous line never got an `endedAt`. */
  lastShutdown: { at: string | null; exit: string; place: string | null } | null;
  place: string | null;
  poseSource: string | null;
  batteryPct: number | null;
  controlOwner: ControlOwner;
  damped: boolean;
  estopLatched: boolean;
  plansLast24h: number;
  failuresLast24h: number;
  memoryEntries: number;
}

/** Everything a client needs to render Agent Mode for one robot. */
export interface AgentModeState {
  robotId: string;
  enabled: boolean;
  controlOwner: ControlOwner;
  /**
   * The running plan, `null` when there is none — and ABSENT on a robot-agent's
   * periodic liveness re-assertion, which asserts nothing about the plan at all
   * (TASK-200). The three cases are different and the mirror must keep them
   * apart: absent keeps whatever it already had, `null` clears it.
   */
  plan?: AgentPlan | null;
  /** Same three-way contract as {@link plan}: absent ≠ `null`. */
  scene?: SceneMemory | null;
  /** Set while an E-Stop is latched; cleared by an explicit reset. */
  estopActive: boolean;
  /**
   * Which latch forbids driving while `estopActive` is set: `'agent'` is Agent
   * Mode's own STOPP / stop-word latch, `'safety'` is the SafetyMonitor's
   * protective or fleet E-Stop (fall/tilt, keepout, `emergencyStop`, A2A). Both
   * are cleared by the same reset. Optional for wire compat with older agents.
   */
  estopSource?: 'agent' | 'safety' | null;
  /** Human-readable reason of the latch named by `estopSource`, when known. */
  estopReason?: string | null;
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
  /**
   * Set when the robot came back from a restart still latched, or from an
   * unclean shutdown; null once an operator has cleared it. Optional and
   * mirrored verbatim — an older robot-agent omits it, which means "this agent
   * does not report recovery", not "there is nothing to report".
   */
  recovered?: AgentRecoveryState | null;
  /**
   * Who this robot is and what it has been through. Optional and mirrored
   * verbatim — an older robot-agent omits it, which means "this agent does not
   * report a self", not "this robot has no identity". A robot that genuinely
   * has none reports `self.bootstrapRequired`.
   */
  self?: AgentSelfState | null;
  /**
   * Summary of the robot's own occupancy map (TASK-206). Optional so an older
   * agent's snapshot still validates; `null` = map building disabled. The grid
   * itself is never mirrored — read it from the agent's `GET /robots/:id/map`.
   */
  map?: AgentMapSummary | null;
  /**
   * Where the robot believes it is standing (TASK-195), carried at the top
   * level so it does not depend on the scene having been observed: before the
   * first `look` the scene snapshot is null, yet the place belief may already
   * be confident. Optional so an older agent stays structurally compatible;
   * `null` = unknown.
   */
  place?: ScenePlace | null;
  /**
   * The route the navigator is currently following (TASK-208), or null when
   * no `goto` is running. Optional so an older robot-agent stays compatible.
   */
  nav?: AgentNavPlan | null;
}

/** Summary of the robot-built occupancy map carried in {@link AgentModeState}. */
export interface AgentMapSummary {
  knownCells: number;
  occupiedCells: number;
  lastIntegratedAt: string | null;
}

/**
 * What `GET /api/robots/:id/agent-mode` answers: the mirrored state plus the
 * one thing the state itself cannot carry — WHEN this server last heard from
 * the robot (TASK-200).
 *
 * Transport metadata, deliberately kept OFF {@link AgentModeState}: the robot
 * never sends it, the WebSocket relay never carries it, and a client that finds
 * it on a pushed event would be reading the server's clock as the robot's.
 *
 * `null` means this server cannot say how old the snapshot is. That is a THIRD
 * answer, not a synonym for fresh — a reader must render it as an unknown age
 * rather than stamping its own fetch time, which is always "just now".
 */
export interface MirroredAgentModeState extends AgentModeState {
  /**
   * When this server last ingested ANY event for the robot — proof that the
   * pushing process was alive at that instant, whatever it said.
   */
  mirroredAt: string | null;
  /**
   * When this server last ingested a valid SNAPSHOT (`agent:state:changed`
   * carrying `enabled`/`estopActive`/`controlOwner`) — i.e. the age of the
   * fields in this body, `self` included.
   *
   * Separate from `mirroredAt` on purpose: a plan/block/scene event moves the
   * proof-of-life stamp but leaves the previous snapshot in place, so dating
   * `self` by `mirroredAt` would make a snapshot look younger than it is —
   * the one direction this field must never fail in.
   */
  stateMirroredAt: string | null;
  /**
   * This server's clock when it wrote the response.
   *
   * The two stamps above are in the SERVER's frame and the reader's clock is
   * not that frame. Sending the frame's origin along lets a client compute the
   * age entirely inside it (`serverNow - stateMirroredAt`) instead of
   * subtracting a foreign clock — under skew that difference is a snapshot
   * rendered as fresh, or every fresh read rendered as cached.
   */
  serverNow: string;
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
  /** The durable memory workspace changed — carries {@link AgentMemoryDigest}. */
  'agent:memory:updated',
  /** Patrol run lifecycle (TASK-212) — carries {@link AgentModeEvent.patrol}. */
  'agent:patrol:started',
  'agent:patrol:leg',
  'agent:patrol:finished',
  /** A confirmed finding (TASK-212) — carries {@link AgentModeEvent.finding} (+ `patrol`). */
  'agent:finding:detected',
  'agent:finding:confirmed',
  /** Host-mode tour lifecycle (TASK-213) — carries {@link AgentModeEvent.tour}. */
  'agent:tour:started',
  'agent:tour:leg',
  /** One visitor question and what the robot answered — carries `tour` + `turn`. */
  'agent:tour:turn',
  'agent:tour:finished',
] as const;
export type AgentModeEventType = (typeof AgentModeEventTypes)[number];

/**
 * What the robot durably remembers, as counts rather than content (TASK-197).
 *
 * Deliberately a DIGEST: the memory itself is operator-authored text and
 * therefore personal data, and a fan-out event that reaches every connected
 * WebSocket client is not where it belongs. Whoever wants the content asks the
 * robot for it (`GET /robots/:id/memory.md`), which is a call that can be
 * authorised and audited.
 */
export interface AgentMemoryDigest {
  robotId: string;
  /** Place the robot was in when this digest was taken, or null for UNKNOWN. */
  place: string | null;
  /** Bytes used by `MEMORY.md` and its hard cap. */
  memoryBytes: number;
  memoryMaxBytes: number;
  /** `- …` entries in `MEMORY.md`. */
  memoryEntries: number;
  /** One row per place that has a note. */
  places: Array<{ id: string; entries: number; bytes: number }>;
  /** Journal day keys currently on disk, oldest first. */
  journalDays: string[];
  /**
   * What governs journal pruning, when the platform has been asked. `null`
   * means UNKNOWN — never "nothing is retained".
   */
  retention: { retentionDays: number; source: 'policy' | 'fallback'; legalHold: boolean } | null;
  updatedAt: string;
}

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
  /** Set on `agent:memory:updated` only. */
  memory?: AgentMemoryDigest;
  /** Set on `agent:patrol:*` and `agent:finding:*` (TASK-212): the run as of this event. */
  patrol?: PatrolRun;
  /** Set on `agent:finding:*` only. */
  finding?: PatrolFinding;
  /** Set on `agent:tour:*` (TASK-213): the tour run as of this event. */
  tour?: TourRun;
  /** Set on `agent:tour:turn` only: the question that was just answered. */
  turn?: TourTurn;
  /** ISO timestamp */
  timestamp: string;
}

export type AgentModeEventCallback = (event: AgentModeEvent) => void;

// ============================================================================
// PATROL (TASK-212) — routes, runs, findings. Wire contract shared verbatim by
// robot-agent / server / app. Server is the source of record for routes and the
// persisted history of runs + findings; the robot executes and reports.
// ============================================================================

/** What the robot does at a checkpoint after arriving and aligning. */
export const PatrolCheckpointActions = ['capture', 'dwell', 'scan'] as const;
export type PatrolCheckpointAction = (typeof PatrolCheckpointActions)[number];

export interface PatrolCheckpoint {
  id: string;
  /** Place id from the place graph the robot resolves (`goto.place` accepts it). */
  placeId: string;
  /** Display name — defaults to the place name. */
  name: string;
  /** World heading (deg, +x = 0, CCW+) to align to before the control photo; null = keep arrival heading. */
  headingDeg?: number | null;
  actions: PatrolCheckpointAction[];
  /** How long `dwell` waits, ms. */
  dwellMs?: number;
  /**
   * Operator expectations at this checkpoint, e.g. "fire extinguisher on the
   * wall left of the door". Each becomes an extra checklist item.
   */
  expectations?: string[];
}

/**
 * A named local-time window, e.g. `day` 07–19 or `night` 19–07 (wraps
 * midnight when `endHour <= startHour`). Baselines are kept PER window: a lit
 * lamp is normal at 09:00 and a finding at 03:00.
 */
export interface PatrolTimeWindow {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
}

export interface PatrolRoute {
  id: string;
  name: string;
  /** Robot this route is bound to; null = any robot the operator starts it on. */
  robotId: string | null;
  /** DigitalTwin whose place graph the checkpoints reference; null for a robot with a local graph (sim). */
  twinId: string | null;
  checkpoints: PatrolCheckpoint[];
  /** 5-field cron in server local time; null = manual only. */
  cronExpression: string | null;
  enabled: boolean;
  timeWindows: PatrolTimeWindow[];
  /** Place to return to when the route is done; null = stay at the last checkpoint. */
  homePlaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `baseline` = supervised reference run (records normal); `patrol` = compare against it. */
export const PatrolRunModes = ['baseline', 'patrol'] as const;
export type PatrolRunMode = (typeof PatrolRunModes)[number];

/** Who started the run. `scheduled` runs are the ones the initiative gate must clear. */
export const PatrolRunOrigins = ['operator', 'scheduled'] as const;
export type PatrolRunOrigin = (typeof PatrolRunOrigins)[number];

/** `skipped` = refused before the robot moved (precondition), `reason` says why. */
export const PatrolRunStatuses = ['running', 'done', 'aborted', 'failed', 'skipped'] as const;
export type PatrolRunStatus = (typeof PatrolRunStatuses)[number];

export const PatrolLegStatuses = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type PatrolLegStatus = (typeof PatrolLegStatuses)[number];

/** Outcome of the checkpoint inspection cascade for one leg. */
export type PatrolInspection =
  /** Hash gate said the frame equals the baseline photo — no model call. */
  | 'unchanged'
  /** Checklist answered and differed on ≥1 item (findings carry the diff). */
  | 'changed'
  /** Checklist answered, no difference. */
  | 'same'
  /** No baseline for this checkpoint × window yet. */
  | 'no_baseline'
  /** Baseline mode: this leg RECORDED the baseline. */
  | 'recorded'
  | 'skipped'
  | 'error';

export interface PatrolLeg {
  index: number;
  checkpointId: string;
  placeId: string;
  name: string;
  status: PatrolLegStatus;
  startedAt?: string;
  finishedAt?: string;
  /** Storage key of the control photo (`<runId>/<checkpointId>.jpg`), null when none. */
  photoKey?: string | null;
  /** Why no photo was stored, when it was not: a person was in frame, or the capture failed. */
  photoDropped?: 'person' | 'error' | null;
  inspection?: PatrolInspection | null;
  findingIds: string[];
  /** One line for the timeline: "arrived after 4 stages", "goto failed: …". */
  message?: string;
  /** Robot pose (odom frame) when the leg finished — lets the map overlay place the checkpoint marker. Optional; absent when unknown. */
  pose?: { x: number; y: number; yawDeg: number } | null;
}

export interface PatrolRun {
  runId: string;
  routeId: string;
  routeName: string;
  robotId: string;
  mode: PatrolRunMode;
  origin: PatrolRunOrigin;
  /** Time-window id the run was matched to (`PatrolTimeWindow.id`), null when the route has none. */
  window: string | null;
  status: PatrolRunStatus;
  /** Why the run was skipped/aborted/failed, in one sentence. */
  reason?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  legs: PatrolLeg[];
  findingCount: number;
  /** Agent Mode plan the run executed as, when it did. */
  planId?: string | null;
}

/** What is not normal. Severity is derived from type × window on the server. */
export const PatrolFindingTypes = [
  'person',
  'unexpected_object',
  'missing_object',
  'object_on_floor',
  'door_open',
  'lights_on',
  'out_of_place',
  'expectation_failed',
  'other',
] as const;
export type PatrolFindingType = (typeof PatrolFindingTypes)[number];

export const PatrolFindingSeverities = ['low', 'medium', 'high'] as const;
export type PatrolFindingSeverity = (typeof PatrolFindingSeverities)[number];

/**
 * `candidate` never leaves the robot; it becomes `open` once the confirmer
 * (N-of-M / revisit) agrees, and that is the first status the server sees.
 */
export const PatrolFindingStatuses = [
  'candidate',
  'open',
  'acknowledged',
  'dismissed_normal',
  'escalated',
] as const;
export type PatrolFindingStatus = (typeof PatrolFindingStatuses)[number];

/** Which comparator produced the finding. */
export type PatrolFindingSource =
  /** Checkpoint checklist diff (one VLM call). */
  | 'checkpoint'
  /** En-route entity-label diff vs the baseline leg (no model call). */
  | 'enroute_semantic'
  /** En-route occupancy-map diff vs the baseline map (no model call). */
  | 'enroute_geometric'
  /** Semantic AND geometric agreed on the same object — merged into one finding. */
  | 'enroute_both';

export interface PatrolFindingEvidence {
  baselinePhotoKey?: string | null;
  currentPhotoKey?: string | null;
  /** Checklist items whose answers differ, baseline vs current. */
  checklistDiff?: Array<{ item: string; baseline: string; current: string }>;
  /** Geometric blob: cells OCCUPIED now that were FREE in the baseline map. Odom frame. */
  blob?: { x: number; y: number; areaM2: number; cells: number };
  /** Semantic diff: labels new against the baseline leg / labels the baseline had that are gone. */
  labels?: { added: string[]; missing: string[] };
  /** How many consecutive observations agreed before this was confirmed. */
  observations?: number;
}

export interface PatrolFinding {
  id: string;
  runId: string;
  routeId: string;
  robotId: string;
  checkpointId?: string | null;
  legIndex: number;
  type: PatrolFindingType;
  severity: PatrolFindingSeverity;
  source: PatrolFindingSource;
  /** Place id where it was seen, null when unknown. */
  place: string | null;
  /** Robot pose (odom frame) when confirmed. */
  pose: { x: number; y: number; yawDeg: number } | null;
  at: string;
  /** One line for the alert title / list: "unexpected object in Hallway (0.4 m²)". */
  summary: string;
  evidence: PatrolFindingEvidence;
  /** Model that answered, when a model was involved; null for pure grid/label diffs. */
  model: string | null;
  confidence: number;
  status: PatrolFindingStatus;
  /** Server-side: the alert raised for it. */
  alertId?: string | null;
  incidentId?: string | null;
}

/** Response of `POST /robots/:id/agent-mode/patrol`. */
export interface PatrolStartResult {
  accepted: boolean;
  runId?: string;
  message: string;
  /** Machine-readable refusal, e.g. `disabled`, `battery`, `place_unknown`, `busy`, `estop`, `window`, `damped`, `crash_unacknowledged`. */
  reason?: string;
}

// ============================================================================
// HOST MODE (TASK-213) — tour routes, runs, turns. Wire contract shared verbatim
// by robot-agent / server / app, same discipline as PATROL above. The server is
// the source of record for routes and the persisted history of runs; the robot
// executes, speaks and reports.
//
// Two rules are encoded in these types rather than left to prose:
//   * everything the robot SAYS at a stop is authored text on the route
//     (`greeting`/`offer`/`talkTrack`/`farewell`) — there is no field a model
//     writes, because a demo is the worst place for an invented sentence;
//   * a question the facts do not cover is a FIRST-CLASS outcome
//     (`TourTurnAnswer = 'declined'`), not an error — it is the measurable
//     alternative to hallucinating, and the UI surfaces it as "facts to add".
// ============================================================================

/** The VLA skill a stop demonstrates. Referenced, never redefined: `skillId` is a `SkillDefinition.id`. */
export interface TourDemo {
  skillId: string;
  /** Display name, cached so the timeline reads right when the skill is gone. */
  skillName: string;
  /** Model version the operator expects to run, when pinned. */
  modelVersionId?: string | null;
  /** Roughly how long it takes — used for the route's duration estimate and the narration. */
  expectSeconds: number;
}

/** Hard caps. Enforced on the server (route validation) AND on the robot (block building). */
export const TOUR_HEADLINE_MAX = 60;
export const TOUR_TALK_TRACK_MAX = 600;
export const TOUR_FACT_MAX = 200;
export const TOUR_FACTS_MAX = 8;
export const TOUR_SITE_CARD_MAX = 10;
export const TOUR_STOPS_MAX = 12;
/**
 * Longest a stop may dwell for questions, seconds.
 *
 * 30 and not a round 60, because 30 is what the `wait` block actually clamps
 * to on the robot. Three different caps (server 120, route parser 60, wait
 * block 30) meant the editor could promise the operator a pause the robot was
 * never going to take, and the duration estimate was wrong by the difference.
 */
export const TOUR_DWELL_MAX_S = 30;

export interface TourStop {
  id: string;
  /** Place id from the place graph the robot resolves (`goto.place` accepts it). */
  placeId: string;
  /** ≤ {@link TOUR_HEADLINE_MAX} chars — the stop's name on the card and in the timeline. */
  headline: string;
  /**
   * ≤ {@link TOUR_TALK_TRACK_MAX} chars, authored. Said VERBATIM, chunked into
   * ≤2-sentence `present` blocks so the (half-duplex) mic reopens between them
   * — the closest thing to barge-in this stack has.
   */
  talkTrack: string;
  /**
   * ≤ {@link TOUR_FACTS_MAX} × ≤ {@link TOUR_FACT_MAX} chars — the ONLY ground
   * for answering a question at this stop, besides what a `look` can see.
   */
  facts: string[];
  demo?: TourDemo | null;
  /** Seconds to wait for a question after the talk track. */
  dwellS: number;
  /** Ask "shall we go on?" and wait for a yes before walking to the next stop. */
  askToContinue: boolean;
}

export interface TourRoute {
  id: string;
  name: string;
  /** Robot this route is bound to; null = any robot the operator starts it on. */
  robotId: string | null;
  /** DigitalTwin whose place graph the stops reference; null for a robot with a local graph (sim). */
  twinId: string | null;
  /** The tour's default language. A visitor who speaks the other one wins, per turn. */
  language: SpokenLanguage;
  /** Where the robot waits for visitors and returns to when the tour ends. */
  greetingPlaceId: string;
  /** Authored welcome. The AI disclosure is appended by the robot and cannot be removed. */
  greeting: string;
  /** "Shall I show you around? It takes about six minutes." */
  offer: string;
  farewell: string;
  /** ≤ {@link TOUR_SITE_CARD_MAX} facts true anywhere on this tour (what this site is, who runs it). */
  siteCard: string[];
  stops: TourStop[];
  enabled: boolean;
  /** May the robot offer this tour to a person it sees, unprompted? */
  autoGreet: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Who the tour is for. `visitor` = the robot offered it and a person accepted. */
export const TourRunOrigins = ['visitor', 'operator'] as const;
export type TourRunOrigin = (typeof TourRunOrigins)[number];

/**
 * `declined` = the offer was made and answered "no" (not a failure — the most
 * common outcome of a good greeting); `abandoned` = the reply window lapsed or
 * the visitor walked away mid-tour; `skipped` = refused before the robot moved,
 * `reason` says why.
 */
export const TourRunStatuses = [
  'running',
  'done',
  'declined',
  'abandoned',
  'aborted',
  'failed',
  'skipped',
] as const;
export type TourRunStatus = (typeof TourRunStatuses)[number];

export const TourLegStatuses = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type TourLegStatus = (typeof TourLegStatuses)[number];

/**
 * How a visitor question was answered.
 * `grounded` — from the stop's facts or the site card;
 * `from_camera` — from a `look` at the scene in front of the robot;
 * `declined` — the facts did not cover it and the robot said so. THE GOOD
 *   FAILURE: an un-grounded answer would be a defect, this is the alternative;
 * `unanswered` — the robot never got an answer out (planner failure, abort).
 */
export const TourTurnAnswers = ['grounded', 'from_camera', 'declined', 'unanswered'] as const;
export type TourTurnAnswer = (typeof TourTurnAnswers)[number];

export interface TourTurn {
  at: string;
  /** Stop the visitor was standing at, null when asked outside a stop (e.g. during the offer). */
  stopId: string | null;
  question: string;
  answer: string;
  answered: TourTurnAnswer;
  /** Language the turn was conducted in. */
  language: SpokenLanguage;
}

/** What a `demo` block did. `narrated` is a full outcome, never dressed up as a grasp. */
export const TourDemoModes = ['execute', 'narrate'] as const;
export type TourDemoMode = (typeof TourDemoModes)[number];
export const TourDemoStatuses = ['done', 'narrated', 'failed', 'skipped'] as const;
export type TourDemoStatus = (typeof TourDemoStatuses)[number];

export interface TourLegDemo {
  mode: TourDemoMode;
  status: TourDemoStatus;
  skillId: string;
  skillName: string;
  steps?: number | null;
  durationMs?: number | null;
  /** Model version that ran (`execute`) or that last ran this skill (`narrate`). */
  model?: string | null;
  message?: string;
}

export interface TourLeg {
  index: number;
  stopId: string;
  placeId: string;
  name: string;
  status: TourLegStatus;
  startedAt?: string;
  finishedAt?: string;
  /** One line for the timeline: "arrived and said 3 of 3", "goto failed: …". */
  message?: string;
  /** Chunks of the talk track actually spoken / total, so a cut-short stop is visible. */
  spoken?: { said: number; of: number } | null;
  demo?: TourLegDemo | null;
  /** Robot pose (odom frame) when the leg finished — lets the map overlay place the stop marker. */
  pose?: { x: number; y: number; yawDeg: number } | null;
}

export interface TourRun {
  runId: string;
  routeId: string;
  routeName: string;
  robotId: string;
  origin: TourRunOrigin;
  status: TourRunStatus;
  /** Why the run was skipped/declined/abandoned/aborted/failed, in one sentence. */
  reason?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  legs: TourLeg[];
  /**
   * The visitor's questions and what was said back — text only, trust level
   * `untrusted`, swept by the same retention as patrol photos. Empty when
   * `TOUR_TRANSCRIPT_ENABLED=false`.
   */
  turns: TourTurn[];
  language: SpokenLanguage;
  /**
   * Whether the EU AI Act Art. 50 disclosure was actually spoken to this
   * visitor. Recorded rather than assumed: it is the one sentence a compliance
   * record has to be able to prove, and a greeting that failed to reach the
   * speaker did not disclose anything.
   */
  disclosureSpoken: boolean;
  /** Agent Mode plan the run executed as, when it did. */
  planId?: string | null;
}

/** Response of `POST /robots/:id/agent-mode/tour`. */
export interface TourStartResult {
  accepted: boolean;
  runId?: string;
  message: string;
  /**
   * Machine-readable refusal: `disabled`, `no_route`, `busy`, `estop`, `battery`,
   * `place_unknown`, `place_stale`, `damped`, `crash_unacknowledged`, `keepout`,
   * `person_too_close`, `no_stops`.
   */
  reason?: string;
}

/** What `GET /robots/:id/agent-mode/tour` answers — mirrors `PatrolStatus`. */
export interface TourStatus {
  enabled: boolean;
  /** The bound route, or null when host mode has none. */
  route: TourRoute | null;
  /** The run in flight, or null. */
  run: TourRun | null;
  /** A question the robot is waiting for an answer to, or null. */
  pending: { kind: TourQuestionKind; expiresAt: string } | null;
  /** Where the route came from: the server, the disk cache, or nothing. */
  source: 'server' | 'cache' | 'none';
}

/**
 * What the robot is waiting to be answered. Matched by keyword, never by a
 * model: this runs in the gap right after a visitor stops speaking, which is
 * the one place in the stack a 1.2 s planner round-trip is not affordable.
 */
export const TourQuestionKinds = ['offer', 'continue'] as const;
export type TourQuestionKind = (typeof TourQuestionKinds)[number];
