/**
 * @file place-resolver.ts
 * @description Pose → place. A 2D point-in-polygon ray cast plus an explicit
 *              floor predicate, wrapped in a hysteresis + drift state object so
 *              a robot standing on a boundary does not flap between two names.
 *              Pure: the only I/O is {@link loadPlaceGraph}, which reads the
 *              hand-authored graph off disk once at boot.
 * @feature agentmode
 * @status live
 */

import { readFileSync } from 'node:fs';
import type { PlaceConfidence, PlaceSource, PlaceType, ScenePlace } from './types.js';
import { PlaceSources, PlaceTypes } from './types.js';

/**
 * Units the resolver works in. ASSERTED against the graph's own frame block
 * rather than assumed, because this codebase already carries one live
 * radians-vs-degrees seam (`LocoOdometry.yaw` is radians, Agent Mode is
 * degrees) and a second silent unit mismatch — a graph authored in centimetres
 * — would put every place 100× too far away and read as "UNKNOWN everywhere"
 * with nothing in the logs to say why.
 */
export const PLACE_FRAME_UNITS = 'm';

/** Yaw convention the resolver expects. Asserted for the same reason. */
export const PLACE_FRAME_YAW_CONVENTION = 'deg,+x=0,CCW+';

/** Graph schema version this build understands. */
export const PLACE_GRAPH_VERSION = 1;

/**
 * Floor a pose is on when its source does not report one.
 *
 * Deliberately the number 0 and NOT derived from `RobotLocation.floor`: that
 * field is a STRING ('1' by default from `INITIAL_FLOOR`) describing a building
 * storey in the fleet's vocabulary, while a place graph's `floor` is an integer
 * in the graph's own frame. Parsing one into the other would silently make
 * every place on floor 0 unreachable for a robot configured on floor '1'.
 * Odometry carries no storey, so a planar pose is floor 0 of its own frame.
 */
export const DEFAULT_PLACE_FLOOR = 0;

/** Two consecutive qualifying resolves before a place change commits. */
export const PLACE_CONFIRM_SAMPLES = 2;

/** A `[x, y]` vertex in the graph's frame, in metres. */
export type PlaceVertex = readonly [number, number];

/** The frame every polygon in one graph is expressed in. */
export interface PlaceFrame {
  /** Frame id, e.g. `warehouse-sim`. Free text; it names the map, not a unit. */
  id: string;
  /** `sim` for a MuJoCo scene, `site` for a real building. */
  kind: string;
  /** Must equal {@link PLACE_FRAME_UNITS}. */
  units: string;
  /** Must equal {@link PLACE_FRAME_YAW_CONVENTION}. */
  yawConvention: string;
  /**
   * The `DigitalTwin` this graph's coordinates live in, when it came from a
   * scanned site (TASK-200). Absent for a hand-authored sim graph.
   *
   * LOAD-BEARING, not decorative. Twins are NOT mutually registered: each
   * twin's origin is an arbitrary robot pose at scan start
   * (`ScanSession.originX/Y/Z`), so `AISLE-3` in twin A and `AISLE-3` in twin B
   * are different rooms that happen to share a name, and their polygons are
   * expressed about different origins. A robot configured against one twin must
   * REFUSE a graph from another — see `PlaceGraphSource`.
   */
  twinId?: string;
}

/** A labelled point inside a place. Populated by a later task; empty in v0. */
export interface PlaceLandmark {
  label: string;
  x: number;
  y: number;
  source: string;
  lastSeen?: string;
}

/** One named region of floor. */
export interface Place {
  id: string;
  name: string;
  placeType: PlaceType;
  floor: number;
  /** CCW ring, implicitly closed (the last vertex is not a repeat of the first). */
  polygon: PlaceVertex[];
  source: PlaceSource;
  /** The robot must not stand here (rack face, dock edge). */
  keepout: boolean;
  landmarks: PlaceLandmark[];
}

/** A whole place graph: one frame, many places. */
export interface PlaceGraph {
  version: number;
  frame: PlaceFrame;
  places: Place[];
}

