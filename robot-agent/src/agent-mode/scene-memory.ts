/**
 * @file scene-memory.ts
 * @description In-memory scene store for Agent Mode. Merges VLM observations by
 *              label and converts the VLM's *relative* (image-centre) bearings
 *              into *world* bearings using the robot's yaw, so a `scan_room`
 *              yields a consistent 360° map. No DB, no image retention.
 * @feature agentmode
 * @status live
 */

import { normalizeDeg, type SceneEntity, type SceneMemory, type ScenePlace } from './types.js';
import type { VisionEntity, VisionObservation } from './vision.js';

/** Entities not re-observed for this long are dropped from the store. */
const STALE_MS = 15 * 60_000;

/**
 * Collapse repeats of one label inside a SINGLE observation, deterministically.
 *
 * A frame containing two doorways comes back as `entities: [door, door]` — two
 * real, differently-placed objects sharing one name. The store is keyed by
 * label, so they cannot both be kept; the question is only whether the survivor
 * is chosen or accidental. Writing them in sequence made it accidental: the last
 * one the model happened to list won, and two looks from nearly the same pose
 * could disagree. The navigator then steers on a bearing that jumps between two
 * real objects and converges on neither — observed as a `goto "door"` that
 * turned −38°, +28°, −33° over successive stages and gave up having walked 5.5 m
 * past both.
 *
 * The instance kept is the one CLOSEST TO THE CENTRE OF THE FRAME. It is the one
 * the robot is already looking at, which is what "the door" ordinarily refers to;
 * and, unlike a nearest-or-first rule, it is *stable under the navigator's own
 * steering* — having turned towards it, it stays the most central, so the next
 * look chooses it again and the approach converges.
 *
 * Ties break towards the instance that carries a distance at all, then the
 * nearer, then the more confident — so the survivor is fully determined by the
 * observation and never by iteration order.
 *
 * @returns one entry per distinct label, each with the count it stood for.
 */
export function dedupeByLabel<T extends VisionEntity>(
  entities: readonly T[]
): Array<{ seen: T; rawLabel: string; inView: number }> {
  // Generic over the element type, not fixed to VisionEntity: `merge` is handed
  // ObservedEntity, which carries the `distanceSource` that says whether a metre
  // was measured or guessed. Narrowing to the base type here would silently drop
  // it and re-label every lidar range as a vision estimate.
  const byKey = new Map<string, { seen: T; rawLabel: string; inView: number }>();
  for (const seen of entities) {
    const rawLabel = seen.label.trim();
    if (!rawLabel) continue;
    const key = rawLabel.toLowerCase();
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, { seen, rawLabel, inView: 1 });
      continue;
    }
    prior.inView++;
    if (moreCentral(seen, prior.seen)) prior.seen = seen;
  }
  return [...byKey.values()];
}

/** True when `a` is the better referent for a shared label than `b`. */
function moreCentral(a: VisionEntity, b: VisionEntity): boolean {
  // A placed instance beats an unplaced one whatever else the two carry. An
  // entity the model could not place has no centrality to compare at all, and
  // reading its absent bearing as 0 made it the MOST central of the pair — so
  // the one instance of a label that nobody knew the direction of won the label
  // outright, and the frame's real, well-placed door was thrown away for it.
  const aPlaced = a.bearingDeg !== undefined;
  const bPlaced = b.bearingDeg !== undefined;
  if (aPlaced !== bPlaced) return aPlaced;
  if (a.bearingDeg !== undefined && b.bearingDeg !== undefined) {
    const da = Math.abs(a.bearingDeg);
    const db = Math.abs(b.bearingDeg);
    if (da !== db) return da < db;
  }
  // A known distance beats an unknown one: it is the instance the navigator can
  // actually judge progress against.
  if ((a.distanceEstM === null) !== (b.distanceEstM === null)) return b.distanceEstM === null;
  if (a.distanceEstM !== null && b.distanceEstM !== null && a.distanceEstM !== b.distanceEstM) {
    return a.distanceEstM < b.distanceEstM;
  }
  return a.confidence > b.confidence;
}

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
 * Where the robot's metric position came from — the same provenance rule the
 * yaw and every distance in this store follow. `declared` is an operator
 * asserting a position the robot did not measure; it is kept distinct from
 * `odometry` precisely so it can never be spoken of as measured.
 */
