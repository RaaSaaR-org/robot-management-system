/**
 * @file types.ts
 * @description Agent Mode wire contract — block/plan/scene/control-owner shapes
 *              shared verbatim with the server (`server/src/types/agent-mode.types.ts`)
 *              and the app (`app/src/features/agentmode/`). Any change here is a
 *              wire-breaking change and must land in all three at once.
 * @feature agentmode
 * @status live
 */

import type { GeofenceEnforcement } from '../safety/types.js';

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

/** Block kinds only `PatrolRunner` may emit — the planner schema excludes them. */
export const PatrolOnlyBlockKinds = ['patrol', 'capture', 'inspect'] as const;
/** Block kinds only `TourRunner` may emit (TASK-213) — likewise excluded. */
export const HostOnlyBlockKinds = ['tour', 'present', 'demo'] as const;
/**
 * Every kind a runner owns. The planner schema is the complement of this list,
 * so adding a runner-owned kind to {@link AgentBlockKinds} without adding it
 * here is what would let the LLM emit it.
 */
export const RunnerOnlyBlockKinds = [...PatrolOnlyBlockKinds, ...HostOnlyBlockKinds] as const;
export type RunnerOnlyBlockKind = (typeof RunnerOnlyBlockKinds)[number];
/** What the LLM planner is allowed to produce. */
export const PlannerBlockKinds = AgentBlockKinds.filter(
  (k): k is Exclude<AgentBlockKind, RunnerOnlyBlockKind> =>
    !(RunnerOnlyBlockKinds as readonly string[]).includes(k),
) as unknown as readonly [Exclude<AgentBlockKind, RunnerOnlyBlockKind>, ...Exclude<AgentBlockKind, RunnerOnlyBlockKind>[]];

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

/**
 * Languages the robot can be spoken to and answer in — the two the voice
 * service has a Piper voice for (`piper_voice_de` / `piper_voice_en`).
 */
export const SpokenLanguages = ['en', 'de'] as const;
export type SpokenLanguage = (typeof SpokenLanguages)[number];

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
  /**
   * For a `goto` block: whether the navigator planned its route on the
   * occupancy map or is walking by sight (TASK-208). Set when the first plan
   * is made, updated on every re-plan. Optional — older agents never set it.
   */
  nav?: AgentBlockNav;
}

/** How a `goto` is being driven — the card's "planned 3.2 m in 2 segments" / "walking by sight". */
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
 * The navigator's current route (TASK-208): mirrored into {@link AgentModeState}
 * and served on `/map`, where the map panel draws the polyline. Null between
 * navigations. Coordinates are the odometry frame the map is in.
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

export interface AgentPlan {
  id: string;
  robotId: string;
  /** The original utterance. */
  command: string;
  /** A2A context id, when the command arrived over A2A. */
  contextId?: string;
  /**
   * Language the operator SPOKE, when the command came in over the voice
   * channel; absent for typed commands. Everything the robot says out loud
   * about this plan is in this language — the planner's `speak`/`greet` text,
   * the spoken acknowledgement and the spoken outcome. `reasoning`, block
   * results and the whole UI stay English: those are read, not heard, and the
   * operator reading them is not necessarily the one who spoke.
   */
  language?: SpokenLanguage;
  /**
   * The command that started (or interrupted) this plan was SPOKEN.
   *
   * Separate from {@link AgentPlan.language} because a speech client that cannot
   * identify a language still spoke: `language` is an optional label, `spoken`
   * is the channel fact. Once true it stays true for the life of the plan —
   * fail-closed, because a spoken turn's content is `untrusted` for durable
   * memory and a typed follow-up must not launder it.
   */
  spoken?: boolean;
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
   * usually null anyway. `'fleet'` is another robot's position as the server
   * reports it (TASK-207) — a real pose, but nobody's camera saw it. `null`
   * means there is no distance at all, which is never the same as 0.
   */
  distanceSource: 'lidar' | 'vlm-estimate' | 'fleet' | null;
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
  /**
   * How many separate things the last look called by this label — present only
   * when it was more than one.
   *
   * The store is keyed by label, so two doorways in one frame are two real
   * objects competing for the key "door". One of them is kept (the most central
   * — see `dedupeByLabel`), and this records that the choice was made, because
   * "walk to the door" is a different instruction when the robot can see two.
   */
  duplicatesInView?: number;
  note?: string;
}

