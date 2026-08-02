/**
 * @file heartbeat.ts
 * @description The robot noticing things while nobody is talking to it: the
 *              tier-0 predicates that run on every idle tick for free, and the
 *              rate-limited tier-1 pass that turns a fired predicate into at
 *              most a sentence. No self-initiated locomotion in v1 — the
 *              allowed-kinds filter is a filter over the plan, not a rule in a
 *              prompt.
 * @feature agentmode
 * @status live
 *
 * WHY THIS FILE IS SHAPED LIKE THIS (TASK-199):
 *
 *  1. **It rides the existing clock.** `IdleWatcher` already has `unref()`, a
 *     re-entrancy guard, a 60 s log throttle and a public `tick()`. A second
 *     timer would hold `index.ts`'s shutdown open and would need all four
 *     guards again, written a second time.
 *  2. **Tier 0 is free.** Every predicate reads a snapshot the caller assembles
 *     from ALREADY-CACHED state — the 2 s `HardwareClient` pose poll (TASK-195),
 *     the scene store, the controller's own flags. A tier-0 tick issues no model
 *     call and no HTTP request; there is a test that asserts exactly that.
 *  3. **It fails closed.** Hermes's goals loop continues when its judge errors.
 *     For an embodied agent that is the failure mode, so every error and every
 *     ambiguity here ends the tick and the robot holds.
 *  4. **The action allowlist is enforced structurally.** The exec-allowlist
 *     literature is explicit that lexical gating is defeatable, so the plan is
 *     FILTERED before it is handed to the executor rather than described to a
 *     model.
 */

import { PLACE_STALE_MS } from '../robot/StatePersistence.js';
import { mayInitiate, SELF_LOCOMOTION_KINDS, type InitiativeVerdict } from './initiative.js';
import { getJournalBootId } from './journal.js';
import type { PlannedBlock } from './planner.js';
import type { AgentBlockKind, PlaceConfidence } from './types.js';
import type { JournalRecord, TrustLevel } from './workspace.js';

/**
 * The only block kinds a heartbeat may execute.
 *
 * A SET, so a block kind added later is refused by default rather than admitted
 * by omission — the same reason `DURABLE_TRUST_LEVELS` is a set (TASK-197).
 * `walk`/`turn`/`goto`/`posture`/`wave` are all absent on purpose: v1 does not
 * move the robot on its own, and the gate for that is this constant plus
 * {@link filterHeartbeatBlocks}, not a sentence in a prompt.
 */
export const HEARTBEAT_ALLOWED_KINDS: ReadonlySet<AgentBlockKind> = new Set<AgentBlockKind>([
  'look',
  'speak',
  'wait',
  'remember',
]);

/** Journal marker for a tier-1 pass that decided to stay quiet. */
export const HEARTBEAT_OK = 'HEARTBEAT_OK';

/** Default `AGENT_HEARTBEAT_MIN_INTERVAL_MS`: at most one tier-1 pass per 5 min. */
export const HEARTBEAT_DEFAULT_MIN_INTERVAL_MS = 300_000;

/** Default `AGENT_HEARTBEAT_BATTERY_PCT`. */
export const HEARTBEAT_DEFAULT_BATTERY_PCT = 20;

/**
 * How long the base may sit damped with nobody doing anything about it before
 * the robot says so. Shorter than this and every ordinary E-Stop → reset →
 * `posture stand` sequence would produce a complaint mid-recovery.
 */
export const DAMPED_UNATTENDED_MS = 5 * 60_000;

/** How long the place may be unknown or stale before the robot says so. */
export const PLACE_LOST_MS = 5 * 60_000;

/**
 * How long after a failed plan the robot may mention it. Long enough that the
 * operator who watched it fail gets to react first — the point of this
 * predicate is the failure nobody was there for.
 */
export const PLAN_FAILED_IDLE_MS = 60_000;

// ---------------------------------------------------------------------------
// Active hours
// ---------------------------------------------------------------------------

/** A local-time window, end-exclusive. `22-6` wraps midnight. */
export interface ActiveHours {
  startHour: number;
  endHour: number;
}