export type PoseSource = 'odometry' | 'dead-reckoning' | 'declared';

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
    entity.distanceSource === 'lidar'
      ? 'lidar-measured'
      : entity.distanceSource === 'fleet'
        ? 'fleet-reported position'
        : 'vision guess, unreliable';
  return `~${entity.distanceEstM.toFixed(1)} m (${source})`;
}

export class SceneMemoryStore {
  private readonly robotId: string;
  private entities = new Map<string, SceneEntity>();
  /**
   * Other robots the fleet says are near (TASK-207). Kept apart from the seen
   * entities: they were never observed by the camera, so a look must not
   * confirm, expire or re-range them — the peer feed replaces the whole set on
   * every pull. Merged into every listing so the planner and the UI see one
   * table.
   */
  private fleetEntities = new Map<string, SceneEntity>();
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
   * True from the moment a turn retired the clearance until the next
   * observation. The distinction it carries (TASK-208): "the lidar never spoke"
   * and "the lidar spoke about a heading the robot has since left" are both
   * `null`, but the second one is a robot that HAS a working range sensor and
   * has simply not measured this heading yet — so a walk down it should be the
   * blind stage and a look, never an unclamped run.
   */
  private clearanceExpiredByTurn = false;
  /**
   * Distance Agent Mode has COMMANDED the base to travel since the last
   * observation, in metres (see {@link SceneMemoryStore.noteTranslationM}).
   * Reset by every merge, because a merge is the robot looking again from where
   * it now stands.
   */
  private commandedSinceObservationM = 0;
  /**
   * The odometry position the current accounting window opened at — where the
   * robot stood when it last looked — or null before the first fix. Reset by
   * every merge to the freshest fix the store has been handed.
   */
  private odomAnchorM: { x: number; y: number } | null = null;
  /**
   * HIGH-WATER MARK of the measured distance from {@link odomAnchorM}, in
   * metres (see {@link SceneMemoryStore.noteOdometryM}).
   *
   * A high-water mark and not a running sum, for two reasons that both bite.
   * Summing per-sample deltas walks a STANDING robot away from its own memory,
   * because odometry jitter is all one sign once you take its magnitude. And
   * the fixes do not arrive as one ordered stream — a fresh read inside
   * `BlockExecutor.refreshYaw` and the 2 s pose poll's cache both feed this —
   * so a sample that is merely OLD would otherwise read as more motion. The
   * largest displacement from the anchor is order-independent, and it is the
   * honest answer to "how far from the looking pose has this robot been".
   */
  private odomFromAnchorM = 0;
  /**
   * The most recent odometry fix handed in, whichever feed supplied it.
   *
   * NEVER nulled once set: it is the freshest fix this store has, not a
   * statement that the feed is alive. {@link odomFixSeq} is what says whether
   * it is fresh enough to anchor a window with.
   */
  private lastOdomM: { x: number; y: number } | null = null;
  /**
   * How many odometry fixes this store has ACCEPTED, ever.
   *
   * A monotonic SEQUENCE and deliberately not a clock: the question a merge
   * asks is "has odometry spoken at all since the last time I opened a
   * window", which is an ordering question with an exact answer. A timestamp
   * would answer it with a threshold — one more constant to tune, one more
   * thing to get wrong on a slow feed, and a dependence on a clock this store
   * does not otherwise have.
   */
  private odomFixSeq = 0;
  /**
   * The value {@link odomFixSeq} held when {@link reopenOdomWindow} last ran.
   * `odomFixSeq > odomAnchorSeq` is exactly "a fix arrived since the last
   * merge or clear", which is the whole staleness rule.
   */
  private odomAnchorSeq = 0;
  /**
   * True when odometry has told this store where the robot IS without ever
   * having told it where the robot LOOKED FROM (TASK-221 review).
   *
   * That window is UNMEASURED, and unmeasured is not zero — see
   * {@link noteOdometryM} for how it opens. The only honest answer to "how far
   * has the robot come since it looked" is then "far enough that it should look
   * again", so {@link hasMovedSinceObservation} reports moved until the next
   * {@link merge} re-opens the window at a pose this store does know. One look
   * clears it.
   *
   * It can be set MANY times in a store's life, and that is the point. An
   * anchorless window opens whenever a merge finds no fix behind it SINCE THE
   * PREVIOUS merge — `/loco/odom` timing out across a single look is enough
   * (2 s timeout, null on any hiccup, so `BlockExecutor.refreshYaw` hands over
   * nothing) — so this is reachable again after every recovery. It was the
   * opposite reading, that {@link lastOdomM} never goes back to null so no
   * later window can open anchorless, that let a look taken during an outage
   * anchor itself at the PREVIOUS look's pose and call the blackout measured
   * (TASK-221 N1). See {@link reopenOdomWindow}.
   */
  private odomGapUnmeasured = false;
  /**
   * Metric position in the place graph's frame, or null when it is not known.
   *
   * Null is UNKNOWN — the exact rule `forwardClearanceM` and `distanceSource`
   * already live by — and it is NEVER backfilled with the last pose. On this
   * stack a null pose is routine, not exceptional: `getLocoOdometry()` has a
   * 2 s timeout and returns null on any hiccup.
   */
  private poseM: { x: number; y: number } | null = null;
  private poseSource: PoseSource | null = null;
  /** Named place the robot is standing in, or null for UNKNOWN. */
  private place: ScenePlace | null = null;
  /**
   * Accumulated translation since the last re-anchor, in metres, as the place
   * tracker measured it. Rendered next to the place so the planner (and the
   * operator) can see how much walking the belief rests on.
   */
  private placeDriftM: number | null = null;