/**
 * The vocabulary of places (TASK-195). Deliberately a CLOSED, industry-first
 * set: a free-text type is a label nothing can reason about, and the first
 * consumers of this (the initiative gate, the keepout rule) branch on it.
 * Room-shaped types are a later additive extension — house rooms ship as
 * `cell` until then rather than inventing a type the set does not have.
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

/**
 * Where a place's geometry came from. `surveyed` is a hand-authored or
 * instrument-derived map, `observed` was inferred by the robot itself,
 * `declared` was asserted by an operator. Rendered next to the place id so a
 * reader can tell a measured footprint from someone's say-so.
 */
export const PlaceSources = ['surveyed', 'observed', 'declared'] as const;
export type PlaceSource = (typeof PlaceSources)[number];

/**
 * How much the robot's belief about its place is worth. `stale` means the pose
 * that produced it has accumulated more translation than the drift budget
 * without a re-anchor — the geometry still says "AISLE-3", but the pose fed
 * into it has had no correction for a long walk.
 */
export const PlaceConfidences = ['confident', 'stale'] as const;
export type PlaceConfidence = (typeof PlaceConfidences)[number];

/**
 * The place the robot believes it is standing in.
 *
 * `null` on {@link SceneMemory.place} means UNKNOWN, and UNKNOWN is never
 * silently replaced by the last known place — the same honesty rule
 * `distanceSource` and `forwardClearanceM` already live by. A consumer that
 * renders a stale place as the current one is telling an operator the robot is
 * somewhere it is not.
 */
export interface ScenePlace {
  /** Stable id from the place graph, e.g. `AISLE-3`. */
  id: string;
  /** Human name, e.g. `Aisle 3`. */
  name: string;
  placeType: PlaceType;
  confidence: PlaceConfidence;
  source: PlaceSource;
}

