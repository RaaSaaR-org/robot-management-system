/**
 * @file scene-memory.ts
 * @description In-memory scene store for Agent Mode. Merges VLM observations by
 *              label and converts the VLM's *relative* (image-centre) bearings
 *              into *world* bearings using the robot's yaw, so a `scan_room`
 *              yields a consistent 360° map. No DB, no image retention.
 * @feature agentmode
 * @status live
 */

import { normalizeDeg, type SceneEntity, type SceneMemory } from './types.js';
import type { VisionEntity, VisionObservation } from './vision.js';

/** Entities not re-observed for this long are dropped from the store. */
const STALE_MS = 15 * 60_000;

/**
 * How far the robot may turn before the stored forward clearance stops
 * describing what is in front of it.
 *
 * `forwardClearance` measures a corridor as wide as the robot (±0.35 m, see
 * range.ts) straight down the heading the cloud was taken at. Rotate that
 * corridor by 10° and at 2 m it has slid 0.35 m sideways — one full corridor
 * width, i.e. it is now measuring somewhere else. Anything looser and the
 * navigator would size a walk down one heading using the free space down
 * another, which is how a robot walks into the table it just turned to face.
 *
 * The one-sided cost of getting this wrong decides the direction to err in:
 * discarding a still-valid clearance costs one blind stage, keeping an invalid
 * one costs a collision.
 */
const CLEARANCE_YAW_TOLERANCE_DEG = 10;

/**
 * How far the robot may TRANSLATE before every stored distance — the forward
 * clearance and each entity's range — stops describing where things are.
 *
 * The yaw rule above closes the same hole for rotation, and leaving translation
 * open cost a false arrival in the 07 recording: after a 2 m backward walk,
 * `goto` read the clearance measured before it (0.67 m), found
 * `0.67 − 0.45 < 0.30 m` and declared arrival ~2.4 m from the table, while the
 * LiDAR in that same frame measured 1.98 m. A distance is a measurement FROM A
 * POSE; the robot leaving that pose invalidates it just as surely as turning
 * away from the heading does.
 *
 * 0.15 m, from three directions: below the navigator's 0.30 m minimum stage, so
 * every commanded stage expires what preceded it; a third of its 0.45 m stopping
 * margin, so whatever error survives cannot eat the margin; and an order of
 * magnitude above odometry noise, so a standing robot does not churn its own
 * memory to null.
 */
const TRANSLATION_TOLERANCE_M = 0.15;

/** Where the yaw used for the relative→world conversion came from. */
export type YawSource = 'odometry' | 'dead-reckoning';

/**
 * A {@link VisionEntity} after `BlockExecutor.observeAndMerge` has offered it to
 * the range sensor. `distanceSource` is optional here and NOT in
 * {@link SceneEntity}: an observation that never passed the enrichment step (the
 * idle watcher, a test) simply carries none, and {@link SceneMemoryStore.merge}
 * then labels the VLM's own number for what it is. A stored entity, in contrast,
 * must always say where its distance came from.
 */
export interface ObservedEntity extends VisionEntity {
  distanceSource?: SceneEntity['distanceSource'];
}

/** {@link VisionObservation} widened to carry {@link ObservedEntity}. */
export interface Observation extends Omit<VisionObservation, 'entities'> {
  entities: ObservedEntity[];
}

/** Everything an observation knows that is not per-entity. */
export interface MergeExtras {
  /**
   * Nearest surface straight ahead, measured, in metres — `null`/absent when
   * there is no measurement. See {@link SceneMemoryStore.merge} for why this is
   * overwritten on every merge.
   */
  forwardClearanceM?: number | null;
}

/**
 * How a distance is spoken about, provenance included — the same rule the yaw
 * follows in {@link SceneMemoryStore.toMarkdown}: a number is never shown
 * without saying whether it was measured. The planner LLM reads this text and
 * nothing else, so "2.0 m" alone would let it plan on a 0.94 m-MAE guess as if
 * it were a range measurement.
 */
