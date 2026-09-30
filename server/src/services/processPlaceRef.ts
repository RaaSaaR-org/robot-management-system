/**
 * @file processPlaceRef.ts
 * @description A process "Move to place" step stores a place reference
 *              (`actionConfig.place = { twinId, placeId }`) instead of frozen
 *              coordinates. This module validates that reference on save and
 *              resolves it to the place centroid when the step runs (TASK-332).
 * @feature processes
 */

import type { PlaceGraphDTO, PlaceGraphPlaceDTO } from '../types/twin.types.js';
import { polygonCentroid } from './twinPlaceGeometry.js';

/** The step's place reference. */
export interface StepPlaceRef {
  twinId: string;
  placeId: string;
}

/** Loads a twin's place graph, or null when the twin is unknown. */
export type PlaceGraphLoader = (twinId: string) => Promise<PlaceGraphDTO | null>;

/** What a resolved step hands the robot task. */
export interface ResolvedStepPlace {
  twinId: string;
  place: PlaceGraphPlaceDTO;
  location: { x: number; y: number; place: string };
}

export type PlaceRefResult =
  | { ok: true; value: ResolvedStepPlace }
  | { ok: false; error: string };

/**
 * Read `actionConfig.place`. `undefined` when the step has no place reference
 * (legacy `location` steps and every other action type); a string error when
 * it has one that is malformed.
 */
export function readPlaceRef(
  actionConfig: Record<string, unknown> | null | undefined
): StepPlaceRef | undefined | string {
  const raw = actionConfig?.place;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') return 'actionConfig.place must be an object { twinId, placeId }';
  const { twinId, placeId } = raw as Record<string, unknown>;
  if (typeof twinId !== 'string' || twinId.length === 0) {
    return 'actionConfig.place.twinId must be a non-empty string';
  }
  if (typeof placeId !== 'string' || placeId.length === 0) {
    return 'actionConfig.place.placeId must be a non-empty string';
  }
  return { twinId, placeId };
}

/**
 * Resolve a place reference against its twin's place graph: the place must
 * exist and must not be a keepout. The location is the polygon centroid.
 */
export async function resolvePlaceRef(
  ref: StepPlaceRef,
  loadGraph: PlaceGraphLoader
): Promise<PlaceRefResult> {
  const graph = await loadGraph(ref.twinId);
  if (!graph) {
    return { ok: false, error: `Site ${ref.twinId} does not exist` };
  }
  const place = graph.places.find((p) => p.id === ref.placeId);
  if (!place) {
    return { ok: false, error: `Place "${ref.placeId}" does not exist in site ${ref.twinId}` };
  }
  if (place.keepout) {
    return { ok: false, error: `Place "${place.name}" is a keepout; a robot cannot be sent there` };
  }
  const centroid = polygonCentroid(place.polygon.map(([x, y]) => ({ x, y })));
  if (!centroid) {
    return { ok: false, error: `Place "${place.name}" has no polygon` };
  }
  return { ok: true, value: { twinId: ref.twinId, place, location: { ...centroid, place: place.id } } };
}

/**
 * Validate every step template's place reference. Returns the first error,
 * prefixed with the step name, or null when all are valid.
 */
export async function validateStepPlaces(
  steps: ReadonlyArray<{ name?: string; actionConfig?: Record<string, unknown> }>,
  loadGraph: PlaceGraphLoader
): Promise<string | null> {
  for (const step of steps) {
    const ref = readPlaceRef(step.actionConfig);
    if (ref === undefined) continue;
    const label = step.name ? `Step "${step.name}": ` : '';
    if (typeof ref === 'string') return label + ref;
    const result = await resolvePlaceRef(ref, loadGraph);
    if (!result.ok) return label + result.error;
  }
  return null;
}