/**
 * Parse `AGENT_HEARTBEAT_ACTIVE_HOURS` (`"8-20"`, `"22-6"`, or empty).
 *
 * `null` means "no window configured", which is ALWAYS ACTIVE. An unparseable
 * value also yields null and is reported by the caller: a typo must not
 * silently switch proactivity off, because a heartbeat that never fires looks
 * exactly like a heartbeat with nothing to say.
 */
export function parseActiveHours(raw: string | undefined): ActiveHours | null {
  const match = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(raw ?? '');
  if (!match) return null;
  const startHour = Number(match[1]);
  const endHour = Number(match[2]);
  if (startHour > 23 || endHour > 23 || startHour === endHour) return null;
  return { startHour, endHour };
}

/** Whether `date`'s LOCAL hour falls inside the window (null = always). */
export function withinActiveHours(hours: ActiveHours | null, date: Date): boolean {
  if (!hours) return true;
  const hour = date.getHours();
  return hours.startHour < hours.endHour
    ? hour >= hours.startHour && hour < hours.endHour
    : hour >= hours.startHour || hour < hours.endHour;
}

// ---------------------------------------------------------------------------
// The two pose predicates
// ---------------------------------------------------------------------------

/**
 * What the robot knows about where its body is, read from the CACHED pose —
 * never from a fresh request. `getLocoOdometry()` has a 2 s timeout and returns
 * null on any hiccup, which is a routine event on this stack, so a tick that
 * asked would both cost an HTTP round-trip and read as "lost" several times an
 * hour.
 */
export interface PoseKnowledge {
  /** A pose sample exists. `false` is UNKNOWN, never "(0, 0)". */
  poseKnown: boolean;
  /**
   * The robot is inside a declared keepout. Only ever true on a KNOWN pose.
   *
   * Set since TASK-200 from `PlaceBelief.insideKeepout`, which is three-valued:
   * an UNDECIDED geofence (no pose, or a pose past its drift budget) arrives
   * here as `false`, and that is safe precisely because of the split below —
   * `protectiveStopRequired` needs `poseKnown && insideKeepout`, while
   * `selfActionAllowed` still refuses on the unknown pose alone.
   */
  insideKeepout: boolean;
}

/**
 * May the robot act ON ITS OWN right now, as far as its pose is concerned?
 *
 * Fails CLOSED: an unknown pose is a refusal. This is one half of the split the
 * task spec calls for — see {@link protectiveStopRequired} for the other half,
 * which reads the same field and reaches the opposite conclusion about
 * `null`. They are two functions rather than one flag consulted twice precisely
 * so that neither can be "simplified" into the other.
 */
export function selfActionAllowed(pose: PoseKnowledge): boolean {
  if (!pose.poseKnown) return false;
  return !pose.insideKeepout;
}

/**
 * {@link selfActionAllowed}, scoped to the block kinds that actually need a
 * pose — exactly the way {@link mayInitiate} scopes its place/damp checks with
 * `SELF_LOCOMOTION_KINDS`.
 *
 * This used to be a gate on the whole tick, which made the heartbeat INERT on
 * every configuration without a place graph: `getPlaceBelief()` returns null
 * when neither `PLACE_GRAPH_PATH` nor `PLACE_TWIN_ID` is set (both default to
 * `''`), so `poseKnown` was false forever and `battery_low`,
 * `workspace_write_failed`, `damped_unattended`, `plan_failed_idle`,
 * `crash_unacknowledged` and every standing intent were unreachable on a
 * default G1 profile. The direction was safe, but "the heartbeat is verified"
 * meant nothing there. A battery warning does not need to know where it is; a
 * `walk` does.
 */
export function poseAllowsSelfAction(kind: AgentBlockKind, pose: PoseKnowledge): boolean {
  if (!SELF_LOCOMOTION_KINDS.has(kind)) return true;
  return selfActionAllowed(pose);
}

/**
 * Must the robot protective-stop right now?
 *
 * Requires a KNOWN pose inside a keepout. An unknown pose is NOT a violation:
 * the sidecar dropping a poll would otherwise damp the base several times an
 * hour, which is a bigger hazard than the geofence it is protecting.
 */