function distancePhrase(entity: SceneEntity): string {
  if (entity.distanceEstM === null) return 'distance unknown';
  const source =
    entity.distanceSource === 'lidar' ? 'lidar-measured' : 'vision guess, unreliable';
  return `~${entity.distanceEstM.toFixed(1)} m (${source})`;
}

export class SceneMemoryStore {
  private readonly robotId: string;
  private entities = new Map<string, SceneEntity>();
  private currentView = '';
  private personVisible = false;
  private updatedAt: string | null = null;
  /** Robot yaw in degrees, world frame, CCW positive. */
  private yawDeg = 0;
  private yawSource: YawSource = 'dead-reckoning';
  /**
   * Nearest surface straight ahead in metres at the last merge, or null when it
   * was not measured. Null is UNKNOWN, never "clear" — see {@link SceneMemory}.
   */
  private forwardClearanceM: number | null = null;
  /**
   * The world yaw the clearance was measured at. Kept because a clearance is a
   * measurement OF A DIRECTION, and the robot turns between the look that
   * produced it and the walk that uses it — see {@link expireClearanceOnTurn}.
   */
  private forwardClearanceYawDeg: number | null = null;
  /**
   * Distance the robot has travelled since the last observation, in metres,
   * accumulated from commanded base motion (see
   * {@link SceneMemoryStore.noteTranslationM}). Reset by every merge, because a
   * merge is the robot looking again from where it now stands.
   */
  private translationSinceObservationM = 0;

  constructor(robotId: string) {
    this.robotId = robotId;
  }

  /**
   * Set the robot's world yaw. `source` is recorded verbatim so
   * {@link toMarkdown} can state whether bearings rest on real odometry or on
   * integrated turn commands — never presented as measured when they are not.
   */
  setYawDeg(deg: number, source: YawSource): void {
    this.yawDeg = normalizeDeg(deg);
    this.yawSource = source;
    this.expireClearanceOnTurn();
  }

  /** Advance the dead-reckoned yaw by a commanded turn (degrees, + = CCW). */
  advanceYawDeg(deltaDeg: number): void {
    this.yawDeg = normalizeDeg(this.yawDeg + deltaDeg);
    this.expireClearanceOnTurn();
  }

  /**
   * Drop the forward clearance once the robot has turned away from the heading
   * it was measured at.
   *
   * The bug this closes is not hypothetical, it is the navigator's own stage
   * order: look (which measures the clearance) → turn onto the target's bearing
   * → walk. Without this, the walk down the NEW heading was sized by the free
   * space down the OLD one. On the first stage of any `goto` that turn is the
   * large one — 90° towards a table after a `scan_room` — so the number was
   * reliably wrong exactly when it mattered most, in both directions: a wall
   * behind the robot could veto an open path, and an open path behind it could
   * wave the robot into the table it had just turned to face.
   *
   * Expiring to `null` puts the navigator back on the blind stage plus the
   * arrival-by-contact rule, which is the honest fallback — `null` is UNKNOWN
   * everywhere in this feature, never "clear".
   */
  private expireClearanceOnTurn(): void {
    if (this.forwardClearanceM === null || this.forwardClearanceYawDeg === null) return;
    if (Math.abs(normalizeDeg(this.yawDeg - this.forwardClearanceYawDeg)) <= CLEARANCE_YAW_TOLERANCE_DEG) {
      return;
    }
    this.forwardClearanceM = null;
    this.forwardClearanceYawDeg = null;
  }

  /**
   * Tell the store the robot has moved `distanceM` metres.
   *
   * Called from the ONE funnel every base motion in Agent Mode passes through
   * (`BlockExecutor.driveFor`), with the COMMANDED displacement rather than the
   * measured one. Commanded over-states what a slowed or blocked base actually
   * achieved, and over-stating is the safe direction: expiring a still-valid
   * measurement costs one blind stage, keeping an invalid one steers the robot.
   */
  noteTranslationM(distanceM: number): void {
    if (!Number.isFinite(distanceM)) return;
    this.translationSinceObservationM += Math.abs(distanceM);
    this.expireOnTranslation();
  }

