/**
 * @file TwinPlaceGraphService.ts
 * @description Generate the robot's place graph (`places/_index.json`, TASK-200)
 *              from a DigitalTwin's `TwinZone` rows. The robot does ZERO
 *              translation on the result — it parses this payload with the same
 *              validator it uses for a hand-authored graph on disk.
 * @feature digitaltwin
 */

import { digitalTwinRepository, twinZoneRepository } from '../repositories/index.js';
import {
  PLACE_FRAME_UNITS,
  PLACE_FRAME_YAW_CONVENTION,
  PLACE_GRAPH_VERSION,
  TwinPlaceSources,
  TwinPlaceTypes,
} from '../types/twin.types.js';
import type {
  DigitalTwinRecord,
  PlaceGraphDTO,
  PlaceGraphPlaceDTO,
  TwinPlaceSource,
  TwinPlaceType,
  TwinZoneRecord,
} from '../types/twin.types.js';

/**
 * Zone types that become entries in the place graph, and what `keepout` they
 * carry there.
 *
 * WHICH IS GENERATED FROM WHICH (the settled decision, written down because the
 * task asks for it): **`TwinZone` is the single source of truth and the place
 * graph is generated from it.** The Nav2 raster and `places/_index.json` are two
 * renderings of the same rows, so a keepout cannot exist in one and not the
 * other. The robot never authors places; it only caches what this returns.
 *
 * `workcell`, `charging` and `speed` zones are deliberately NOT places: they are
 * task/behaviour annotations, not the vocabulary an operator uses for "where are
 * you". Promote one by giving it `type: 'room'` in the authoring overlay.
 */
const PLACE_ZONE_TYPES: ReadonlyMap<string, boolean> = new Map([
  ['room', false],
  ['keepout', true],
]);

/** Default place type when the operator did not pick one. Honest, not guessed. */
const DEFAULT_PLACE_TYPE: TwinPlaceType = 'unknown';

/**
 * Zones authored on a scanned twin are surveyed by construction — the polygon
 * was drawn on real point-cloud geometry. `observed`/`declared` exist for
 * robot-side beliefs and are never produced here.
 */
const ZONE_PLACE_SOURCE: TwinPlaceSource = 'surveyed';

/** Read a metadata key as a string, or undefined. */
function metaString(zone: TwinZoneRecord, key: string): string | undefined {
  const value = zone.metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The robot's place-id grammar, duplicated here on purpose.
 *
 * THE OTHER COPY IS `SAFE_PLACE_ID` in
 * `robot-agent/src/agent-mode/workspace.ts` — change one, change both. It is
 * duplicated rather than imported because the two processes ship separately and
 * a shared package would make the robot's on-disk grammar depend on a server
 * release.
 *
 * Why it matters here: an id that violates this grammar is still accepted by
 * the robot's place resolver and printed by the planner, but
 * `Workspace.placeNoteFile()` returns null for it, so every `remember` for that
 * place fails with "not a usable place id" — invisible until an operator tries
 * to leave a note there. A 68-character zone name used to produce exactly that.
 */
export const ROBOT_SAFE_PLACE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Max id length the grammar above allows (1 leading char + 63). */
export const PLACE_ID_MAX_LENGTH = 64;

/**
 * Truncate to the robot's length limit without leaving a trailing separator
 * (`AISLE-` is legal but ugly, and a trailing `-` collides with the
 * disambiguation suffix below).
 */
function capPlaceId(slug: string): string {
  const capped = slug.slice(0, PLACE_ID_MAX_LENGTH).replace(/[-._]+$/, '');
  return capped.length > 0 ? capped : 'PLACE';
}

/**
 * `Aisle 3` → `AISLE-3`. Uppercase because place ids are spoken and printed as
 * names ("You are in AISLE-3"), and stable because it is derived from the name
 * the operator typed, not from the row's uuid — a re-drawn polygon keeps its id.
 *
 * The result always satisfies {@link ROBOT_SAFE_PLACE_ID}: a long zone name is
 * capped here rather than handed to the robot as an id it can display but never
 * write a note for.
 */
export function slugifyPlaceId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  return capPlaceId(slug);
}