export function protectiveStopRequired(pose: PoseKnowledge): boolean {
  if (!pose.poseKnown) return false;
  return pose.insideKeepout;
}

// ---------------------------------------------------------------------------
// Tier 0 — the predicates
// ---------------------------------------------------------------------------

export const HeartbeatPredicateIds = [
  'crash_unacknowledged',
  'workspace_write_failed',
  'battery_low',
  'damped_unattended',
  'place_lost',
  'plan_failed_idle',
  'intent_matched',
] as const;
export type HeartbeatPredicateId = (typeof HeartbeatPredicateIds)[number];

/**
 * Everything the tier-0 predicates read, assembled by the caller from cached
 * state. Passed in rather than pulled, for the same reason
 * {@link InitiativeContext} is: it keeps this module pure, and it forces the
 * caller to be explicit about what it actually knows.
 */
export interface HeartbeatSnapshot {
  nowMs: number;
  /** TASK-196. `false` = the last shutdown was unclean and nobody cleared it. */
  crashAcknowledged: boolean;
  /** Either latch — ours or the SafetyMonitor's. */
  estopLatched: boolean;
  batteryPercent: number | null;
  damped: boolean;
  pose: PoseKnowledge;
  /** A place graph is configured at all. `false` ⇒ `place_lost` cannot fire. */
  placeConfigured: boolean;
  place: string | null;
  placeConfidence: PlaceConfidence | null;
  /** Age of the place belief in ms, or null when there is none. */
  placeAgeMs: number | null;
  /** From the last frame the idle watcher actually took. */
  personVisible: boolean;
  /** The scene's current view text — the haystack for intent keywords. */
  view: string;
  /** When the last plan FAILED, or null. Cleared by a plan that succeeds. */
  lastPlanFailedAtMs: number | null;
  /** When an operator last did anything at all. */
  lastOperatorTurnAtMs: number | null;
  /** When a durable write last failed (TASK-197), or null. */
  workspaceWriteFailedAtMs: number | null;
  workspaceWriteError: string | null;
}

/**
 * One thing the robot noticed. `message` is first person because it is both
 * journalled and (when somebody is there to hear it) spoken.
 */
export interface HeartbeatFinding {
  id: HeartbeatPredicateId;
  message: string;
  /**
   * How much the sentence is worth if it were ever promoted. A measurement the
   * robot made about itself is `self`; the text of a standing intent was
   * authored by an operator and stays `operator`. Nothing model-authored is
   * produced here at all — see `VLM_CAPTION_BLOCK_KINDS` for that path.
   */
  trust: TrustLevel;
}