  constructor(robotId: string) {
    this.robotId = robotId;
  }

  /**
   * Set the robot's metric position. Mirrors {@link setYawDeg} exactly,
   * including the provenance rule: `source` is recorded verbatim so nothing
   * downstream can present a dead-reckoned or declared position as a measured
   * one.
   */
  setPoseM(x: number, y: number, source: PoseSource): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      this.clearPoseM();
      return;
    }
    this.poseM = { x, y };
    this.poseSource = source;
  }

  /**
   * The pose is not known. Separate from {@link setPoseM} rather than a
   * nullable argument so that "we have no pose" is something a caller has to
   * say on purpose — the one thing that must never happen is a lost pose
   * quietly leaving the previous coordinates in place.
   */
  clearPoseM(): void {
    this.poseM = null;
    this.poseSource = null;
  }

  getPoseM(): { x: number; y: number } | null {
    return this.poseM ? { ...this.poseM } : null;
  }

  getPoseSource(): PoseSource | null {
    return this.poseSource;
  }

  /**
   * Set (or clear) the place the robot believes it is in.
   *
   * `null` means UNKNOWN and is stored as such. A caller that has lost the
   * place must call this with `null`; there is deliberately no "leave it as it
   * was" path, because the last place is exactly the wrong answer once the
   * robot has been teleoperated somewhere else.
   */
  setPlace(place: ScenePlace | null, driftSinceAnchorM: number | null = null): void {
    this.place = place;
    this.placeDriftM = place === null ? null : driftSinceAnchorM;
  }

  getPlace(): ScenePlace | null {
    return this.place;
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
   * everywhere in this feature, never "clear". The expiry is also REMEMBERED
   * (see {@link wasClearanceExpiredByTurn}), because for a plain `walk` block
   * the executor used to read the resulting `null` as "nothing to clamp" — so
   * "turn 45°, walk 3 m" escaped the clamp that "walk 3 m" was held to.
   */
  private expireClearanceOnTurn(): void {
    if (this.forwardClearanceM === null || this.forwardClearanceYawDeg === null) return;
    if (Math.abs(normalizeDeg(this.yawDeg - this.forwardClearanceYawDeg)) <= CLEARANCE_YAW_TOLERANCE_DEG) {
      return;
    }
    this.forwardClearanceM = null;
    this.forwardClearanceYawDeg = null;
    this.clearanceExpiredByTurn = true;
  }

  /**
   * Tell the store Agent Mode has COMMANDED the robot to move `distanceM`
   * metres.
   *
   * Called from the ONE funnel every base motion in Agent Mode passes through
   * (`BlockExecutor.driveFor`), with the commanded displacement rather than the
   * measured one. Commanded over-states what a slowed or blocked base actually
   * achieved, and over-stating is the safe direction: expiring a still-valid
   * measurement costs one blind stage, keeping an invalid one steers the robot.
   *
   * It is no longer the only producer, and it never covered the whole problem:
   * a command is evidence about motion Agent Mode ASKED FOR, and Quest teleop,
   * a direct POST to the sidecar and a VLA rollout all move the robot without
   * asking it (TASK-221). {@link noteOdometryM} is the measured half.
   */
  noteTranslationM(distanceM: number): void {
    if (!Number.isFinite(distanceM)) return;
    this.commandedSinceObservationM += Math.abs(distanceM);
    this.expireOnTranslation();
  }

  /**
   * Tell the store where the ODOMETRY says the robot is.
   *
   * This is what makes the staleness rule answer for motion Agent Mode did not
   * command. A teleop drive issues no `walk` block, so nothing calls
   * {@link noteTranslationM}, and before this the store believed the robot was
   * still standing where it had looked — a `goto` then declared arrival at a
   * table four metres away without moving.
   *
   * **The two feeds cannot double-count.** They are not added together: the
   * commanded metres and the measured displacement from the anchor are two
   * accounts of the SAME window, and {@link movedSinceObservationM} takes the
   * LARGER. A 1 m stage that odometry confirms as 1 m counts once. A 1 m stage
   * the base only half achieved still counts as the commanded 1 m, which keeps
   * the existing over-stating bias. And metres nobody commanded — the whole
   * point — show up as measured displacement with no command to cover them.
   *
   * A window this store could not measure at all is a third answer, neither
   * feed's: see the first-fix branch below and {@link odomGapUnmeasured}.
   */
  noteOdometryM(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.lastOdomM = { x, y };
    // Bumped only for a fix that was ACCEPTED, so a NaN cannot make a stale
    // `lastOdomM` look fresh to the next merge.
    this.odomFixSeq++;
    if (this.odomAnchorM === null) {
      // The first fix of an ANCHORLESS window — the store's very first fix, or
      // the first one after a merge that had no odometry behind it. It is a
      // reference point and not a displacement: there is nothing to measure it
      // against, and treating it as motion would make the robot's own
      // coordinates (9 m from an arbitrary origin) read as 9 m of walking.
      this.odomAnchorM = { x, y };
      // But if the robot has already LOOKED, that look was taken from a pose
      // this store never learned, and this fix says only where the robot is
      // NOW. Anchoring here and stopping would call the gap between the two
      // zero — which is precisely the re-anchoring the TASK-221 review caught:
      // seed a `look` while `/loco/odom` is timing out (routine on this stack —
      // 2 s timeout, null on any hiccup, so `refreshYaw` hands over nothing),
      // let odometry recover, push the base four metres with nobody holding the
      // lock, and the first fix to land becomes the anchor and expires nothing.
      // `goto` then answered `Arrived at "table" after 0 stages` from 4.55 m
      // away.
      //
      // So the FIRST fix after an anchorless observation EXPIRES rather than
      // anchors. Unknown is treated as moved, the same over-stating direction
      // {@link noteTranslationM} already takes and for the same reason: it
      // costs one look, and believing the alternative steers the robot.
      //
      // This is reached whenever a window opened anchorless, not just before
      // the store's first fix — see {@link reopenOdomWindow} for why a merge
      // can now open one at any point in a store's life.
      if (this.updatedAt !== null) {
        this.odomGapUnmeasured = true;
        this.expireOnTranslation();
      }
      return;
    }
    const fromAnchorM = Math.hypot(x - this.odomAnchorM.x, y - this.odomAnchorM.y);
    if (fromAnchorM <= this.odomFromAnchorM) return;
    this.odomFromAnchorM = fromAnchorM;
    this.expireOnTranslation();
  }

  /**
   * How far the robot has been from the pose it last looked from, in metres —
   * the larger of what Agent Mode commanded and what odometry measured. See
   * {@link noteOdometryM} for why it is the larger and not the sum.
   */
  private movedSinceObservationM(): number {
    return Math.max(this.commandedSinceObservationM, this.odomFromAnchorM);
  }

  /**
   * Has the robot moved far enough since its last look that what it remembers
   * about distances is no longer about where it stands?
   *
   * The navigator asks this before its first stage: the honest answer to "how
   * far is the table" is then "look again", not a number from two metres back.
   */
  hasMovedSinceObservation(): boolean {
    // An unmeasured window outranks the arithmetic: no number the two feeds can
    // produce describes a gap neither of them watched (see
    // {@link odomGapUnmeasured}).
    if (this.odomGapUnmeasured) return true;
    return this.movedSinceObservationM() > TRANSLATION_TOLERANCE_M;
  }

  /**
   * Re-open the odometry accounting window at the pose the robot is looking
   * from — or at NO pose, when this store cannot tell where that is.
   *
   * The rule is the sequence counter and nothing else: {@link lastOdomM} may
   * anchor a window only when a fix has arrived since the last time this ran.
   * {@link lastOdomM} is never nulled, so "there is a last fix" says nothing
   * about whether it describes THIS look; `BlockExecutor.refreshYaw` returns
   * early whenever `/loco/odom` answers null, which is routine rather than
   * exceptional, and a look taken through such an outage was being anchored at
   * the pose of the PREVIOUS look. The store then measured the blackout as
   * zero and `goto` answered `Arrived at "table" after 0 stages` with the
   * table 4.55 m away (TASK-221 N1). The {@link odomFromAnchorM} high-water
   * mark absorbs most orderings of that, but not the one where the robot comes
   * back near the stale anchor.
   *
   * **Why the unmeasured verdict is NOT pronounced here.** Opening a window
   * anchorless is not the same as knowing the robot moved unwatched, and this
   * is the one place that could confuse the two. A robot whose sidecar has no
   * `/loco/odom` at all opens EVERY window anchorless; declaring each one
   * unmeasured would make {@link hasMovedSinceObservation} permanently true on
   * that robot, which taxes every `goto` a pre-flight look — and worse, leaves
   * {@link expireOnTranslation} nulling the distances of the look that just
   * happened, so no measurement would ever survive a single commanded
   * centimetre. That reasoning survives the sequence counter unchanged: the
   * counter makes anchorless windows reachable at any point in a store's life,
   * but it does not make them evidence of motion. The verdict therefore still
   * waits for {@link noteOdometryM} to hand over a fix, which is the moment
   * the store learns both that odometry is alive AND that it said nothing
   * across the window — the case that is actually dangerous. A feed that never
   * comes back degrades to the commanded metres alone, exactly as it did
   * before odometry fed this store at all. The test
   * `does not invent a gap for a robot whose odometry never answers at all`
   * is the guard on that.
   */
  private reopenOdomWindow(): void {
    const fixSinceLastWindow = this.odomFixSeq > this.odomAnchorSeq;
    this.odomAnchorSeq = this.odomFixSeq;
    this.odomAnchorM = fixSinceLastWindow && this.lastOdomM ? { ...this.lastOdomM } : null;
    this.odomFromAnchorM = 0;
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
   * rather than appending a duplicate. An entity the VLM could not place
   * (`bearingDeg` absent) is not stored at all — see below.
   *
   * @param yawDegOverride Yaw to use for this observation; defaults to the
   *        store's current yaw. NO production caller passes it: the only one
   *        that exists — `BlockExecutor.observeAndMerge`, the funnel behind
   *        both `look` and every `scan_room` step — passes `undefined` and
   *        lets the default stand, because its `refreshYaw` has just written
   *        the measured odometry yaw into the store. `scan_room` does read a
   *        fresh yaw per step, but through that call, not through this
   *        parameter. It stays for a caller holding an observation the store's
   *        current yaw does not describe; today only the tests are one.
   * @param extras Per-observation facts that are not per-entity — currently the
   *        measured forward clearance.
   */
  merge(observation: Observation, yawDegOverride?: number, extras?: MergeExtras): SceneMemory {
    const yaw = yawDegOverride === undefined ? this.yawDeg : normalizeDeg(yawDegOverride);
    const now = new Date().toISOString();

    for (const { seen, rawLabel, inView } of dedupeByLabel(observation.entities)) {
      // An entity the VLM could not place cannot become a row here. Every
      // consumer of this store reads `bearingDeg` as a direction to steer in or
      // to range a cone down, and this observation supplies none; the only way
      // to write one would be to invent it.
      //
      // Skipping — rather than storing it bearingless — also leaves the LAST
      // look that COULD place this label standing: a real bearing, correctly
      // unconfirmed, because `observedSeq` does not move for a sighting that
      // located nothing. Overwriting it with a fabricated 0 did the opposite on
      // both counts.
      if (seen.bearingDeg === undefined) continue;
      const key = rawLabel.toLowerCase();
      const previous = this.entities.get(key);
      const entity: SceneEntity = {
        label: previous?.label ?? rawLabel,
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
      // How many instances this one label stood for in the frame it came from.
      // Recorded rather than smoothed away: it is the difference between "the
      // door" and "one of the two doors I can see", and the navigator quotes it
      // when a goto on this label fails. Absent (not 1) in the ordinary case, so
      // the field only ever appears when it means something.
      if (inView > 1) entity.duplicatesInView = inView;
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
    // expireClearanceOnTurn). `yaw` and not `this.yawDeg` so that an
    // observation merged under `yawDegOverride` pins its clearance to the
    // heading it was measured at rather than to whatever the store holds by
    // then; with no override — which is every production merge — the two are
    // the same number.
    this.forwardClearanceYawDeg = this.forwardClearanceM === null ? null : yaw;
    // A fresh observation is a fresh answer about THIS heading, whatever it is.
    this.clearanceExpiredByTurn = false;
    // Everything above was just measured from where the robot now stands, so
    // the distance it walked to get here is spent (see expireOnTranslation).
    // Both accounts of it: the commanded metres, and the odometry window, which
    // re-opens at the pose the robot is looking from WHEN odometry has said
    // where that is since the last window opened. `BlockExecutor.observeAndMerge`
    // refreshes the position (through `refreshYaw`) on its way into every merge,
    // so in the ordinary case `lastOdomM` is that pose — but `refreshYaw` hands
    // over nothing whenever `/loco/odom` answers null, and `lastOdomM` keeps the
    // fix from before the outage. `reopenOdomWindow` is where that is told
    // apart; it carries the reasoning.
    //
    // A merge with no fix behind it leaves the anchor unset and falls back to
    // the commanded number alone, which is exactly what this store does on a
    // robot whose odometry never answers — until a fix finally arrives, at
    // which point the gap nothing watched is declared unmeasured rather than
    // zero (see `noteOdometryM`).
    this.commandedSinceObservationM = 0;
    this.reopenOdomWindow();
    // Cleared HERE and nowhere else that keeps an observation: a look is the
    // robot re-establishing what its distances are measured from, which is the
    // one thing that answers an unmeasured window.
    this.odomGapUnmeasured = false;
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
    const exact = this.entities.get(needle) ?? this.fleetEntities.get(needle);
    if (exact) return exact;

    // Most specific match wins, not the first one inserted. Returning whatever
    // the Map happened to yield first made the answer depend on the order the
    // vision model mentioned things: "table with the hat" contains BOTH "table"
    // and "hat", so the robot walked to whichever had been seen first. That is
    // a physical action chosen by iteration order.
    let best: SceneEntity | undefined;
    let bestKeyLength = -1;
    for (const [key, entity] of [...this.entities, ...this.fleetEntities]) {
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
    for (const [key, entity] of [...this.entities, ...this.fleetEntities]) {
      if (key.includes(needle) && key.length < widestKeyLength) {
        widest = entity;
        widestKeyLength = key.length;
      }
    }
    return widest;
  }

  listEntities(): SceneEntity[] {
    return [...this.entities.values(), ...this.fleetEntities.values()].sort(
      (a, b) => a.bearingDeg - b.bearingDeg,
    );
  }

  /**
   * Replace the fleet-reported entities (peers within notice range). A full
   * replace: a peer that left the radius disappears at once, and nothing here
   * touches `updatedAt` — knowing where a colleague is, is not having looked.
   */
  setFleetEntities(entities: readonly SceneEntity[]): void {
    this.fleetEntities.clear();
    for (const e of entities) this.fleetEntities.set(e.label.trim().toLowerCase(), { ...e, distanceSource: 'fleet' });
  }

  /** True when the store holds at least one fleet-reported entity. */
  hasFleetEntities(): boolean {
    return this.fleetEntities.size > 0;
  }

  isPersonVisible(): boolean {
    return this.personVisible;
  }

  /**
   * The last free-text view, or `''` before the first observation. Kept as its
   * own getter so a caller on a 3 s loop (the heartbeat's intent matcher) can
   * read it without building a whole {@link snapshot}.
   */
  getCurrentView(): string {
    return this.currentView;
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

  /**
   * True when the clearance is `null` BECAUSE a turn retired a measurement,
   * and no observation has replaced it since (TASK-208). The executor caps a
   * forward walk at the blind stage in that state; a plain "never measured"
   * `null` still clamps nothing, because it may be a robot with no lidar at all.
   */
  wasClearanceExpiredByTurn(): boolean {
    return this.forwardClearanceM === null && this.clearanceExpiredByTurn;
  }

  /** Null until the first observation — "nothing seen yet" is not an empty scene. */
  snapshot(): SceneMemory | null {
    if (this.updatedAt === null) return null;
    return {
      robotId: this.robotId,
      currentView: this.currentView,
      entities: this.listEntities(),
      personVisible: this.personVisible,
      place: this.place,
      forwardClearanceM: this.forwardClearanceM,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Forget everything the robot has SEEN.
   *
   * Called when the observations stop being observations of anything the robot
   * can account for: the controller wipes the scene the moment the control lock
   * goes to a non-agent owner (TASK-221), because what the camera saw while a
   * human was teleoperating the base is not something this robot looked at, and
   * the distances in it were measured from a pose nobody here chose to leave.
   */
  clear(): void {
    this.entities.clear();
    this.currentView = '';
    this.personVisible = false;
    this.forwardClearanceM = null;
    this.forwardClearanceYawDeg = null;
    this.clearanceExpiredByTurn = false;
    this.commandedSinceObservationM = 0;
    // Same rule as `merge`: a wipe re-opens the window, and only a fix that
    // arrived since the last one may anchor it.
    this.reopenOdomWindow();
    // No observation is left for a fix to fall outside of: `noteOdometryM`
    // gates its unmeasured-gap verdict on `updatedAt`, nulled just below.
    this.odomGapUnmeasured = false;
    this.updatedAt = null;
    // Pose and place deliberately SURVIVE `clear()`. This wipes what the robot
    // has SEEN — it is called when the observations are no longer trustworthy —
    // and where the robot is standing is not an observation of the room. The
    // pose feed nulls them on its own when it loses the pose.
  }

  /**
   * The one line about place handed to the planner and written at the top of
   * `scene.md`. Kept to a single line on purpose: `gemma3:4b` sits on the
   * latency path and prompt length is a measured regression risk here.
   *
   * The unknown wording is spelled out for the same reason "not measured
   * (unknown — this does NOT mean the way is clear)" is: the planner is exactly
   * the reader who would otherwise fill a blank with the last place it saw.
   */
  private placeLine(): string {
    if (this.place === null) {
      return this.poseM === null
        ? 'Place unknown — no pose.'
        : 'Place unknown — the pose is not inside any mapped place.';
    }
    const pose =
      this.poseM === null || this.poseSource === null
        ? 'pose unknown'
        : `pose from ${this.poseSource}`;
    const drift =
      this.placeDriftM === null ? '' : `, ${this.placeDriftM.toFixed(1)} m since last anchor`;
    const stale =
      this.place.confidence === 'stale'
        ? ' — this belief is STALE: the pose has drifted further than the budget without a re-anchor'
        : '';
    return `You are in ${this.place.id} (${this.place.source} map; ${pose}${drift})${stale}.`;
  }

  /**
   * Compact, token-cheap rendering handed to the planner. The planner never
   * sees pixels — only this.
   */
  summary(): string {
    // The place line comes FIRST and is present even with no observation: where
    // the robot stands is known from the pose feed, not from having looked, so
    // "nothing has been looked at yet" is not the same as "nowhere".
    if (this.updatedAt === null) {
      const fleet = [...this.fleetEntities.values()].map(
        (e) => `- ${e.label}: bearing ${Math.round(e.bearingDeg)}°, ${distancePhrase(e)}`,
      );
      return [
        this.placeLine(),
        'Scene memory is empty — nothing has been looked at yet.',
        ...(fleet.length > 0 ? ['Known from the fleet (not seen by the camera):', ...fleet] : []),
      ].join('\n');
    }
    const lines = this.listEntities().map(
      (e) =>
        `- ${e.label}: bearing ${Math.round(e.bearingDeg)}°, ${distancePhrase(e)}, confidence ${e.confidence.toFixed(2)}`
    );
    return [
      this.placeLine(),
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
      // Same rule as `summary()`: the place line is in the HEADER, above the
      // "no observation yet" branch, because the pose feed knows where the
      // robot is standing before it has looked at anything.
      this.placeLine(),
      '',
      `- **Robot**: ${this.robotId}`,
      `- **Heading**: ${Math.round(this.yawDeg)}° (${this.yawSource})`,
      `- **Position**: ${
        this.poseM === null
          ? 'unknown (no pose — this is not the same as the origin)'
          : `(${this.poseM.x.toFixed(2)}, ${this.poseM.y.toFixed(2)}) m (${this.poseSource})`
      }`,
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
            : e.distanceSource === 'fleet'
              ? 'fleet'
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