/** Narrow an untrusted metadata value to a place type. */
function placeTypeOf(zone: TwinZoneRecord): TwinPlaceType {
  const raw = metaString(zone, 'placeType');
  return raw && (TwinPlaceTypes as readonly string[]).includes(raw)
    ? (raw as TwinPlaceType)
    : DEFAULT_PLACE_TYPE;
}

/** Integer floor in the twin's own frame. Not the fleet's storey string. */
function floorOf(zone: TwinZoneRecord): number {
  const raw = zone.metadata?.floor;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export class TwinPlaceGraphService {
  private static instance: TwinPlaceGraphService;

  private constructor() {}

  static getInstance(): TwinPlaceGraphService {
    if (!TwinPlaceGraphService.instance) {
      TwinPlaceGraphService.instance = new TwinPlaceGraphService();
    }
    return TwinPlaceGraphService.instance;
  }

  /**
   * Pure: twin + zones → place graph. No I/O, so the shape is testable without
   * a database.
   *
   * Zones with fewer than 3 vertices are DROPPED rather than emitted degenerate:
   * the robot's parser rejects the whole graph on one bad polygon (deliberately
   * — a typo must not quietly degrade to "no places"), and one half-drawn
   * polygon left over in the authoring UI would take the entire building's
   * place awareness offline.
   */
  buildPlaceGraph(twin: DigitalTwinRecord, zones: TwinZoneRecord[]): PlaceGraphDTO {
    const places: PlaceGraphPlaceDTO[] = [];
    const usedIds = new Set<string>();

    for (const zone of zones) {
      const keepout = PLACE_ZONE_TYPES.get(zone.type);
      if (keepout === undefined) continue;
      if (!Array.isArray(zone.points) || zone.points.length < 3) continue;

      const base = slugifyPlaceId(metaString(zone, 'placeId') ?? zone.name);
      let id = base;
      // Two zones named "Aisle 3" are an authoring mistake, but a graph with a
      // duplicate id is REJECTED wholesale by the robot. Disambiguate instead —
      // and keep the suffixed id inside the robot's length limit too, which is
      // why the stem is re-capped against the suffix rather than appended to.
      let suffix = 2;
      while (usedIds.has(id)) {
        const tag = `-${suffix++}`;
        id = `${capPlaceId(base.slice(0, PLACE_ID_MAX_LENGTH - tag.length))}${tag}`;
      }
      usedIds.add(id);

      places.push({
        id,
        name: zone.name,
        placeType: placeTypeOf(zone),
        floor: floorOf(zone),
        polygon: zone.points.map((p) => [p.x, p.y] as [number, number]),
        source: ZONE_PLACE_SOURCE,
        keepout,
        landmarks: [],
      });
    }

    return {
      version: PLACE_GRAPH_VERSION,
      frame: {
        id: `twin-${twin.id}`,
        kind: 'site',
        units: PLACE_FRAME_UNITS,
        yawConvention: PLACE_FRAME_YAW_CONVENTION,
        twinId: twin.id,
      },
      places,
    };
  }

  /** Load twin + zones and build the graph, or null when the twin is unknown. */
  async exportPlaceGraph(twinId: string): Promise<PlaceGraphDTO | null> {
    const twin = await digitalTwinRepository.findById(twinId);
    if (!twin) return null;
    const zones = await twinZoneRepository.listByTwin(twinId);
    return this.buildPlaceGraph(twin, zones);
  }
}

/** The place sources this server can emit (re-exported for callers/tests). */
export const PLACE_GRAPH_SOURCES = TwinPlaceSources;

export const twinPlaceGraphService = TwinPlaceGraphService.getInstance();