  /**
   * Has the robot moved far enough since its last look that what it remembers
   * about distances is no longer about where it stands?
   *
   * The navigator asks this before its first stage: the honest answer to "how
   * far is the table" is then "look again", not a number from two metres back.
   */
  hasMovedSinceObservation(): boolean {
    return this.translationSinceObservationM > TRANSLATION_TOLERANCE_M;
  }

  /**
   * Drop every stored distance once the robot has walked away from the pose
   * they were measured at — the clearance straight ahead AND each entity's own
   * range.
   *
   * Bearings deliberately survive. A bearing goes wrong gradually with
   * translation and the navigator already re-bears after every look, so keeping
   * it lets `goto` aim at something; a distance, by contrast, is what ends the
   * navigation, and a wrong one ends it in the wrong place. Nulling both the
   * number and its provenance together is the same rule {@link merge} follows:
   * a distance is never left wearing the `lidar` label that makes the navigator
   * act on it.
   */
  private expireOnTranslation(): void {
    if (!this.hasMovedSinceObservation()) return;
    this.forwardClearanceM = null;
    this.forwardClearanceYawDeg = null;
    for (const [key, entity] of this.entities) {
      if (entity.distanceEstM === null && entity.distanceSource === null) continue;
      // Replaced, not mutated in place: callers hold the object they read (the
      // navigator compares a pre-walk snapshot against what the walk did), and
      // rewriting it under them would change the past.
      this.entities.set(key, { ...entity, distanceEstM: null, distanceSource: null });
    }
  }

  getYawDeg(): number {
    return this.yawDeg;
  }

  getYawSource(): YawSource {
    return this.yawSource;
  }

  /**
   * Merge one VLM observation.
   *
   * `observation.entities[].bearingDeg` is RELATIVE to the image centre with
   * "+ = to the robot's left / CCW" (see prompts.ts). The stored bearing is
   * WORLD: `normalizeDeg(yawDeg + relativeBearingDeg)`. Entities are keyed by
   * their lower-cased label, so re-seeing "table" updates the existing row
   * rather than appending a duplicate.
   *
   * @param yawDegOverride Yaw to use for this observation; defaults to the
   *        store's current yaw. Passed explicitly by `scan_room`, which reads a
   *        fresh yaw per step.
   * @param extras Per-observation facts that are not per-entity — currently the
   *        measured forward clearance.
   */
  merge(observation: Observation, yawDegOverride?: number, extras?: MergeExtras): SceneMemory {
    const yaw = yawDegOverride === undefined ? this.yawDeg : normalizeDeg(yawDegOverride);
    const now = new Date().toISOString();

    for (const seen of observation.entities) {
      const label = seen.label.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const previous = this.entities.get(key);
      const entity: SceneEntity = {
        label: previous?.label ?? label,
        bearingDeg: normalizeDeg(yaw + seen.bearingDeg),
        // Distance AND its provenance are overwritten together, unconditionally.
        // Keeping a previous measured distance when this look produced none
        // would be the worst of the options: the robot has walked since, so the
        // old metre describes a pose it is no longer in, and it would be handed
        // on wearing the 'lidar' label that makes the navigator act on it. A
        // null costs one blind stage; a stale measurement steers.
        distanceEstM: seen.distanceEstM,
        // No enrichment step ran → the number can only be the VLM's own guess.
        // Never leave this unset: an unlabelled distance reads as measured.
        distanceSource:
          seen.distanceSource ?? (seen.distanceEstM === null ? null : 'vlm-estimate'),
        confidence: seen.confidence,
        lastSeen: now,
        observedSeq: (previous?.observedSeq ?? 0) + 1,
      };
      // Keep the previous note when this observation carries none — a note is
      // extra colour, not something to lose on a terser second look.
      const note = seen.note ?? previous?.note;
      if (note) entity.note = note;
      this.entities.set(key, entity);
    }

    this.currentView = observation.currentView;
    this.personVisible = observation.personVisible;
    // Same rule as the per-entity distance: a clearance from before the last
    // motion is not a clearance. Absent measurement → unknown, not the old value.
    this.forwardClearanceM =
      extras?.forwardClearanceM === undefined || extras.forwardClearanceM === null
        ? null
        : extras.forwardClearanceM;
    // The heading it describes, so a later turn can retire it (see
    // expireClearanceOnTurn). `yaw` and not `this.yawDeg`: `scan_room` merges
    // each step against the yaw that step was observed at.
    this.forwardClearanceYawDeg = this.forwardClearanceM === null ? null : yaw;
    // Everything above was just measured from where the robot now stands, so
    // the distance it walked to get here is spent (see expireOnTranslation).
    this.translationSinceObservationM = 0;
    this.updatedAt = now;
    this.prune(Date.parse(now));
    // Non-null by construction: `updatedAt` was just set.
    return this.snapshot() as SceneMemory;
  }

