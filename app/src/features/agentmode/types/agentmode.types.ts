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

/** An ephemeral plan — never persisted, never a `SkillChain`. */
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

/**
 * Closed vocabulary of place types (TASK-195). Industry-first; house rooms ship
 * as `cell` until room-shaped types are added additively.
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
 * `stale` means the pose behind the place has drifted further than the budget
 * without a re-anchor. The map is still right; the pose fed into it is old.
 */
export type PlaceConfidence = 'confident' | 'stale';

/**
 * The place the robot believes it is standing in (TASK-195).
 *
 * `null` means UNKNOWN and MUST render as "Place unknown", visually distinct
 * from a known place — never as an empty string and never as the last place the
 * robot was in.
 */
export interface ScenePlace {
  /** Stable id from the robot's place graph, e.g. `AISLE-3`. */
  id: string;
  name: string;
  placeType: PlaceType;
  confidence: PlaceConfidence;
  source: PlaceSource;
}

/** In-memory scene memory — entity list plus a free-text "what I see". */
export interface SceneMemory {
  robotId: string;
  currentView: string;
  entities: SceneEntity[];
  personVisible: boolean;
  /**
   * Named place the robot is standing in, or null for UNKNOWN. Optional because
   * an older agent omits the field entirely; absent and null are the same
   * answer — "we do not know" — and the panel renders both as unknown.
   */
  place?: ScenePlace | null;
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

/**
 * What the robot's current boot inherited from its previous one (TASK-196).
 *
 * The agent persists its E-Stop latch, so a robot that was stopped comes back
 * stopped — and refuses to move until someone clears it. Non-null while that is
 * still unacknowledged; the panel renders it as a badge with a one-click reset.
 */
export interface AgentRecoveryState {
  /** The previous process never shut down cleanly: it crashed or was killed. */
  fromCrash: boolean;
  /** The E-Stop latch was restored from disk rather than taken in this session. */
  estopLatched: boolean;
  /** ISO timestamp of the boot that inherited it. */
  at: string;
}

/**
 * Who the robot is and what it has been through (TASK-198).
 *
 * Mirrored verbatim from `robot-agent/src/agent-mode/types.ts`. The robot
 * assembles it per turn from its own `IDENTITY.md`, boot lineage and journal —
 * every field here is read from a file on the robot's disk, so the header line
 * this renders makes only claims an operator can go and check.
 */
export interface AgentSelfState {
  /** What a person calls this robot. */
  name: string;
  emoji: string | null;
  /** The machine this is — from the robot's configuration, never from the file. */
  unit: string;
  robotId: string;
  operator: string | null;
  site: string | null;
  /** No `IDENTITY.md` yet: the robot has not been named and is asking. */
  bootstrapRequired: boolean;
  bootId: string | null;
  /**
   * Which life this is — the lifetime boot ordinal the robot writes into its
   * lineage line, so it survives that file rotating. It never decreases.
   */
  incarnation: number;
  /**
   * Whether {@link incarnation} is exact rather than a lower bound.
   *
   * Optional, and absence means NOT exact: a snapshot from an agent that
   * predates the counter carries a floor derived from a ring buffer, and a
   * floor must not be rendered as an ordinal.
   */
  incarnationExact?: boolean;
  uptimeS: number;
  /** `exit: 'crash'` means the previous process never wrote its shutdown line. */
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

/** Last known Agent Mode state for one robot. */
export interface AgentModeState {
  robotId: string;
  enabled: boolean;
  controlOwner: ControlOwner;
  /**
   * The running plan, `null` when there is none — and ABSENT when the snapshot
   * is a periodic liveness re-assertion, which says nothing about the plan at
   * all. Absent must keep whatever the store already has; only `null` means
   * "this robot has no plan".
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
  /**
   * Set when the robot came back latched, or from an unclean shutdown; null
   * once an operator cleared it. Optional: an older agent omits it, which means
   * "this agent does not report recovery", never "nothing to report".
   */
  recovered?: AgentRecoveryState | null;
  /**
   * Who this robot is. Optional: an older agent omits it, which means "this
   * agent does not report a self", never "this robot has no identity" — a
   * robot that genuinely has none reports `self.bootstrapRequired`.
   */
  self?: AgentSelfState | null;
  /**
   * Summary of the robot's own occupancy map (TASK-206). Optional: an older
   * agent omits it ("does not report a map"); `null` means map building is
   * disabled on that agent. The grid itself is never mirrored — it lives on
   * the agent's `GET /robots/:id/map`.
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
  /** Cells classified free or occupied; the rest of the grid is unknown. */
  knownCells: number;
  occupiedCells: number;
  /** ISO time of the last integrated LiDAR cloud, null when none yet. */
  lastIntegratedAt: string | null;
}

// ============================================================================
// ROBOT MAP (TASK-206/207) — `GET /robots/:id/agent-mode/map`
// ============================================================================

/** The occupancy grid on the wire: Int8 log-odds × 25, base64, row 0 = lowest y. */
export interface RobotMapGrid {
  version: 1;
  frame: 'odom';
  frameId: string | null;
  /** Metres per cell. */
  resolution: number;
  /** World coordinates of the outer corner of cell (0, 0). */
  originX: number;
  originY: number;
  width: number;
  height: number;
  encoding: 'int8-logodds-b64';
  cells: string;
  /** Classification thresholds in log-odds (unscaled). */
  occupiedAbove: number;
  freeBelow: number;
  poseCount: number;
  lastIntegratedAt: string | null;
  knownCells: number;
  occupiedCells: number;
}

/** Another robot, already filtered to OUR frame by the agent. */
export interface RobotMapPeer {
  robotId: string;
  name: string;
  x: number;
  y: number;
  headingDeg: number | null;
  footprintRadiusM: number;
  place: string | null;
  updatedAt: string | null;
}

/** A keep-out polygon from the place graph, in map coordinates (only when registered). */
export interface RobotMapKeepout {
  id: string;
  name: string;
  polygon: Array<[number, number]>;
}

/**
 * The robot's own map, as the agent serves it. `frame` is the whole caveat:
 * the grid inherits odometry drift; `keepouts` is `[]` unless the place graph
 * is registered to that odometry (`registered`).
 */
export interface RobotMapPayload {
  ok: true;
  frame: 'odom';
  frameId: { kind: 'sim' | 'odom'; id: string } | null;
  /** Null until the first cloud has been integrated. */
  grid: RobotMapGrid | null;
  pose: { x: number; y: number; yawDeg: number; source: string; atMs: number } | null;
  place: ScenePlace | null;
  registered: boolean;
  registrationReason: string | null;
  keepouts: RobotMapKeepout[];
  peers: RobotMapPeer[];
  /** Peers the agent dropped for being in another odometry frame. */
  peersDropped: number;
  peersEnabled: boolean;
  /** The navigator's current route (TASK-208); absent on an older agent, null between gotos. */
  nav?: AgentNavPlan | null;
}

/**
 * How the last map read went. `disabled` is the ROBOT's answer (map building
 * off on that agent, or an older agent without the route); `unavailable` is
 * ours (server/robot unreachable) — and the two must never look alike.
 */
export type RobotMapStatus = 'idle' | 'ok' | 'disabled' | 'unavailable';

/**
 * The robot's own 3-D world cloud (TASK-211): the lidar frames its map
 * integrated, one point per voxel, in the ODOMETRY frame. `positions` is
 * base64 of little-endian Float32 xyz triplets (z up, metres); `returned` may
 * be an even-stride sample of `pointCount` when the request capped it.
 */
export interface RobotCloudPayload {
  ok: true;
  frame: 'odom';
  frameId: string | null;
  voxelM: number;
  pointCount: number;
  returned: number;
  encoding: 'f32-xyz-b64';
  positions: string;
  frames: number;
  lastIntegratedAt: string | null;
  pose: { x: number; y: number; yawDeg: number; source: string; atMs: number } | null;
}

/**
 * What `GET /robots/:id/agent-mode` answers: the state plus WHEN the server's
 * in-memory mirror last heard it (TASK-200).
 *
 * Server metadata, not the robot's — which is why it is a separate type and not
 * a field on {@link AgentModeState}. A pushed `agent:state:changed` carries its
 * own timestamp and never carries this.
 *
 * `null` or absent means the server cannot say how old the snapshot is. That is
 * an UNKNOWN age, and must be rendered as one: stamping the moment of the fetch
 * instead is what made a 68-minute-old snapshot of a dead process read as
 * "just now".
 */
export interface MirroredAgentModeState extends AgentModeState {
  /**
   * When the server last ingested ANY event for this robot — proof the pushing
   * process was alive then, whatever it said. NOT the age of this body: a
   * plan/block/scene event moves it and leaves the snapshot untouched.
   */
  mirroredAt?: string | null;
  /**
   * When the server last ingested a SNAPSHOT — the age of the fields in this
   * body, `self` included. This is the one to date the header line by.
   */
  stateMirroredAt?: string | null;
  /**
   * The server's clock as it wrote this response.
   *
   * The stamps above are in the server's frame; this browser's is a different
   * one. Subtracting them from `Date.now()` measures the skew between two
   * machines as much as the age of the data — a server two minutes ahead
   * re-hides a stale snapshot as "just now", one 90 s behind paints every fresh
   * read as "cached". With this, the age is taken inside the server's frame and
   * only then carried over.
   */
  serverNow?: string | null;
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
  /** The durable memory workspace changed — carries {@link AgentMemoryDigest}. */
  'agent:memory:updated',
  /** Patrol run lifecycle (TASK-212) — carries {@link AgentModeEvent.patrol}. */
  'agent:patrol:started',
  'agent:patrol:leg',
  'agent:patrol:finished',
  /** A confirmed finding (TASK-212) — carries {@link AgentModeEvent.finding} (+ `patrol`). */
  'agent:finding:detected',
  'agent:finding:confirmed',
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
  /** Set on `agent:memory:updated` only. */
  memory?: AgentMemoryDigest;
  /** Set on `agent:patrol:*` and `agent:finding:*` (TASK-212): the run as of this event. */
  patrol?: PatrolRun;
  /** Set on `agent:finding:*` only. */
  finding?: PatrolFinding;
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
 * Body of `POST /robots/:id/identity` — the naming ritual's non-conversational
 * door (TASK-198).
 *
 * Deliberately only these four: `Robot-Id`, `Serial`, `Unit` and `BODY.md` are
 * regenerated from the robot's configuration at every boot and the robot
 * refuses to take them from a client. `null` clears a field; omitting it leaves
 * it untouched. The labels are capitalised because they are the `IDENTITY.md`
 * headings the robot writes, and the route matches on them.
 */
export interface AgentIdentityPatch {
  Name?: string | null;
  Emoji?: string | null;
  Operator?: string | null;
  Site?: string | null;
}

/** Response of `POST /robots/:id/identity`. */
export interface AgentIdentityResponse {
  ok: boolean;
  /** The card as it now stands on the robot's disk. */
  identity?: Record<string, unknown>;
  /** The self the robot reports after the write — adopted verbatim. */
  self?: AgentSelfState | null;
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

/** Which side holds the E-Stop latch — see `AgentModeState.estopSource`. */
export type AgentEstopSource = 'agent' | 'safety' | null;

/**
 * Whether this console actually knows the bound robot's Agent Mode state.
 *
 * `GET /robots/:id/agent-mode` answers three different things and the UI has to
 * tell them apart:
 *
 * - `200` — a state the ROBOT asserted (server mirror hit, or a live fallback
 *   read). Everything the page renders is backed by it → `'known'`.
 * - `404 {error:'No agent mode state for robot'}` — this server has no such
 *   robot. There is nothing to show and nothing to be wrong about, so the empty
 *   state is a complete answer → also `'known'`.
 * - `502 {code:'AGENT_STATE_UNAVAILABLE'}` — the robot EXISTS and could not be
 *   asked: offline, timed out, refused by its personal-data gate, or answered
 *   with something that was not a state. Mode, plan and E-Stop latch are then
 *   ALL unknown → `'unreachable'`.
 *
 * The distinction is a safety one. Rendering `'unreachable'` with the defaults
 * (`enabled:false, estopActive:false`) tells an operator "Agent Mode off,
 * E-Stop clear" when the truth is "I have no idea what this robot is doing" —
 * a false-safe display, and the worst direction to fail in.
 */
export type AgentStateReachability = 'known' | 'unreachable';

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
  /**
   * Set on a command the robot HEARD rather than one that was typed here, with
   * the language it was heard in. The distinction is worth showing: a spoken
   * command was transcribed by a speech model and may not be the words the
   * operator actually said.
   */
  spokenLanguage?: SpokenLanguage;
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
  /**
   * Which latch holds the E-Stop: `'agent'` is Agent Mode's own STOPP latch,
   * `'safety'` the robot's SafetyMonitor (protective / fleet stop) — the agent
   * refuses commands for either, and one Reset E-Stop clears both. Null while
   * no latch is held.
   */
  estopSource: AgentEstopSource;
  /** The reason the latching side recorded, when known. */
  estopReason: string | null;
  /**
   * The plan this console's own confirmed STOPP rewrote to "aborted", if any.
   *
   * The one thing that makes a later `agent:block:*` / `agent:plan:*` event
   * stale: it was emitted before the stop landed and would walk that plan back
   * to "running". A latch nobody here set — the SafetyMonitor's protective
   * stop, a fleet E-Stop — finalizes nothing locally and suppresses nothing,
   * because the agent's own `aborted` events are what end the timeline then.
   */
  estopFinalizedPlanId: string | null;
  /**
   * Whether this console knows the robot's Agent Mode state at all. While this
   * is `'unreachable'`, `enabled`, `controlOwner`, `plan` and `estopActive` are
   * the last thing we heard — or the initial defaults — and MUST NOT be
   * rendered as the robot's current truth. See {@link AgentStateReachability}.
   */
  stateReachability: AgentStateReachability;
  /** What the server said when it could not reach the robot; null otherwise. */
  stateUnavailableReason: string | null;
  /** True while the base cannot locomote (damped/sit/zero-torque FSM). */
  damped: boolean;
  /** Last FSM id the base was commanded into; null when never commanded. */
  fsmId: number | null;
  /**
   * What the robot's current boot inherited — a latch that survived a restart,
   * an unclean shutdown — until an operator clears it. Null when there is
   * nothing to acknowledge.
   */
  recovered: AgentRecoveryState | null;
  /**
   * Who the bound robot is and what it has been through. Null until the agent
   * reports one — which is not the same as a robot with no identity.
   */
  self: AgentSelfState | null;
  /**
   * The robot's own map, in summary (TASK-206). `undefined` = the agent does
   * not report one (older agent), `null` = map building disabled on it.
   */
  map: AgentMapSummary | null | undefined;
  /** Where the robot believes it stands (undefined = not reported, null = unknown) */
  place: ScenePlace | null | undefined;
  /** The full map (grid, peers, keepouts) as last fetched by the map panel; null before / when unavailable. */
  robotMap: RobotMapPayload | null;
  robotMapStatus: RobotMapStatus;
  /** Why the last map read failed, in the agent's or server's words. */
  robotMapError: string | null;
  /** ISO time the map panel last got an answer, so a stale map can say so. */
  robotMapFetchedAt: string | null;
  /** The world cloud (TASK-211) as last fetched by the map panel's 3-D view. */
  robotCloud: RobotCloudPayload | null;
  robotCloudStatus: RobotMapStatus;
  robotCloudError: string | null;
  /**
   * When the self snapshot was TAKEN (ISO), or null when that is not known. It
   * answers "how old is what I am looking at", which the snapshot itself
   * cannot: nothing in `AgentSelfState` is a wall-clock timestamp.
   *
   * For a live answer that is the robot's own moment; for a mirror read it is
   * the server's `stateMirroredAt` carried into THIS browser's clock frame
   * (`now - (serverNow - stateMirroredAt)`) — never the moment this tab
   * fetched, which is always now and therefore never an answer, and never the
   * server's raw instant either, which is a foreign clock.
   */
  selfUpdatedAt: string | null;
  /**
   * Whether that snapshot was the robot's own answer — a pushed
   * `agent:state:changed`, or a call the server proxied through to the robot —
   * rather than a read of the server's in-memory mirror, which only moves when
   * the robot pushes and can sit minutes behind it.
   */
  selfLive: boolean;
  /**
   * A mirror read arrived whose age the server did not report (TASK-200).
   *
   * The third answer between "fresh" and "5 min old": the snapshot is real, but
   * how old it is cannot be known from here. Distinct from a plain
   * `selfUpdatedAt === null`, which is the cold state before anything arrived —
   * one renders "age unknown", the other renders nothing at all.
   */
  selfAgeUnknown: boolean;
  /**
   * `bootId` of the last self the ROBOT itself answered with, or null before
   * one. Kept so a mirrored snapshot carrying a DIFFERENT bootId can be named
   * for what it is: not merely stale, but a different process — the observed
   * defect served a dead duplicate agent's identity as the running robot's.
   */
  selfLiveBootId: string | null;
  /**
   * Whether the mirrored self on screen is a LEFTOVER of a different process
   * than the one that last answered us directly.
   *
   * Decided when the snapshot is written, not when it is rendered, because it
   * needs both bootIds AND the snapshot's age — and a fresh mirror from a
   * different bootId is not a leftover at all. It is the current process,
   * pushing: the robot restarted while this tab was elsewhere, and it is our
   * memory of "who last answered" that is out of date. Flagging that would
   * point the warning at the live robot and away from the dead one.
   */
  selfSuperseded: boolean;
  /**
   * What the robot durably remembers, as counts (TASK-197). Null until a digest
   * arrives; never the memory's content, which stays behind the robot's own
   * personal-data gate.
   */
  memory: AgentMemoryDigest | null;
  plan: AgentPlan | null;
  /** Superseded plans, oldest first — keeps older block cards in the chat. */
  planHistory: AgentPlan[];
  scene: SceneMemory | null;
  messages: AgentChatMessage[];
  pendingCommand: AgentPendingCommand | null;
  connectionStatus: WebSocketStatus;
  isLoading: boolean;
  isSending: boolean;
  /** True while a `POST /identity` write is in flight. */
  isSavingIdentity: boolean;
  error: string | null;

  /** Bind the store to a robot (clears per-robot state on change). */
  selectRobot: (robotId: string | null) => void;
  /** Load the last known state + scene memory for a robot. */
  fetchState: (robotId: string) => Promise<void>;
  /**
   * Load the durable-memory digest. Best-effort by design: an unavailable
   * digest leaves the store untouched and raises no error — "we cannot see it"
   * is not "the robot remembers nothing".
   */
  fetchMemory: (robotId: string) => Promise<void>;
  /**
   * Load the robot's own map (TASK-206/207). Polled by the map panel while it
   * is visible. A robot that says "no map" is recorded as `disabled`; a robot
   * that cannot be reached keeps the last map and is recorded as `unavailable`.
   */
  fetchRobotMap: (robotId: string) => Promise<void>;
  /** Fetch the world cloud, `maxPoints` sampled (0 = all) — TASK-211. */
  fetchRobotCloud: (robotId: string, maxPoints?: number) => Promise<void>;
  /**
   * Write Name/Emoji/Operator/Site to the robot's `IDENTITY.md`.
   *
   * @returns true when the robot accepted it; false leaves the reason in `error`
   */
  submitIdentity: (robotId: string, patch: AgentIdentityPatch) => Promise<boolean>;
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