/** Durations the monitor derives by watching state change between ticks. */
export interface HeartbeatDurations {
  /** When the base entered its current damped stretch, or null. */
  dampedSinceMs: number | null;
  /** When the place last became unknown-or-stale, or null. */
  placeLostSinceMs: number | null;
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

/** Whether the belief is "no idea where I am" — unknown OR drifted past budget. */
export function isPlaceLost(snapshot: HeartbeatSnapshot): boolean {
  if (!snapshot.placeConfigured) return false;
  if (snapshot.place === null) return true;
  if (snapshot.placeConfidence === 'stale') return true;
  return snapshot.placeAgeMs === null || snapshot.placeAgeMs > PLACE_STALE_MS;
}

/**
 * Every tier-0 predicate, evaluated over cached state. Pure: no I/O, no clock
 * of its own, no model.
 *
 * `crash_unacknowledged` short-circuits the whole list. It is not a report — it
 * is a SUPPRESSOR: a robot that came back from a `kill -9` says nothing on its
 * own until a human has acknowledged that, which is the single most dangerous
 * moment in the system (TASK-196).
 */
export function evaluateHeartbeat(
  snapshot: HeartbeatSnapshot,
  durations: HeartbeatDurations,
  intents: readonly HeartbeatFinding[] = [],
  batteryPct: number = HEARTBEAT_DEFAULT_BATTERY_PCT,
): HeartbeatFinding[] {
  if (!snapshot.crashAcknowledged) {
    return [
      {
        id: 'crash_unacknowledged',
        trust: 'self',
        message:
          'I did not shut down cleanly last time and nobody has cleared that yet, ' +
          'so I am doing nothing on my own until someone does.',
      },
    ];
  }

  const findings: HeartbeatFinding[] = [];

  if (snapshot.workspaceWriteFailedAtMs !== null) {
    findings.push({
      id: 'workspace_write_failed',
      trust: 'self',
      message: `I could not write to my own memory: ${snapshot.workspaceWriteError ?? 'no reason recorded'}.`,
    });
  }

  if (snapshot.batteryPercent !== null && snapshot.batteryPercent < batteryPct) {
    findings.push({
      id: 'battery_low',
      trust: 'self',
      message:
        `My battery is at ${Math.round(snapshot.batteryPercent)}%` +
        (snapshot.place ? ` and I am at ${snapshot.place}.` : '.'),
    });
  }

  if (
    snapshot.damped &&
    !snapshot.estopLatched &&
    durations.dampedSinceMs !== null &&
    snapshot.nowMs - durations.dampedSinceMs > DAMPED_UNATTENDED_MS
  ) {
    findings.push({
      id: 'damped_unattended',
      trust: 'self',
      message:
        `My base has been damped for ${minutes(snapshot.nowMs - durations.dampedSinceMs)} minutes ` +
        'and nobody has stood me back up.',
    });
  }

  if (
    isPlaceLost(snapshot) &&
    durations.placeLostSinceMs !== null &&
    snapshot.nowMs - durations.placeLostSinceMs > PLACE_LOST_MS
  ) {
    findings.push({
      id: 'place_lost',
      trust: 'self',
      message:
        `I have not known where I am for ${minutes(snapshot.nowMs - durations.placeLostSinceMs)} minutes.`,
    });
  }

  if (
    snapshot.lastPlanFailedAtMs !== null &&
    snapshot.nowMs - snapshot.lastPlanFailedAtMs > PLAN_FAILED_IDLE_MS &&
    (snapshot.lastOperatorTurnAtMs === null ||
      snapshot.lastOperatorTurnAtMs < snapshot.lastPlanFailedAtMs)
  ) {
    findings.push({
      id: 'plan_failed_idle',
      trust: 'self',
      message: 'My last plan failed and nothing has happened since.',
    });
  }

  findings.push(...intents);
  return findings;
}

// ---------------------------------------------------------------------------
// Tier 1 — the bounded plan
// ---------------------------------------------------------------------------

export interface HeartbeatPlanInput {
  findings: readonly HeartbeatFinding[];
  snapshot: HeartbeatSnapshot;
}

/**
 * The default tier-1 plan: at most ONE `speak`, and only when somebody is there
 * to hear it.
 *
 * Built from a template rather than by the planner, for the same three reasons
 * `voice-narrator.ts` is templated — latency, a shared GPU, and the fact that a
 * sentence assembled from the predicates that actually fired cannot claim
 * something that did not happen. It is a dep on {@link HeartbeatMonitor} so a
 * future version can hand this to a model without any of the gates below moving.
 */
export function buildHeartbeatPlan(input: HeartbeatPlanInput): PlannedBlock[] {
  // Speaking into an empty aisle is noise. The findings are journalled either
  // way, and a `ServerMirror` push is what an absent operator actually reads.
  if (!input.snapshot.personVisible) return [];
  const text = input.findings.map((f) => f.message).join(' ');
  if (!text) return [];
  return [
    {
      kind: 'speak',
      params: { text },
      reasoning: `Heartbeat: ${input.findings.map((f) => f.id).join(', ')}.`,
    },
  ];
}

export interface HeartbeatFilterResult {
  kept: PlannedBlock[];
  /** Kinds that were removed, in plan order, for the log and the journal. */
  dropped: AgentBlockKind[];
}

/**
 * Drop everything a heartbeat is not allowed to do.
 *
 * Applied to the plan BEFORE it reaches the executor, whoever built it. This is
 * the structural half of "no self-initiated locomotion in v1": a builder (or a
 * model) that emits `walk` does not get a refusal it can argue with, it gets a
 * plan without the `walk` in it.
 */
export function filterHeartbeatBlocks(blocks: readonly PlannedBlock[]): HeartbeatFilterResult {
  const kept: PlannedBlock[] = [];
  const dropped: AgentBlockKind[] = [];
  for (const block of blocks) {
    if (HEARTBEAT_ALLOWED_KINDS.has(block.kind)) kept.push(block);
    else dropped.push(block.kind);
  }
  return { kept, dropped };
}

/** One journal line from the heartbeat. Never a `block` — nothing ran yet. */
export function heartbeatJournalRecord(input: {
  at: string;
  place: string | null;
  trust: TrustLevel;
  msg: string;
  bootId?: string | null;
}): JournalRecord {
  return {
    t: input.at,
    bootId: input.bootId === undefined ? getJournalBootId() : input.bootId,
    kind: 'note',
    planId: null,
    place: input.place,
    trust: input.trust,
    msg: input.msg,
  };
}

// ---------------------------------------------------------------------------
// The monitor
// ---------------------------------------------------------------------------

/** Why a tick ended without doing anything. Surfaced for tests and the log. */
export interface HeartbeatHold {
  reason: string;
  atMs: number;
}

export interface HeartbeatSettings {
  enabled: boolean;
  minIntervalMs: number;
  activeHours: ActiveHours | null;
  batteryPct: number;
  /** Reserved for v2 — self-initiated `goto`. Nothing reads it yet. */
  motion: boolean;
}

export interface HeartbeatDeps {
  settings: HeartbeatSettings;
  /** Cached state. MUST NOT do I/O: it is called on every 3 s idle tick. */
  snapshot: () => HeartbeatSnapshot;
  /**
   * Standing intents that matched this tick (TASK-199 §3). Deterministic
   * keyword/place comparison — zero model calls in the matching path.
   */
  matchIntents?: (snapshot: HeartbeatSnapshot) => HeartbeatFinding[];
  /** Overridable tier-1 builder; defaults to {@link buildHeartbeatPlan}. */
  buildPlan?: (input: HeartbeatPlanInput) => PlannedBlock[];
  /**
   * Start the plan through the controller's ONE proactive path
   * (`isIdleWatchEligible()` → `lock.claim('agent')` → `runPlan(…, true)`).
   * Returns false when it did not start, which is not an error — something else
   * took control between the snapshot and here.
   */
  run: (command: string, blocks: PlannedBlock[]) => boolean;
  /** Append one journal line. Best-effort; never throws. */
  journal?: (record: JournalRecord) => void;
  /**
   * True while a voice turn is in flight. The voice pipeline is half-duplex
   * with a speaking-span refcount that MUTES the microphone, in a system where
   * "stopp" is the stop word — an unsolicited utterance landing mid-turn would
   * take the operator's stop word away from them.
   */
  voiceBusy?: () => boolean;
  /**
   * Protective stop, when {@link protectiveStopRequired} says so.
   *
   * STILL deliberately unwired in production after TASK-200, and that is the
   * point of the task's "do not add a new stop path" rule: the geofence stop is
   * taken by `SafetyMonitor.updateGeofence()` off the 2 s pose poll, which runs
   * whether or not Agent Mode is enabled and whether or not the heartbeat is on.
   * Hooking a second trigger up here would give one boundary two enforcers with
   * different clocks. What the heartbeat does with `insideKeepout` is refuse to
   * act on its own — which is a different decision, and its own.
   */
  protectiveStop?: (reason: string) => void;
  now?: () => number;
  /** Injected so the active-hours window can be tested without the wall clock. */
  clock?: () => Date;
}

/**
 * The pulse. Driven by `IdleWatcher`'s existing tick — it owns no timer of its
 * own, on purpose (see the file header).
 */
export class HeartbeatMonitor {
  private readonly deps: HeartbeatDeps;
  private readonly now: () => number;
  private readonly clock: () => Date;
  private dampedSinceMs: number | null = null;
  private placeLostSinceMs: number | null = null;
  private lastTierOneAtMs: number | null = null;
  private lastHoldValue: HeartbeatHold | null = null;
  private lastHoldLoggedAt = 0;