  /**
   * Look an entity up by label. Exact (case-insensitive) match first, then a
   * substring match in either direction so "table with the hat" still finds
   * "table". Returns undefined when nothing matches — callers must NOT invent
   * a bearing for an entity that was never seen.
   */
  get(label: string): SceneEntity | undefined {
    const needle = label.trim().toLowerCase();
    if (!needle) return undefined;
    const exact = this.entities.get(needle);
    if (exact) return exact;

    // Most specific match wins, not the first one inserted. Returning whatever
    // the Map happened to yield first made the answer depend on the order the
    // vision model mentioned things: "table with the hat" contains BOTH "table"
    // and "hat", so the robot walked to whichever had been seen first. That is
    // a physical action chosen by iteration order.
    let best: SceneEntity | undefined;
    let bestKeyLength = -1;
    for (const [key, entity] of this.entities) {
      // A key contained in the needle ("tisch" in "tisch mit dem hut") is a
      // real narrowing; longer means more of the request was accounted for.
      if (needle.includes(key) && key.length > bestKeyLength) {
        best = entity;
        bestKeyLength = key.length;
      }
    }
    if (best) return best;

    // Otherwise fall back to keys the needle appears inside ("tisch" finding
    // "tischdecke"), preferring the shortest — the least extra it drags in.
    let widest: SceneEntity | undefined;
    let widestKeyLength = Infinity;
    for (const [key, entity] of this.entities) {
      if (key.includes(needle) && key.length < widestKeyLength) {
        widest = entity;
        widestKeyLength = key.length;
      }
    }
    return widest;
  }

  listEntities(): SceneEntity[] {
    return [...this.entities.values()].sort((a, b) => a.bearingDeg - b.bearingDeg);
  }

  isPersonVisible(): boolean {
    return this.personVisible;
  }

  /**
   * Nearest surface straight ahead in metres as of the last merge, or null.
   *
   * Null means UNKNOWN and callers must treat it as such, and there are now two
   * ways to get it: nothing measured it, or the robot has since turned away
   * from the heading it was measured at (see {@link expireClearanceOnTurn}).
   * Either way the MID-360's vertical fan (≈ -52°..+7° from ~1.3 m up) does not
   * cover everything in front of the robot, so no return is not the same as no
   * obstacle.
   */
  getForwardClearanceM(): number | null {
    return this.forwardClearanceM;
  }

  /** Null until the first observation — "nothing seen yet" is not an empty scene. */
  snapshot(): SceneMemory | null {
    if (this.updatedAt === null) return null;
    return {
      robotId: this.robotId,
      currentView: this.currentView,
      entities: this.listEntities(),
      personVisible: this.personVisible,
      forwardClearanceM: this.forwardClearanceM,
      updatedAt: this.updatedAt,
    };
  }