/** A planar pose offered to the resolver. */
export interface PlacePose {
  x: number;
  y: number;
  /** Graph floor; defaults to {@link DEFAULT_PLACE_FLOOR} — see the constant. */
  floor?: number;
}

/**
 * What the tracker currently believes, with everything needed to say it out
 * loud. `null` anywhere a {@link PlaceObservation} is expected means UNKNOWN.
 */
export interface PlaceObservation {
  place: Place;
  confidence: PlaceConfidence;
  /** Metres inside the polygon boundary at the sample that committed it. */
  marginM: number;
  /** Accumulated translation since the last re-anchor, in metres. */
  driftSinceAnchorM: number;
  /** Wall-clock ms of the sample that committed this belief. */
  atMs: number;
}

/** Narrow a {@link PlaceObservation} to the shape that goes on the wire. */
export function toScenePlace(observation: PlaceObservation): ScenePlace {
  return {
    id: observation.place.id,
    name: observation.place.name,
    placeType: observation.place.placeType,
    confidence: observation.confidence,
    source: observation.place.source,
  };
}

// ── geometry ────────────────────────────────────────────────────────────────

/**
 * Is `(x, y)` inside `polygon`? Ray cast along +x, counting crossings.
 *
 * Concave rings are the reason this is a ray cast and not an AABB test: the
 * warehouse graph's CROSS-AISLE is an L, and every "just check the bounding
 * box" shortcut puts the robot in the cross aisle while it stands in an aisle.
 * `zoneUtils.isPointInZone` stays as it is — it answers a different question
 * (fleet `Zone` AABBs, which really are rectangles).
 *
 * A point exactly on an edge is not specified either way, and deliberately not
 * special-cased: the hysteresis margin means no decision is ever taken within
 * 0.30 m of a boundary, so the tie can never reach a caller.
 */
export function pointInPolygon(x: number, y: number, polygon: readonly PlaceVertex[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] as PlaceVertex;
    const [xj, yj] = polygon[j] as PlaceVertex;
    // Half-open crossing test (`yi > y` vs `yj > y`): a vertex is counted once,
    // never twice, so a ray that passes exactly through one does not flip the
    // answer and report a point outside a polygon it sits well inside.
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Shortest distance from `(x, y)` to the segment `a → b`, in metres. */
function distanceToSegment(x: number, y: number, a: PlaceVertex, b: PlaceVertex): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(x - a[0], y - a[1]);
  // Projection parameter, clamped to the segment so a point beyond an endpoint
  // measures to the endpoint rather than to the infinite line.
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSq));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

/**
 * Shortest distance from `(x, y)` to the polygon's boundary, in metres —
 * unsigned, so callers must pair it with {@link pointInPolygon} to know which
 * side they are on. This is the "how far inside am I" the hysteresis rule
 * spends: a doorway or an aisle mouth is exactly where a naive resolver flaps,
 * and the flap is stopped by refusing to commit until the robot is properly in.
 */
export function distanceToBoundaryM(
  x: number,
  y: number,
  polygon: readonly PlaceVertex[],
): number {
  if (polygon.length < 2) return 0;
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distanceToSegment(x, y, polygon[j] as PlaceVertex, polygon[i] as PlaceVertex));
  }
  return best;
}

// ── parsing ─────────────────────────────────────────────────────────────────

function fail(where: string, why: string): never {
  throw new Error(`[PlaceGraph] ${where}: ${why}`);
}