  constructor(deps: HeartbeatDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Why the last tick held, or null when it did not. */
  lastHold(): HeartbeatHold | null {
    return this.lastHoldValue ? { ...this.lastHoldValue } : null;
  }

  /** Wall clock of the last tier-1 pass, or null when there has been none. */
  lastTierOneAt(): number | null {
    return this.lastTierOneAtMs;
  }

  /**
   * One pulse. Synchronous by design: tier 0 is pure, and starting a tier-1
   * plan is fire-and-forget through {@link HeartbeatDeps.run} — so a heartbeat
   * can never be the thing that makes an idle tick slow.
   */
  tick(): void {
    if (!this.deps.settings.enabled) return;

    let snapshot: HeartbeatSnapshot;
    try {
      snapshot = this.deps.snapshot();
    } catch (err) {
      // Fail closed: a robot that cannot read its own state does not act on it.
      this.hold(`I could not read my own state: ${message(err)}`);
      return;
    }

    this.trackDurations(snapshot);

    // The crash flag suppresses ALL proactivity, before anything else is even
    // considered — including before the pose gate, so that a robot which came
    // back from a kill -9 with no sidecar reports the crash as its reason and
    // not the missing pose.
    if (!snapshot.crashAcknowledged) {
      this.hold('I did not shut down cleanly and nobody has cleared that yet.');
      return;
    }
    if (snapshot.estopLatched) {
      this.hold('An E-Stop is latched.');
      return;
    }

    // TWO predicates over the same cached pose, reaching opposite conclusions
    // about UNKNOWN. Do not collapse them.
    if (protectiveStopRequired(snapshot.pose)) {
      const reason = 'A known pose puts me inside a keepout.';
      this.hold(reason);
      this.deps.protectiveStop?.(reason);
      return;
    }
    // The OTHER half — `selfActionAllowed` — is deliberately NOT a gate on the
    // whole tick: see {@link poseAllowsSelfAction}, which applies it per block
    // kind in `runTierOne`. Standing inside a keepout still ends the tick above,
    // because that is a stop, not a question about what may be said.

    if (!withinActiveHours(this.deps.settings.activeHours, this.clock())) {
      this.hold('Outside my active hours.');
      return;
    }

    // Yield to a live voice turn WITHOUT consuming the rate limit: the operator
    // is mid-sentence, and the right answer is to try again in three seconds,
    // not to burn the one tier-1 pass this five minutes had.
    if (this.deps.voiceBusy?.()) {
      this.hold('Someone is talking to me.');
      return;
    }

    let findings: HeartbeatFinding[];
    try {
      const intents = this.deps.matchIntents?.(snapshot) ?? [];
      findings = evaluateHeartbeat(
        snapshot,
        { dampedSinceMs: this.dampedSinceMs, placeLostSinceMs: this.placeLostSinceMs },
        intents,
        this.deps.settings.batteryPct,
      );
    } catch (err) {
      this.hold(`I could not work out what to check: ${message(err)}`);
      return;
    }

    // Nothing fired. This is the overwhelmingly common case and it must cost
    // nothing at all — no journal line, no log, no plan.
    if (findings.length === 0) {
      this.lastHoldValue = null;
      return;
    }

    if (
      this.lastTierOneAtMs !== null &&
      snapshot.nowMs - this.lastTierOneAtMs < this.deps.settings.minIntervalMs
    ) {
      this.hold('I already said something recently.');
      return;
    }

    this.runTierOne(snapshot, findings);
  }

  /** Reset the edge clocks — used when the mode is toggled off/on. */
  reset(): void {
    this.dampedSinceMs = null;
    this.placeLostSinceMs = null;
    this.lastTierOneAtMs = null;
    this.lastHoldValue = null;
  }

  /**
   * The bounded pass. Entered at most once per `minIntervalMs`, and the limiter
   * is consumed even when the pass ends up saying nothing — otherwise the next
   * tick, three seconds later, would try the whole thing again.
   */
  private runTierOne(snapshot: HeartbeatSnapshot, findings: HeartbeatFinding[]): void {
    this.lastTierOneAtMs = snapshot.nowMs;
    this.lastHoldValue = null;
    const at = new Date(snapshot.nowMs).toISOString();

    // Journal FIRST, and unconditionally. Journal-only is the default
    // escalation channel: everything below can decide not to speak, and none of
    // it may decide not to record.
    for (const finding of findings) {
      this.write({ at, place: snapshot.place, trust: finding.trust, msg: `${finding.id}: ${finding.message}` });
    }

    let built: PlannedBlock[];
    try {
      built = (this.deps.buildPlan ?? buildHeartbeatPlan)({ findings, snapshot });
    } catch (err) {
      this.hold(`I could not work out what to say: ${message(err)}`);
      return;
    }

    const { kept, dropped } = filterHeartbeatBlocks(built);
    if (dropped.length > 0) {
      const msg = `refused to ${dropped.join('/')} on my own: a heartbeat may only ${[...HEARTBEAT_ALLOWED_KINDS].join('/')}.`;
      console.warn(`[AgentMode/Heartbeat] ${msg}`);
      this.write({ at, place: snapshot.place, trust: 'self', msg });
    }

    if (kept.length === 0) {
      // Found something, chose to stay quiet. Recorded, so a reader can tell
      // this apart from a heartbeat that never ran.
      this.write({
        at,
        place: snapshot.place,
        trust: 'self',
        msg: `${HEARTBEAT_OK}: ${findings.length} finding(s), nothing said out loud.`,
      });
      return;
    }

    // The initiative gate (TASK-196), asked per block kind and with
    // `origin: 'self'`. This is its first caller. A single refusal ends the
    // tick — a partially executed proactive plan is exactly the ambiguity the
    // fail-closed rule exists to forbid.
    const context = {
      estopLatched: snapshot.estopLatched,
      crashAcknowledged: snapshot.crashAcknowledged,
      batteryPercent: snapshot.batteryPercent,
      place: snapshot.place,
      placeAgeMs: snapshot.placeAgeMs,
      damped: snapshot.damped,
    };
    for (const block of kept) {
      if (!poseAllowsSelfAction(block.kind, snapshot.pose)) {
        const reason = 'I do not know where I am, so I am not moving on my own.';
        this.hold(reason);
        this.write({ at, place: snapshot.place, trust: 'self', msg: reason });
        return;
      }
      const verdict: InitiativeVerdict = mayInitiate(block.kind, 'self', context);
      if (!verdict.ok) {
        this.hold(verdict.reason);
        this.write({ at, place: snapshot.place, trust: 'self', msg: verdict.reason });
        return;
      }
    }

    const command = `(heartbeat) ${findings.map((f) => f.id).join(', ')}`;
    if (!this.deps.run(command, kept)) {
      this.hold('Something else had control when I tried to say it.');
    }
  }

  /** Note when the base entered damp / when the place went unknown. */
  private trackDurations(snapshot: HeartbeatSnapshot): void {
    if (snapshot.damped) this.dampedSinceMs ??= snapshot.nowMs;
    else this.dampedSinceMs = null;

    if (isPlaceLost(snapshot)) this.placeLostSinceMs ??= snapshot.nowMs;
    else this.placeLostSinceMs = null;
  }

  /**
   * End the tick and hold. Logged at most once a minute — the idle tick runs
   * every 3 s and a robot that is holding is holding for minutes at a time.
   */
  private hold(reason: string): void {
    const now = this.now();
    this.lastHoldValue = { reason, atMs: now };
    if (now - this.lastHoldLoggedAt > 60_000) {
      this.lastHoldLoggedAt = now;
      console.log(`[AgentMode/Heartbeat] holding: ${reason}`);
    }
  }

  /** A journal write must never take the heartbeat down with it. */
  private write(input: { at: string; place: string | null; trust: TrustLevel; msg: string }): void {
    try {
      this.deps.journal?.(heartbeatJournalRecord(input));
    } catch (err) {
      console.warn(`[AgentMode/Heartbeat] could not journal: ${message(err)}`);
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