  clear(): void {
    this.entities.clear();
    this.currentView = '';
    this.personVisible = false;
    this.forwardClearanceM = null;
    this.forwardClearanceYawDeg = null;
    this.translationSinceObservationM = 0;
    this.updatedAt = null;
  }

  /**
   * Compact, token-cheap rendering handed to the planner. The planner never
   * sees pixels — only this.
   */
  summary(): string {
    if (this.updatedAt === null) return 'Scene memory is empty — nothing has been looked at yet.';
    const lines = this.listEntities().map(
      (e) =>
        `- ${e.label}: bearing ${Math.round(e.bearingDeg)}°, ${distancePhrase(e)}, confidence ${e.confidence.toFixed(2)}`
    );
    return [
      `Current view: ${this.currentView || '(nothing recorded)'}`,
      `Robot heading: ${Math.round(this.yawDeg)}° (${this.yawSource})`,
      // Spelled out because "unknown" is the tempting thing to read as "clear",
      // and the planner is exactly the reader who would act on that.
      `Clear ahead: ${
        this.forwardClearanceM === null
          ? 'not measured (unknown — this does NOT mean the way is clear)'
          : `${this.forwardClearanceM.toFixed(2)} m (lidar-measured)`
      }`,
      `Person visible: ${this.personVisible ? 'yes' : 'no'}`,
      lines.length > 0 ? 'Known entities:' : 'Known entities: none',
      ...lines,
    ].join('\n');
  }

  /** The `current_view.md` dump served by `GET /agent-mode/scene.md`. */
  toMarkdown(): string {
    const header = [
      '# Current view',
      '',
      `- **Robot**: ${this.robotId}`,
      `- **Heading**: ${Math.round(this.yawDeg)}° (${this.yawSource})`,
      `- **Clear ahead**: ${
        this.forwardClearanceM === null
          ? 'not measured (unknown — not the same as clear)'
          : `${this.forwardClearanceM.toFixed(2)} m (lidar)`
      }`,
      `- **Updated**: ${this.updatedAt ?? 'never'}`,
      `- **Person visible**: ${this.personVisible ? 'yes' : 'no'}`,
      '',
    ];
    if (this.updatedAt === null) {
      return [...header, '_No observation yet — the robot has not looked around._', ''].join('\n');
    }
    const rows = this.listEntities().map((e) => {
      const dist = e.distanceEstM === null ? '–' : `${e.distanceEstM.toFixed(1)} m`;
      // Provenance gets its own column rather than a parenthesis in the distance
      // cell: the number and where it came from are two facts, and a reader
      // scanning the column sees at a glance which rows were measured.
      const source =
        e.distanceSource === 'lidar'
          ? 'lidar'
          : e.distanceSource === 'vlm-estimate'
            ? 'vision guess'
            : '–';
      return `| ${e.label} | ${Math.round(e.bearingDeg)}° | ${dist} | ${source} | ${e.confidence.toFixed(2)} | ${e.lastSeen} | ${e.note ?? ''} |`;
    });
    return [
      ...header,
      '## What I see',
      '',
      this.currentView || '_(the vision model returned no description)_',
      '',
      '## Entities',
      '',
      '| Label | World bearing | Distance | Distance source | Confidence | Last seen | Note |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...(rows.length > 0 ? rows : ['| _none_ | | | | | | |']),
      '',
      `_Bearings are world-frame (+x = 0°, CCW positive) derived from the robot's ${this.yawSource} heading._`,
      '_A `lidar` distance is the nearest surface inside a cone around that bearing — LiDAR returns_',
      '_carry no labels, so it means "something solid is that far in that direction". A `vision guess`_',
      "_is the vision model's own estimate (0.94 m MAE) and is not navigated on._",
      '',
    ].join('\n');
  }

  private prune(nowMs: number): void {
    for (const [key, entity] of this.entities) {
      const seenMs = Date.parse(entity.lastSeen);
      if (Number.isFinite(seenMs) && nowMs - seenMs > STALE_MS) {
        this.entities.delete(key);
      }
    }
  }
}