export interface SceneMemory {
  robotId: string;
  /** Free-text "what I currently see", straight from the VLM. */
  currentView: string;
  entities: SceneEntity[];
  personVisible: boolean;
  /**
   * Named place the robot is standing in (TASK-195), or null for UNKNOWN.
   *
   * Optional so an older agent that does not resolve places stays structurally
   * compatible; absent and null mean the same thing — "we do not know" — and
   * neither may be rendered as the last place the robot was in.
   */
  place?: ScenePlace | null;
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

/**
 * What this boot inherited from the last one (TASK-196).
 *
 * Non-null means a human has not yet acknowledged it. It exists so the panel
 * can say "this robot came back latched / did not shut down cleanly" and offer
 * one click to clear it — without that, the first operator who meets a robot
 * that came back latched deletes its state file to "fix" it, which is a worse
 * outcome than the bug durable safety state exists to prevent.
 */
export interface AgentRecoveryState {
  /** The previous incarnation never wrote its `endedAt`: it crashed or was killed. */
  fromCrash: boolean;
  /** The E-Stop latch was read back off disk, not taken in this process. */
  estopLatched: boolean;
  /** ISO-8601 timestamp of the boot that inherited it. */
  at: string;
}

/**
 * Who the robot is and what it has been through — assembled per turn from
 * `IDENTITY.md`, the boot lineage (`incarnations.jsonl`, TASK-196) and the
 * journal (TASK-197), with ZERO tool calls (TASK-198).
 *
 * It spans restarts on purpose: a process that came up thirty seconds ago can
 * still say which life it is on and how the last one ended, because both are on
 * disk. That is the cheapest thing that makes a restarted agent continuous —
 * and the reason every clause of the robot's self-description is checkable
 * against a file rather than produced by a model.
 */
export interface AgentSelfState {
  /** What a person calls this robot. Agent-writable in `IDENTITY.md`. */
  name: string;
  emoji: string | null;
  /** The machine this is — model string from configuration, never the file. */
  unit: string;
  robotId: string;
  operator: string | null;
  site: string | null;
  /**
   * There is no `IDENTITY.md`: this robot has not been named and `name` is only
   * the configured fallback. NOT an error — it is the state the naming ritual
   * exists to leave.
   */
  bootstrapRequired: boolean;
  /** This process's boot id, or null before the lineage was opened. */
  bootId: string | null;
  /**
   * Which life this is: the lifetime boot ordinal carried in the lineage line
   * itself, so it survives the file rotating at `INCARNATION_MAX_LINES`.
   *
   * It never decreases. It used to — it was the line's INDEX in a ring buffer,
   * and it went 199 → 197 across a restart when rotation ate two lines.
   */
  incarnation: number;
  /**
   * Whether {@link incarnation} is an exact ordinal.
   *
   * `false` means it is a lower bound — the counter was seeded from a lineage
   * that had already rotated without one, or the lineage was unreadable — and
   * the number must then be rendered as "at least N starts", never as
   * "incarnation N".
   */
  incarnationExact: boolean;
  uptimeS: number;
  /**
   * How the PREVIOUS incarnation ended, or null when there was none.
   * `exit: 'crash'` means the line never got an `endedAt` — a statement about
   * the software's exit, not about the robot falling over.
   */
  lastShutdown: { at: string | null; exit: string; place: string | null } | null;
  place: string | null;
  poseSource: string | null;
  batteryPct: number | null;
  controlOwner: ControlOwner;
  damped: boolean;
  estopLatched: boolean;
  /** Distinct plans and failed blocks journalled in the last 24 h. */
  plansLast24h: number;
  failuresLast24h: number;
  memoryEntries: number;
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
  /**
   * Set when this boot inherited a latch or an unclean shutdown; null once a
   * human has cleared it (the panel's reset does that). Optional so an older
   * server/app mirror stays structurally compatible — absent means "this agent
   * does not report recovery", never "nothing to report".
   */
  recovered?: AgentRecoveryState | null;
  /**
   * Who this robot is and what it has been through (TASK-198). Optional so an
   * older robot-agent stays structurally compatible; absent means "this agent
   * does not report a self", which is not the same as a robot with no identity
   * — that case is `bootstrapRequired` on a present `self`.
   */
  self?: AgentSelfState | null;
  /**
   * The robot's own occupancy map, in summary (TASK-206). Optional so an older
   * robot-agent stays structurally compatible; absent means "this agent does
   * not report a map", `null` means map building is disabled. The grid itself
   * is NOT mirrored (too big for a 15 s re-push) — read it from the agent's
   * `GET /api/v1/robots/:id/map`.
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
   * no `goto` is running. Optional so an older robot-agent stays structurally
   * compatible.
   */
  nav?: AgentNavPlan | null;
  /**
   * Whether the keepout geofence is actually fencing (TASK-201).
   *
   * Optional, and ABSENT MUST RENDER AS NOTHING — never as `enforcing`. An
   * older agent that does not report this has not told us the fence works; it
   * has told us nothing, and the defect this field exists to end was a fence
   * that silently stopped fencing. A mirror that defaulted the field to
   * `enforcing` would reproduce the bug on the wire.
   */
  geofence?: AgentGeofenceState | null;
}

/**
 * The geofence's own state, as carried in {@link AgentModeState} (TASK-201).
 *
 * `reason` is the evaluator's own sentence for why the fence is not fencing —
 * null while it is. The operator-facing label is {@link
 * AgentGeofenceState.enforcement} and is derived on the robot from a typed
 * cause, never by matching this prose: `reason` is for a human to read, not for
 * a consumer to branch on.
 */
export interface AgentGeofenceState {
  enforcement: GeofenceEnforcement;
  reason: string | null;
}

/** Summary of the robot-built occupancy map that rides in {@link AgentModeState}. */
export interface AgentMapSummary {
  /** Cells classified free or occupied (the rest are unknown). */
  knownCells: number;
  occupiedCells: number;
  /** ISO time of the last integrated cloud, null when nothing has been integrated. */
  lastIntegratedAt: string | null;
}

/**
 * What a periodic liveness re-assertion carries: every field of {@link
 * AgentModeState} EXCEPT `plan` and `scene` (TASK-200).
 *
 * The re-push exists to DATE the mirror, not to restate the plan. Its snapshot
 * is taken on a clock and delivered fire-and-forget, so it can overtake an
 * event emitted after it — and a snapshot that still says `status: 'running'`
 * landing after `agent:plan:finished` reverts every downstream mirror to a plan
 * that will never emit another event. Omitting the field entirely (as opposed
 * to sending `null`, which means "there is no plan") is what makes the
 * re-assertion say nothing about the plan at all.
 */
export type AgentModeLivenessState = Omit<AgentModeState, 'plan' | 'scene'>;

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
  retention: {
    retentionDays: number;
    source: 'policy' | 'fallback';
    legalHold: boolean;
    /** False when the platform never answered the legal-hold question at all. */
    legalHoldKnown?: boolean;
    /** Why the platform's policy was not applied, when it was not. */
    error?: string | null;
  } | null;
  updatedAt: string;
}

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
  /**
   * A full snapshot on a real state CHANGE; the plan/scene-less {@link
   * AgentModeLivenessState} on a periodic re-assertion. Consumers must treat an
   * absent `state.plan` as "no opinion about the plan", never as "no plan".
   */
  state?: AgentModeState | AgentModeLivenessState;
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
  timestamp: string;
}