function asVertex(value: unknown, where: string): PlaceVertex {
  if (!Array.isArray(value) || value.length < 2) fail(where, 'a vertex must be [x, y]');
  const x = Number((value as unknown[])[0]);
  const y = Number((value as unknown[])[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail(where, 'a vertex must be two finite numbers');
  return [x, y];
}

/**
 * Validate a parsed place graph, or throw.
 *
 * Strict on purpose. A graph is the robot's claim about a physical building;
 * a typo that quietly degrades to "no places" would be indistinguishable from
 * a robot that has genuinely walked off the map, and the honest-null rule
 * elsewhere in this feature means nobody would ever look twice.
 */
export function parsePlaceGraph(data: unknown, where = 'graph'): PlaceGraph {
  if (!data || typeof data !== 'object') fail(where, 'not an object');
  const raw = data as Record<string, unknown>;

  if (raw.version !== PLACE_GRAPH_VERSION) {
    fail(where, `unsupported version ${String(raw.version)} (this build reads ${PLACE_GRAPH_VERSION})`);
  }

  const frameRaw = raw.frame;
  if (!frameRaw || typeof frameRaw !== 'object') fail(where, 'missing `frame` block');
  const f = frameRaw as Record<string, unknown>;
  // The whole point of the frame block: it is ASSERTED, not assumed.
  if (f.units !== PLACE_FRAME_UNITS) {
    fail(where, `frame.units is ${JSON.stringify(f.units)}, expected ${JSON.stringify(PLACE_FRAME_UNITS)}`);
  }
  if (f.yawConvention !== PLACE_FRAME_YAW_CONVENTION) {
    fail(
      where,
      `frame.yawConvention is ${JSON.stringify(f.yawConvention)}, expected ${JSON.stringify(PLACE_FRAME_YAW_CONVENTION)}`,
    );
  }
  const frame: PlaceFrame = {
    id: typeof f.id === 'string' ? f.id : fail(where, 'frame.id must be a string'),
    kind: typeof f.kind === 'string' ? f.kind : 'unknown',
    units: PLACE_FRAME_UNITS,
    yawConvention: PLACE_FRAME_YAW_CONVENTION,
    // Carried through verbatim when present, and NOT invented when absent: a
    // hand-authored sim graph genuinely belongs to no twin, and defaulting it
    // to something would make the twin check below pass by accident.
    ...(typeof f.twinId === 'string' && f.twinId.length > 0 ? { twinId: f.twinId } : {}),
  };

  if (!Array.isArray(raw.places)) fail(where, '`places` must be an array');
  const seen = new Set<string>();
  const places = (raw.places as unknown[]).map((entry, index): Place => {
    const at = `${where}.places[${index}]`;
    if (!entry || typeof entry !== 'object') fail(at, 'not an object');
    const p = entry as Record<string, unknown>;
    const id = typeof p.id === 'string' && p.id.length > 0 ? p.id : fail(at, '`id` must be a non-empty string');
    if (seen.has(id)) fail(at, `duplicate place id ${id}`);
    seen.add(id);
    const placeType = p.placeType;
    if (typeof placeType !== 'string' || !(PlaceTypes as readonly string[]).includes(placeType)) {
      fail(at, `placeType ${JSON.stringify(placeType)} is not one of ${PlaceTypes.join(' | ')}`);
    }
    const source = p.source;
    if (typeof source !== 'string' || !(PlaceSources as readonly string[]).includes(source)) {
      fail(at, `source ${JSON.stringify(source)} is not one of ${PlaceSources.join(' | ')}`);
    }
    if (!Array.isArray(p.polygon) || p.polygon.length < 3) {
      fail(at, '`polygon` must have at least 3 vertices');
    }
    const floor = p.floor === undefined ? DEFAULT_PLACE_FLOOR : Number(p.floor);
    if (!Number.isFinite(floor)) fail(at, '`floor` must be a number');
    return {
      id,
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : id,
      placeType: placeType as PlaceType,
      floor,
      polygon: (p.polygon as unknown[]).map((v, i) => asVertex(v, `${at}.polygon[${i}]`)),
      source: source as PlaceSource,
      keepout: p.keepout === true,
      landmarks: Array.isArray(p.landmarks) ? (p.landmarks as PlaceLandmark[]) : [],
    };
  });

  return { version: PLACE_GRAPH_VERSION, frame, places };
}

/**
 * Read and validate a place graph from disk. The ONLY I/O in this module, and
 * synchronous on purpose: it runs once at construction, and a robot booting
 * with a broken map should fail there rather than half a walk later.
 */
export function loadPlaceGraph(filePath: string): PlaceGraph {
  return parsePlaceGraph(JSON.parse(readFileSync(filePath, 'utf-8')), filePath);
}

// ── the tracker ─────────────────────────────────────────────────────────────

export interface PlaceTrackerOptions {
  graph: PlaceGraph;
  /**
   * How far inside a polygon the robot must be before a change to it commits,
   * in metres. Default 0.30.
   */
  hysteresisMarginM?: number;
  /**
   * Accumulated translation, in metres, after which the belief degrades to
   * `stale`. Default 15.
   */
  driftBudgetM?: number;
  /** Clock seam for tests. */
  now?: () => number;
}

export const DEFAULT_PLACE_HYSTERESIS_MARGIN_M = 0.3;
export const DEFAULT_PLACE_DRIFT_BUDGET_M = 15;

/**
 * The stateful half: turns a stream of poses into a stable place.
 *
 * Two rules, and they pull in opposite directions on purpose:
 *
 *  - **Hysteresis.** Moving from one named place to another needs
 *    {@link PLACE_CONFIRM_SAMPLES} consecutive samples at least
 *    `hysteresisMarginM` inside the new polygon. Until then the previous place
 *    is held, including for the ~0.30 m band just past the shared edge. That
 *    band is the price of not flapping at every aisle mouth and dock threshold.
 *
 *  - **Honesty.** A `null` pose, or a pose inside NO polygon, is UNKNOWN
 *    IMMEDIATELY — no confirmation, no holding the previous answer. Hysteresis
 *    exists to arbitrate between two places the robot is plausibly in; it is
 *    not a licence to keep asserting a place the geometry says the robot has
 *    left. `null` means UNKNOWN everywhere in this feature and is never
 *    silently replaced by the last known place.
 */
export class PlaceTracker {
  private readonly graph: PlaceGraph;
  private readonly hysteresisMarginM: number;
  private readonly driftBudgetM: number;
  private readonly now: () => number;

  private committed: PlaceObservation | null = null;
  /** Candidate place id and how many consecutive qualifying samples it has. */
  private pending: { id: string; samples: number } | null = null;
  /** Last pose seen, used to accumulate translation. */
  private lastPose: { x: number; y: number } | null = null;
  private driftSinceAnchorM = 0;
  /**
   * The place an operator declared out loud, as a copy of the graph place with
   * `source: 'declared'`. Null when nobody has re-anchored, or when geometry has
   * since confirmed somewhere else. See {@link declare}.
   */
  private declaredPlace: Place | null = null;

  constructor(options: PlaceTrackerOptions) {
    this.graph = options.graph;
    this.hysteresisMarginM = options.hysteresisMarginM ?? DEFAULT_PLACE_HYSTERESIS_MARGIN_M;
    this.driftBudgetM = options.driftBudgetM ?? DEFAULT_PLACE_DRIFT_BUDGET_M;
    this.now = options.now ?? Date.now;
  }

  /** The frame this tracker's graph is expressed in. */
  getFrame(): PlaceFrame {
    return this.graph.frame;
  }

  /** The graph this tracker resolves against (read-only use). */
  getGraph(): PlaceGraph {
    return this.graph;
  }

  /** Look a place up by id, case-insensitively. Null when the graph has none. */
  findPlaceById(placeId: string): Place | null {
    const wanted = placeId.trim().toLowerCase();
    return this.graph.places.find((p) => p.id.toLowerCase() === wanted) ?? null;
  }

  /** Current belief, or null for UNKNOWN. */
  current(): PlaceObservation | null {
    return this.committed;
  }

  /** Accumulated translation since the last re-anchor, in metres. */
  getDriftM(): number {
    return this.driftSinceAnchorM;
  }

  /**
   * Declare the pose trustworthy again and spend the drift budget afresh.
   *
   * v0's only re-anchor is an operator saying so — there is no loop closure and
   * no fiducial. Keeping it as an explicit call rather than an automatic reset
   * is the point: nothing the robot does to itself may clear `stale`.
   */
  anchor(): void {
    this.driftSinceAnchorM = 0;
    if (this.committed) this.committed = { ...this.committed, confidence: 'confident', driftSinceAnchorM: 0 };
  }

  /**
   * *"You are in aisle 3."* — an operator standing next to the robot re-anchors
   * it (TASK-200). Returns the new belief, or `null` when the graph has no such
   * place (in which case NOTHING changes: a re-anchor onto a place that does not
   * exist must not silently become a re-anchor onto nothing).
   *
   * This is the ONE thing that outranks geometry, and only because of what it
   * is: a human who can see the robot beats an odometry estimate that has been
   * integrating error for thirty metres — which is precisely the situation that
   * makes a re-anchor necessary. Concretely, the declared place survives a pose
   * that has drifted OFF the map (inside no polygon), where the resolver would
   * otherwise answer UNKNOWN.
   *
   * It does NOT survive:
   *  - a `null` pose — no sample at all is not evidence for anything, and the
   *    honest-null rule stays absolute;
   *  - a DIFFERENT place confirmed by the normal hysteresis (two consecutive
   *    samples well inside it) — at that point geometry has positive evidence
   *    of its own and the declaration has been overtaken by events.
   *
   * Note it is also a re-anchor in the {@link anchor} sense: the drift budget is
   * spent afresh, because the operator has just told us the accumulated error no
   * longer matters.
   *
   * SAFETY CONSEQUENCE, and the reason this paragraph exists: spending the
   * budget flips the next {@link observe} back to `confident`, which makes the
   * geofence trust the pose again — WITHOUT a single coordinate having been
   * corrected. That is fine in the re-arming direction (a keepout that the
   * uncorrected numbers put us inside still stops the robot) and NOT fine in the
   * releasing direction: it would let "you are in aisle 3" un-latch a
   * `zone_violation` stop, turning an assertion about a PLACE into an assertion
   * of CLEARANCE. `RobotStateManager.guardReanchorRelease` is what stops that,
   * and it is the only place that may — this class knows nothing about stops.
   */
  declare(placeId: string): PlaceObservation | null {
    const place = this.findPlaceById(placeId);
    if (!place) return null;
    this.declaredPlace = { ...place, source: 'declared' };
    this.pending = null;
    this.driftSinceAnchorM = 0;
    const marginM = this.lastPose
      ? distanceToBoundaryM(this.lastPose.x, this.lastPose.y, place.polygon)
      : 0;
    this.committed = this.observe(this.declaredPlace, marginM);
    return this.committed;
  }

  /** The place an operator declared and geometry has not yet overtaken. */
  declaredPlaceId(): string | null {
    return this.declaredPlace?.id ?? null;
  }

  /**
   * Offer one pose sample whose frame is NOT registered against this graph.
   *
   * The map cannot be consulted — the polygons and the pose are numbers about
   * different origins — so no place is ever *entered* here and no clearance is
   * ever claimed (`marginM` is 0). Two things still happen, and they are the
   * whole point:
   *
   *  1. **The drift budget still runs.** Odometry TRANSLATION is
   *     frame-independent: the unknown is the origin offset, not the metre. A
   *     robot that has walked 200 m since an operator said "you are in aisle 1"
   *     is exactly as likely to have left it as one in a registered frame, so
   *     the declared belief goes `stale` on the same budget instead of reading
   *     `confident` forever (TASK-200 review, residual finding).
   *  2. **`lastPose` advances**, so the accumulation is continuous rather than
   *     restarting from whatever the last *registered* sample happened to be.
   *
   * A `null` pose is delegated to {@link update} unchanged: the honest-null rule
   * outranks the frame question and outranks a declaration.
   */
  updateUnregisteredFrame(pose: PlacePose | null): PlaceObservation | null {
    if (pose === null || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
      return this.update(pose);
    }

    if (this.lastPose) {
      this.driftSinceAnchorM += Math.hypot(pose.x - this.lastPose.x, pose.y - this.lastPose.y);
    }
    this.lastPose = { x: pose.x, y: pose.y };

    if (!this.declaredPlace) {
      // Geometry answers nothing and nobody has declared anything: UNKNOWN.
      this.committed = null;
      return null;
    }

    // Margin 0 — we are honestly not known to be inside any polygon, and a
    // declared belief must never read as clearance from a keepout boundary.
    this.committed = this.observe(this.declaredPlace, 0);
    return this.committed;
  }

  /**
   * Offer one pose sample. Returns the belief AFTER this sample — which may be
   * the same one as before (held through the hysteresis band), a new one, or
   * `null` for UNKNOWN.
   */
  update(pose: PlacePose | null): PlaceObservation | null {
    if (pose === null || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
      // No pose is no place. The drift accumulator is NOT reset — losing sight
      // of the pose does not un-walk the metres already walked, and the robot
      // may well have kept moving while we could not see it.
      this.lastPose = null;
      this.pending = null;
      this.committed = null;
      // An operator declaration does not survive this either: it is evidence
      // about where the robot WAS when they said it, and with no pose at all
      // there is nothing left tying that statement to the present.
      this.declaredPlace = null;
      return null;
    }

    if (this.lastPose) {
      this.driftSinceAnchorM += Math.hypot(pose.x - this.lastPose.x, pose.y - this.lastPose.y);
    }
    this.lastPose = { x: pose.x, y: pose.y };

    const hit = this.findPlace(pose);
    if (!hit) {
      this.pending = null;
      if (this.declaredPlace) {
        // Drifted off the map, but an operator has told us where we are. Margin
        // 0: we are honestly not inside any polygon, and the geofence must not
        // read a declared belief as clearance from a keepout boundary.
        this.committed = this.observe(this.declaredPlace, 0);
        return this.committed;
      }
      this.committed = null;
      return null;
    }

    if (this.declaredPlace && this.declaredPlace.id === hit.id) {
      // Geometry agrees with the operator. Keep `source: 'declared'` — the
      // declaration is still what the belief rests on, and saying 'surveyed'
      // here would hide that a human had to intervene.
      this.pending = null;
      this.committed = this.observe(this.declaredPlace, distanceToBoundaryM(pose.x, pose.y, hit.polygon));
      return this.committed;
    }

    if (this.committed && this.committed.place.id === hit.id) {
      // Still where we thought — refresh the age and the drift-derived
      // confidence, but nothing about the identity changes.
      this.pending = null;
      this.committed = this.observe(hit, distanceToBoundaryM(pose.x, pose.y, hit.polygon));
      return this.committed;
    }

    const marginM = distanceToBoundaryM(pose.x, pose.y, hit.polygon);
    if (marginM < this.hysteresisMarginM) {
      // Inside the new polygon but not convincingly: hold what we had. A single
      // step across a shared edge is how a robot "changes rooms" four times
      // while standing in a doorway.
      this.pending = null;
      return this.committed;
    }

    this.pending =
      this.pending && this.pending.id === hit.id
        ? { id: hit.id, samples: this.pending.samples + 1 }
        : { id: hit.id, samples: 1 };

    if (this.pending.samples < PLACE_CONFIRM_SAMPLES) return this.committed;

    this.pending = null;
    // Geometry now has positive evidence of its own for somewhere else, so the
    // operator's declaration has been overtaken by events and stands down.
    this.declaredPlace = null;
    this.committed = this.observe(hit, marginM);
    return this.committed;
  }

  /**
   * Which place contains this pose? Floor predicate FIRST: `RobotLocation`
   * carries a floor and the fleet's `Zone` is unique on `[name, floor]`, so two
   * places with the same footprint on different storeys are a normal thing to
   * author and must never collide.
   *
   * The graphs are authored non-overlapping (verified on a 0.05 m grid), so at
   * most one place matches. The deepest-margin tie-break below is not a policy,
   * only a guarantee that a graph which breaks that invariant still resolves
   * deterministically instead of by array order.
   */
  private findPlace(pose: PlacePose): Place | null {
    const floor = pose.floor ?? DEFAULT_PLACE_FLOOR;
    let best: Place | null = null;
    let bestMargin = -Infinity;
    for (const place of this.graph.places) {
      if (place.floor !== floor) continue;
      if (!pointInPolygon(pose.x, pose.y, place.polygon)) continue;
      const margin = distanceToBoundaryM(pose.x, pose.y, place.polygon);
      if (margin > bestMargin) {
        best = place;
        bestMargin = margin;
      }
    }
    return best;
  }

  private observe(place: Place, marginM: number): PlaceObservation {
    return {
      place,
      confidence: this.driftSinceAnchorM > this.driftBudgetM ? 'stale' : 'confident',
      marginM,
      driftSinceAnchorM: this.driftSinceAnchorM,
      atMs: this.now(),
    };
  }
}