/**
 * What a submitted command actually became. `message` says the same thing in
 * English prose written for the timeline; this says it in a form a caller can
 * branch on.
 *
 * It exists for the SPOKEN path. A voice client cannot read the English message
 * aloud — the operator may be speaking German, and "E-Stop: the running plan was
 * discarded and the robot was damped." through a German TTS voice is the worst
 * possible rendering of the one reply that has to land instantly. The codes let
 * the narrator say the same fact in the operator's own language.
 */
export type AgentCommandOutcome =
  /** A new plan was created; `planId` is set and the blocks are being planned. */
  | 'planned'
  /** Folded into the already-running plan as an interrupt; `planId` is THAT plan. */
  | 'folded'
  /** A bare stop word — the E-Stop was taken, no planner involved. */
  | 'estop'
  /**
   * An operator STATEMENT about where the robot is ("you are in aisle 3"),
   * TASK-200. The place belief was re-anchored to `source: 'declared'` and the
   * drift budget reset; nothing was planned and nothing moved.
   */
  | 'reanchored'
  | 'empty'
  | 'disabled'
  /** An E-Stop latch (ours or the SafetyMonitor's) forbids driving. */
  | 'estop_latched'
  /** A stopped plan is still finishing its in-flight block. */
  | 'winding_down'
  /** Something other than the agent holds the control lock. */
  | 'busy'
  /**
   * Host mode (TASK-213) replied without planning anything: a visitor's yes or
   * no to the tour offer, a question taken and queued for the next gap, or a
   * goodbye that ended the tour. Distinct from `planned` because nothing is
   * going to move, and distinct from `refused` because the robot did the thing
   * that was asked of it.
   */
  | 'answered'
  /**
   * Host mode was asked to start a tour and would not (battery, an unknown
   * place, a person standing too close). The reason is in `message` and was
   * spoken to whoever asked.
   */
  | 'refused';

/** Response of `POST /robots/:id/agent-mode/command`. */
export interface AgentCommandResult {
  accepted: boolean;
  planId?: string;
  message: string;
  /** Machine-readable form of `message` — see {@link AgentCommandOutcome}. */
  outcome?: AgentCommandOutcome;
  /**
   * The earlier interrupt this one displaced, when `outcome` is `folded`. The
   * operator has to be told: an accepted order that silently evaporates is one
   * they will wait for forever.
   */
  replacedCommand?: string;
  /**
   * E-Stop paths only: whether StopMove AND Damp were acknowledged by the
   * robot. `false` means the latch is set — no further blocks will run — but
   * the base was never told, so it may still be executing up to a minute of
   * already-commanded velocity. The distinction has to survive all the way to
   * the operator; a banner that says "damped" when it isn't is the one message
   * nobody can afford to have wrong.
   */
  delivered?: boolean;
  /** Why delivery failed, when `delivered` is false. */
  deliveryError?: string;
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
