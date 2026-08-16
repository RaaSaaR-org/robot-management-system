/**
 * @file inspector.ts
 * @description The patrol comparators (TASK-212): the perceptual-hash gate, the
 *              checkpoint checklist (ONE vision-model call, then an item-by-item
 *              diff), the en-route label-set diff and occupancy-map diff (no
 *              model call at all), and the Confirmer that turns candidates into
 *              findings only after N-of-M observations agree, one per type per
 *              place per run. Everything here is pure over its inputs; the
 *              PatrolRunner owns the state around it.
 * @feature agentmode
 * @status live-conditional
 */

import { decode as decodeJpeg } from 'jpeg-js';
import { config } from '../config/config.js';
import { agentModelRef, extractJsonObject, genkitGenerate, type GenerateFn } from './llm.js';
import type { DynamicObstacle, OccupancyMapSnapshot } from './occupancy-map.js';
import { pointInPolygon, type Place } from './place-resolver.js';
import { buildChecklistPrompt } from './prompts.js';
import type {
  PatrolCheckpoint,
  PatrolFindingEvidence,
  PatrolFindingSource,
  PatrolFindingType,
} from './types.js';

// ============================================================================
// 1. Perceptual hash — the cheap gate in front of the model
// ============================================================================

/** Side of the grey thumbnail the DCT runs over. */
const PHASH_SIZE = 32;
/** Low-frequency block kept from the DCT → 8×8 = 64 bits. */
const PHASH_LOW = 8;

/**
 * pHash of a JPEG: decode, downscale to a 32×32 grey thumbnail (area average),
 * 2-D DCT, keep the 8×8 low-frequency block, one bit per coefficient above the
 * block's median. Returns null when the bytes are not a decodable JPEG — a
 * null never gates anything, so a broken frame always reaches the model.
 */
export function perceptualHash(jpeg: Buffer): bigint | null {
  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = decodeJpeg(jpeg, { useTArray: true, formatAsRGBA: true, tolerantDecoding: true });
  } catch {
    return null;
  }
  if (img.width <= 0 || img.height <= 0) return null;
  const grey = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  // Area-average downscale: every source pixel lands in exactly one bucket.
  const counts = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let y = 0; y < img.height; y++) {
    const ty = Math.min(PHASH_SIZE - 1, Math.floor((y * PHASH_SIZE) / img.height));
    for (let x = 0; x < img.width; x++) {
      const tx = Math.min(PHASH_SIZE - 1, Math.floor((x * PHASH_SIZE) / img.width));
      const i = (y * img.width + x) * 4;
      const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      grey[ty * PHASH_SIZE + tx] += l;
      counts[ty * PHASH_SIZE + tx] += 1;
    }
  }
  for (let i = 0; i < grey.length; i++) if (counts[i] > 0) grey[i] /= counts[i];

  // Separable DCT-II, only the LOW×LOW block is needed.
  const cosTable = new Float64Array(PHASH_LOW * PHASH_SIZE);
  for (let u = 0; u < PHASH_LOW; u++) {
    for (let x = 0; x < PHASH_SIZE; x++) {
      cosTable[u * PHASH_SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * PHASH_SIZE));
    }
  }
  const rows = new Float64Array(PHASH_SIZE * PHASH_LOW); // rows[y][u]
  for (let y = 0; y < PHASH_SIZE; y++) {
    for (let u = 0; u < PHASH_LOW; u++) {
      let s = 0;
      for (let x = 0; x < PHASH_SIZE; x++) s += grey[y * PHASH_SIZE + x] * cosTable[u * PHASH_SIZE + x];
      rows[y * PHASH_LOW + u] = s;
    }
  }
  const dct = new Float64Array(PHASH_LOW * PHASH_LOW); // dct[v][u]
  for (let v = 0; v < PHASH_LOW; v++) {
    for (let u = 0; u < PHASH_LOW; u++) {
      let s = 0;
      for (let y = 0; y < PHASH_SIZE; y++) s += rows[y * PHASH_LOW + u] * cosTable[v * PHASH_SIZE + y];
      dct[v * PHASH_LOW + u] = s;
    }
  }
  // Median over the block EXCLUDING the DC term, the usual pHash convention —
  // DC is the mean brightness and would otherwise dominate the threshold.
  const coeffs = Array.from(dct.subarray(1)).sort((a, b) => a - b);
  const median = coeffs[Math.floor(coeffs.length / 2)] ?? 0;
  let hash = 0n;
  for (let i = 0; i < dct.length; i++) {
    hash <<= 1n;
    if (dct[i] > median) hash |= 1n;
  }
  return hash;
}

/** 1 − hamming/64: 1 = identical hashes, 0.5 ≈ unrelated pictures. */
export function hashSimilarity(a: bigint, b: bigint): number {
  let x = a ^ b;
  let bits = 0;
  while (x > 0n) {
    bits += Number(x & 1n);
    x >>= 1n;
  }
  return 1 - bits / 64;
}

export interface HashGateResult {
  /** True when the two frames are alike enough that no model call is needed. */
  unchanged: boolean;
  /** Similarity in [0, 1], or null when either side could not be hashed. */
  similarity: number | null;
}

/**
 * The cascade's first stage. `unchanged` only when BOTH frames hash and the
 * similarity clears the gate — a frame that cannot be hashed is not "the same".
 */
export function gateByHash(
  current: Buffer,
  reference: Buffer | null,
  threshold: number = config.agentMode.patrol.hashGate,
): HashGateResult {
  if (!reference) return { unchanged: false, similarity: null };
  const a = perceptualHash(current);
  const b = perceptualHash(reference);
  if (a === null || b === null) return { unchanged: false, similarity: null };
  const similarity = hashSimilarity(a, b);
  return { unchanged: similarity >= threshold, similarity };
}

// ============================================================================
// 2. Checklist — one VLM call per checkpoint, structured questions only
// ============================================================================

export type DoorState = 'open' | 'closed' | 'none';
export type LightsState = 'yes' | 'no' | 'unknown';

/** The parsed answer to {@link CHECKLIST_PROMPT}. */
export interface ChecklistAnswers {
  personPresent: boolean;
  doorState: DoorState;
  objectOnFloor: { yes: boolean; what: string };
  lightsOn: LightsState;
  outOfPlace: string[];
  /** One boolean per operator expectation, in order; missing answers are `null`. */
  expectations: Array<boolean | null>;
  oneLine: string;
  /**
   * True when the model's text could not be parsed (or gave no usable
   * `personPresent` verdict) and the fields are defaults. A degraded answer is
   * NOT a "no person" verdict — callers must not store the frame on it.
   */
  degraded: boolean;
}

function normLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Defensive parse — never throws; a garbled answer degrades to "nothing seen". */
export function parseChecklistAnswer(text: string, expectationCount: number): ChecklistAnswers {
  const degraded: ChecklistAnswers = {
    personPresent: false,
    doorState: 'none',
    objectOnFloor: { yes: false, what: '' },
    lightsOn: 'unknown',
    outOfPlace: [],
    expectations: Array.from({ length: expectationCount }, () => null),
    oneLine: text.trim().slice(0, 300) || '(the vision model returned nothing)',
    degraded: true,
  };
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object') return degraded;
  const o = parsed as Record<string, unknown>;
  const door = typeof o.doorState === 'string' ? o.doorState.trim().toLowerCase() : 'none';
  const lights = typeof o.lightsOn === 'string' ? o.lightsOn.trim().toLowerCase() : 'unknown';
  let onFloor = { yes: false, what: '' };
  if (o.objectOnFloor && typeof o.objectOnFloor === 'object') {
    const f = o.objectOnFloor as Record<string, unknown>;
    onFloor = {
      yes: f.yes === true || (typeof f.yes === 'string' && /^(yes|true)$/i.test(f.yes)),
      what: typeof f.what === 'string' ? normLabel(f.what) : '',
    };
  } else if (typeof o.objectOnFloor === 'boolean') {
    onFloor = { yes: o.objectOnFloor, what: '' };
  } else if (typeof o.objectOnFloor === 'string') {
    const s = o.objectOnFloor.trim().toLowerCase();
    onFloor = { yes: s !== '' && s !== 'no' && s !== 'none' && s !== 'false', what: /^(yes|no|none|false|true)$/.test(s) ? '' : s };
  }
  const outOfPlace = Array.isArray(o.outOfPlace)
    ? o.outOfPlace.filter((x): x is string => typeof x === 'string').map(normLabel).filter(Boolean).slice(0, 5)
    : [];
  const rawExp = Array.isArray(o.expectations) ? o.expectations : [];
  const expectations: Array<boolean | null> = [];
  for (let i = 0; i < expectationCount; i++) {
    const v = rawExp[i];
    if (typeof v === 'boolean') expectations.push(v);
    else if (typeof v === 'string' && /^(yes|true)$/i.test(v)) expectations.push(true);
    else if (typeof v === 'string' && /^(no|false)$/i.test(v)) expectations.push(false);
    else expectations.push(null);
  }
  const outOfPlacePerson = outOfPlace.some((l) => /person|human|people/.test(l));
  // `personPresent` is the one answer storage hangs on, so it is parsed
  // strictly: a boolean or a "yes"/"no"-ish string is a verdict; anything else
  // (missing, prose, null) is NO verdict and the whole answer counts as
  // degraded — the capture path then drops the frame instead of storing it.
  const pp = o.personPresent;
  let personVerdict: boolean | null = null;
  if (typeof pp === 'boolean') personVerdict = pp;
  else if (typeof pp === 'string' && /^(yes|true)$/i.test(pp.trim())) personVerdict = true;
  else if (typeof pp === 'string' && /^(no|false)$/i.test(pp.trim())) personVerdict = false;
  if (personVerdict === null && !outOfPlacePerson) {
    return { ...degraded, oneLine: typeof o.oneLine === 'string' && o.oneLine.trim() ? o.oneLine.trim() : degraded.oneLine };
  }
  return {
    personPresent: personVerdict === true || outOfPlacePerson,
    doorState: door === 'open' || door === 'closed' ? door : 'none',
    objectOnFloor: onFloor,
    lightsOn: lights === 'yes' || lights === 'no' ? lights : 'unknown',
    outOfPlace,
    expectations,
    oneLine: typeof o.oneLine === 'string' && o.oneLine.trim() ? o.oneLine.trim() : '(no description)',
    degraded: false,
  };
}

export interface ChecklistDeps {
  generate?: GenerateFn;
  /** Full model ref; default `<prefix>/<AGENT_VISION_MODEL>`. */
  modelRef?: string;
}

export interface ChecklistResult {
  answers: ChecklistAnswers;
  model: string;
  raw: string;
}

/**
 * THE one model call of a checkpoint inspection. Throws only when the request
 * itself fails (model down) — the caller records `inspection: 'error'`.
 */
export async function runChecklist(
  imageB64: string,
  expectations: readonly string[],
  deps: ChecklistDeps = {},
): Promise<ChecklistResult> {
  const generate = deps.generate ?? genkitGenerate;
  const model = deps.modelRef ?? (await agentModelRef(config.agentMode.visionModel));
  const res = await generate({
    model,
    prompt: [
      { media: { url: `data:image/jpeg;base64,${imageB64}`, contentType: 'image/jpeg' } },
      { text: buildChecklistPrompt(expectations) },
    ],
    temperature: 0,
    thinking: config.agentMode.visionThinking,
  });
  const raw = res.text ?? '';
  return { answers: parseChecklistAnswer(raw, expectations.length), model, raw };
}

// ============================================================================
// 3. Candidates
// ============================================================================

/**
 * Something that MIGHT be a finding. `key` is what the Confirmer counts on —
 * type × place — so a semantic and a geometric sighting of the same crate in
 * the same room are one candidate, and the cooldown ("one finding per type per
 * place per run") falls out of the same key. Checkpoint candidates key on
 * type × place × checkpoint instead: two checkpoints in one room are two views
 * with two photo pairs, and a re-observation must never swap the evidence of
 * one view under the summary of the other.
 */
export interface Candidate {
  key: string;
  type: PatrolFindingType;
  source: PatrolFindingSource;
  place: string | null;
  checkpointId?: string | null;
  summary: string;
  evidence: PatrolFindingEvidence;
  confidence: number;
  model: string | null;
}

export function candidateKey(type: PatrolFindingType, place: string | null, checkpointId?: string | null): string {
  return checkpointId ? `${type}|${place ?? '?'}|cp:${checkpointId}` : `${type}|${place ?? '?'}`;
}

/** One differing checklist item, before it becomes a candidate. */
export interface ChecklistDiffItem {
  item: string;
  baseline: string;
  current: string;
  type: PatrolFindingType;
  summary: string;
}

function placeLabel(place: string | null): string {
  return place ? place.replace(/-/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : 'an unknown place';
}

/**
 * Item-by-item diff of two checklist answers. Only CHANGES TOWARD "not normal"
 * produce items — a door that was open at baseline and is closed now is not a
 * finding, a light that went off is not either. Operator expectations are
 * judged on the current frame alone: an expectation the operator wrote down
 * and the frame does not meet is a finding whatever the baseline said.
 *
 * `acceptedAnswers` (from "this is normal") widens what counts as baseline: an
 * item whose current answer was accepted before raises nothing.
 */
export function checklistCompare(
  current: ChecklistAnswers,
  baseline: ChecklistAnswers,
  checkpoint: Pick<PatrolCheckpoint, 'expectations' | 'placeId' | 'name'>,
  acceptedAnswers: Record<string, string[]> = {},
): ChecklistDiffItem[] {
  const items: ChecklistDiffItem[] = [];
  const accepted = (item: string, value: string): boolean =>
    (acceptedAnswers[item] ?? []).map(normLabel).includes(normLabel(value));
  // "Living room (Living Room)" is what naming a checkpoint after its own place
  // produced — the parenthetical only earns its place when it says something
  // the checkpoint name does not (seen live on 2026-08-16).
  const place = placeLabel(checkpoint.placeId);
  const where =
    normLabel(checkpoint.name) === normLabel(place) ? checkpoint.name : `${checkpoint.name} (${place})`;

  if (current.personPresent && !baseline.personPresent && !accepted('personPresent', 'true')) {
    items.push({ item: 'personPresent', baseline: 'false', current: 'true', type: 'person', summary: `person at ${where}` });
  }
  if (current.doorState === 'open' && baseline.doorState !== 'open' && !accepted('doorState', 'open')) {
    items.push({ item: 'doorState', baseline: baseline.doorState, current: 'open', type: 'door_open', summary: `door open at ${where}` });
  }
  if (current.objectOnFloor.yes && !baseline.objectOnFloor.yes) {
    const what = current.objectOnFloor.what || 'object';
    if (!accepted('objectOnFloor', what) && !accepted('objectOnFloor', 'yes')) {
      items.push({
        item: 'objectOnFloor',
        baseline: 'no',
        current: what === 'object' ? 'yes' : `yes: ${what}`,
        type: 'object_on_floor',
        summary: `${what} on the floor at ${where}`,
      });
    }
  }
  if (current.lightsOn === 'yes' && baseline.lightsOn === 'no' && !accepted('lightsOn', 'yes')) {
    items.push({ item: 'lightsOn', baseline: 'no', current: 'yes', type: 'lights_on', summary: `lights on at ${where}` });
  }
  const baseOut = new Set(baseline.outOfPlace.map(normLabel));
  const added = current.outOfPlace.map(normLabel).filter((l) => !baseOut.has(l) && !accepted('outOfPlace', l));
  if (added.length > 0) {
    items.push({
      item: 'outOfPlace',
      baseline: baseline.outOfPlace.join(', ') || '(none)',
      current: added.join(', '),
      type: 'out_of_place',
      summary: `out of place at ${where}: ${added.join(', ')}`,
    });
  }
  const expectations = checkpoint.expectations ?? [];
  expectations.forEach((text, i) => {
    const cur = current.expectations[i];
    if (cur !== false) return;
    if (accepted(`expectation:${i}`, 'false')) return;
    items.push({
      item: `expectation:${i}`,
      baseline: String(baseline.expectations[i] ?? 'unknown'),
      current: 'false',
      type: 'expectation_failed',
      summary: `expectation not met at ${where}: ${text}`,
    });
  });
  return items;
}

/** Turn checklist diff items into candidates (source `checkpoint`). */
export function candidatesFromChecklist(
  items: readonly ChecklistDiffItem[],
  ctx: { place: string | null; checkpointId: string; model: string | null; baselinePhotoKey: string | null; currentPhotoKey: string | null },
): Candidate[] {
  return items.map((it) => ({
    key: candidateKey(it.type, ctx.place, ctx.checkpointId),
    type: it.type,
    source: 'checkpoint',
    place: ctx.place,
    checkpointId: ctx.checkpointId,
    summary: it.summary,
    evidence: {
      baselinePhotoKey: ctx.baselinePhotoKey,
      currentPhotoKey: ctx.currentPhotoKey,
      checklistDiff: [{ item: it.item, baseline: it.baseline, current: it.current }],
    },
    confidence: 0.7,
    model: ctx.model,
  }));
}

// ============================================================================
// 4. En-route: label-set diff (semantic) — no model call
// ============================================================================

export interface LabelDiffResult {
  /** Labels of this look absent from the baseline leg. */
  added: string[];
  /** Baseline labels this look did not report (informational — one look rarely relabels everything). */
  missing: string[];
  candidates: Candidate[];
}

/** Whether a label matches the watch-list (substring, case-insensitive). */
export function onWatchlist(label: string, watchlist: readonly string[]): boolean {
  const l = normLabel(label);
  return watchlist.some((w) => w && l.includes(w));
}

/**
 * Labels of ONE look vs the baseline label set of the same leg. A new label
 * that is on the watch-list is a candidate `unexpected_object` (or `person`),
 * keyed by type × place so every look re-observes the same candidate and the
 * confirmer can count. Labels not on the watch-list are reported in `added`
 * only — the VLM names walls and floors freely, none of which is a finding.
 */
export function labelSetDiff(
  lookLabels: readonly string[],
  baselineLabels: readonly string[],
  place: string | null,
  watchlist: readonly string[] = config.agentMode.patrol.watchlist,
): LabelDiffResult {
  const base = new Set(baselineLabels.map(normLabel));
  const look = new Set(lookLabels.map(normLabel));
  const added = [...look].filter((l) => l && !base.has(l));
  const missing = [...base].filter((l) => l && !look.has(l));
  const candidates: Candidate[] = [];
  const persons = added.filter((l) => /person|human|people|mensch/.test(l));
  const objects = added.filter((l) => !persons.includes(l) && onWatchlist(l, watchlist));
  if (persons.length > 0) {
    candidates.push({
      key: candidateKey('person', place),
      type: 'person',
      source: 'enroute_semantic',
      place,
      summary: `person in ${placeLabel(place)}`,
      evidence: { labels: { added: persons, missing: [] } },
      confidence: 0.6,
      model: null,
    });
  }
  if (objects.length > 0) {
    candidates.push({
      key: candidateKey('unexpected_object', place),
      type: 'unexpected_object',
      source: 'enroute_semantic',
      place,
      summary: `unexpected ${objects.join(', ')} in ${placeLabel(place)}`,
      evidence: { labels: { added: objects, missing } },
      confidence: 0.6,
      model: null,
    });
  }
  return { added, missing, candidates };
}

/**
 * Leg-end check for things that are GONE: a baseline label on the watch-list
 * that no look of the whole leg reported. Evaluated once per leg over every
 * look — a single frame missing a label means nothing.
 */
export function missingLabelCandidates(
  seenInLeg: ReadonlySet<string>,
  baselineLabels: readonly string[],
  place: string | null,
  watchlist: readonly string[] = config.agentMode.patrol.watchlist,
): Candidate[] {
  const seen = new Set([...seenInLeg].map(normLabel));
  const gone = baselineLabels.map(normLabel).filter((l) => l && !seen.has(l) && onWatchlist(l, watchlist) && !/person|human|people/.test(l));
  if (gone.length === 0) return [];
  return [
    {
      key: candidateKey('missing_object', place),
      type: 'missing_object',
      source: 'enroute_semantic',
      place,
      summary: `${gone.join(', ')} missing in ${placeLabel(place)}`,
      evidence: { labels: { added: [], missing: gone } },
      confidence: 0.5,
      model: null,
    },
  ];
}

// ============================================================================
// 5. En-route: occupancy-map diff (geometric) — no model call
// ============================================================================

export interface MapBlob {
  x: number;
  y: number;
  areaM2: number;
  cells: number;
  place: string | null;
}

export interface MapDiffOptions {
  pose: { x: number; y: number };
  radiusM?: number;
  minBlobM2?: number;
  /** Tracked fleet peers — a blob inside one is that robot, not an object. */
  peers?: readonly DynamicObstacle[];
  /** Blobs an operator accepted as normal ("this is normal"). */
  accepted?: readonly { x: number; y: number; radiusM: number }[];
  /** Non-keepout places, for naming where the blob is. */
  places?: readonly Place[];
}

export interface MapDiffResult {
  blobs: MapBlob[];
  candidates: Candidate[];
  /** Why nothing was compared, when the two maps are not comparable. */
  reason?: string;
}

function decodeCells(snap: OccupancyMapSnapshot): Int8Array {
  const buf = Buffer.from(snap.cells, 'base64');
  return new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Cell state of a snapshot at a world point, in the snapshot's own log-odds scale. */
function stateAt(snap: OccupancyMapSnapshot, cells: Int8Array, x: number, y: number): 'occupied' | 'free' | 'unknown' {
  const cx = Math.floor((x - snap.originX) / snap.resolution);
  const cy = Math.floor((y - snap.originY) / snap.resolution);
  if (cx < 0 || cy < 0 || cx >= snap.width || cy >= snap.height) return 'unknown';
  const v = cells[cy * snap.width + cx] / 25; // LOGODDS_SCALE — kept literal to stay decoupled from the class
  if (v > snap.occupiedAbove) return 'occupied';
  if (v < snap.freeBelow) return 'free';
  return 'unknown';
}

/**
 * Cells OCCUPIED now that were FREE in the baseline map, within `radiusM` of
 * the pose, clustered 8-connected. Only two snapshots of the SAME odometry
 * session are comparable (`frameId`): a sidecar restart re-zeroes odometry, so
 * a mismatch returns no blobs and says why rather than reporting the whole
 * room as new.
 */
export function mapDiff(
  baseline: OccupancyMapSnapshot | null,
  current: OccupancyMapSnapshot | null,
  opts: MapDiffOptions,
): MapDiffResult {
  if (!baseline || !current) return { blobs: [], candidates: [], reason: 'no map on one side' };
  if (!baseline.frameId || !current.frameId) return { blobs: [], candidates: [], reason: 'no odometry session id on one side' };
  if (baseline.frameId !== current.frameId) {
    return { blobs: [], candidates: [], reason: `baseline map is from odometry session ${baseline.frameId}, this one is ${current.frameId}` };
  }
  const radiusM = opts.radiusM ?? config.agentMode.patrol.diffRadiusM;
  const minBlobM2 = opts.minBlobM2 ?? config.agentMode.patrol.minBlobM2;
  const cur = decodeCells(current);
  const base = decodeCells(baseline);
  const res = current.resolution;
  const r2 = radiusM * radiusM;
  const cx0 = Math.max(0, Math.floor((opts.pose.x - radiusM - current.originX) / res));
  const cy0 = Math.max(0, Math.floor((opts.pose.y - radiusM - current.originY) / res));
  const cx1 = Math.min(current.width - 1, Math.ceil((opts.pose.x + radiusM - current.originX) / res));
  const cy1 = Math.min(current.height - 1, Math.ceil((opts.pose.y + radiusM - current.originY) / res));

  // Candidate cells: occupied now, free at baseline, inside the radius.
  const marked = new Set<number>();
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const wx = current.originX + (cx + 0.5) * res;
      const wy = current.originY + (cy + 0.5) * res;
      const dx = wx - opts.pose.x;
      const dy = wy - opts.pose.y;
      if (dx * dx + dy * dy > r2) continue;
      const v = cur[cy * current.width + cx] / 25;
      if (!(v > current.occupiedAbove)) continue;
      if (stateAt(baseline, base, wx, wy) !== 'free') continue;
      marked.add(cy * current.width + cx);
    }
  }

  // Connected components (8-neighbourhood).
  const blobs: MapBlob[] = [];
  const seen = new Set<number>();
  for (const start of marked) {
    if (seen.has(start)) continue;
    const stack = [start];
    seen.add(start);
    let n = 0;
    let sx = 0;
    let sy = 0;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const cx = idx % current.width;
      const cy = Math.floor(idx / current.width);
      n++;
      sx += current.originX + (cx + 0.5) * res;
      sy += current.originY + (cy + 0.5) * res;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= current.width || ny >= current.height) continue;
          const nidx = ny * current.width + nx;
          if (marked.has(nidx) && !seen.has(nidx)) {
            seen.add(nidx);
            stack.push(nidx);
          }
        }
      }
    }
    const areaM2 = n * res * res;
    if (areaM2 < minBlobM2) continue;
    const bx = sx / n;
    const by = sy / n;
    // A blob inside a tracked peer's footprint is that robot.
    const isPeer = (opts.peers ?? []).some((p) => Math.hypot(p.x - bx, p.y - by) <= p.radiusM + res);
    if (isPeer) continue;
    const isAccepted = (opts.accepted ?? []).some((a) => Math.hypot(a.x - bx, a.y - by) <= a.radiusM);
    if (isAccepted) continue;
    const place =
      (opts.places ?? []).find((p) => !p.keepout && pointInPolygon(bx, by, p.polygon))?.id ?? null;
    blobs.push({ x: Math.round(bx * 100) / 100, y: Math.round(by * 100) / 100, areaM2: Math.round(areaM2 * 100) / 100, cells: n, place });
  }
  blobs.sort((a, b) => b.areaM2 - a.areaM2);

  // One candidate per place (the biggest blob carries the evidence) — the
  // Confirmer keys by type × place anyway.
  const byPlace = new Map<string, MapBlob>();
  for (const b of blobs) {
    const k = b.place ?? '?';
    if (!byPlace.has(k)) byPlace.set(k, b);
  }
  const candidates: Candidate[] = [...byPlace.values()].map((b) => ({
    key: candidateKey('unexpected_object', b.place),
    type: 'unexpected_object',
    source: 'enroute_geometric',
    place: b.place,
    summary: `unexpected object in ${placeLabel(b.place)} (${b.areaM2.toFixed(2)} m² at ${b.x.toFixed(1)}, ${b.y.toFixed(1)})`,
    evidence: { blob: { x: b.x, y: b.y, areaM2: b.areaM2, cells: b.cells } },
    confidence: Math.min(0.9, 0.5 + b.areaM2),
    model: null,
  }));
  return { blobs, candidates };
}

// ============================================================================
// 6. Confirmer — N-of-M, cooldown, semantic+geometric merge
// ============================================================================

export interface ConfirmerOptions {
  /** N of the last M observation rounds must contain the candidate. */
  n?: number;
  m?: number;
}

export interface ConfirmerResult {
  /** Candidates that just crossed the threshold — one finding each (subject to cooldown). */
  confirmed: Candidate[];
  /** Candidates whose finding already exists for this type × place — re-observed. */
  reobserved: Candidate[];
}

interface Track {
  history: boolean[];
  latest: Candidate;
}

/**
 * Turns candidate observations into confirmed findings.
 *
 * Every call to {@link observe} is ONE round (one en-route look). A candidate
 * key present in ≥ N of the last M rounds is confirmed once; after that the
 * same key re-observes the existing finding (observations++) instead of
 * raising another — the cooldown "one finding per type per place per run".
 * `immediate` confirms on the spot: the checkpoint checklist is the deliberate,
 * accurate stage and gets exactly one observation per run.
 *
 * Two candidates of the same key in one round (a semantic and a geometric
 * sighting of the same crate) are merged into one with source `enroute_both`.
 */
export class Confirmer {
  private readonly n: number;
  private readonly m: number;
  private readonly tracks = new Map<string, Track>();
  /** key → finding id, set by the owner once a finding exists. */
  private readonly emitted = new Map<string, string>();

  constructor(opts: ConfirmerOptions = {}) {
    this.n = Math.max(1, opts.n ?? config.agentMode.patrol.confirmN);
    this.m = Math.max(this.n, opts.m ?? config.agentMode.patrol.confirmM);
  }

  observe(candidates: readonly Candidate[], opts: { immediate?: boolean } = {}): ConfirmerResult {
    const round = new Map<string, Candidate>();
    for (const c of candidates) {
      const prev = round.get(c.key);
      round.set(c.key, prev ? mergeCandidates(prev, c) : c);
    }
    const confirmed: Candidate[] = [];
    const reobserved: Candidate[] = [];

    // Immediate candidates do not touch the round history: they are not a
    // stream, and an absent key in this call must not count as a miss for
    // the en-route tracks.
    if (opts.immediate) {
      for (const c of round.values()) {
        if (this.emitted.has(c.key)) reobserved.push(withObservations(c, 1));
        else confirmed.push(withObservations(c, 1));
      }
      return { confirmed, reobserved };
    }

    for (const [key, c] of round) {
      const t = this.tracks.get(key) ?? { history: [], latest: c };
      t.history.push(true);
      t.latest = t.latest === c ? c : mergeCandidates(t.latest, c);
      if (t.history.length > this.m) t.history.shift();
      this.tracks.set(key, t);
    }
    for (const [key, t] of this.tracks) {
      if (!round.has(key)) {
        t.history.push(false);
        if (t.history.length > this.m) t.history.shift();
        if (t.history.every((h) => !h)) this.tracks.delete(key);
        continue;
      }
      const hits = t.history.filter(Boolean).length;
      if (hits < this.n) continue;
      const c = withObservations(t.latest, hits);
      if (this.emitted.has(key)) reobserved.push(c);
      else confirmed.push(c);
      // Confirmed or re-observed, the streak restarts so the same M frames do
      // not re-confirm on every following look.
      t.history = [];
      t.latest = round.get(key)!;
    }
    return { confirmed, reobserved };
  }

  /** Record that a finding now exists for this key (called by the owner after emitting it). */
  markEmitted(key: string, findingId: string): void {
    this.emitted.set(key, findingId);
  }

  findingIdFor(key: string): string | null {
    return this.emitted.get(key) ?? null;
  }
}

function withObservations(c: Candidate, observations: number): Candidate {
  return { ...c, evidence: { ...c.evidence, observations } };
}

/** Same key, two sources → one candidate carrying both kinds of evidence. */
export function mergeCandidates(a: Candidate, b: Candidate): Candidate {
  const source: PatrolFindingSource =
    a.source === b.source
      ? a.source
      : a.source === 'checkpoint' || b.source === 'checkpoint'
        ? 'checkpoint'
        : 'enroute_both';
  const evidence: PatrolFindingEvidence = { ...a.evidence, ...b.evidence };
  if (a.evidence.labels && b.evidence.labels) {
    evidence.labels = {
      added: [...new Set([...a.evidence.labels.added, ...b.evidence.labels.added])],
      missing: [...new Set([...a.evidence.labels.missing, ...b.evidence.labels.missing])],
    };
  }
  if (a.evidence.checklistDiff && b.evidence.checklistDiff) {
    evidence.checklistDiff = [...a.evidence.checklistDiff, ...b.evidence.checklistDiff];
  }
  const geometric = a.evidence.blob ? a : b.evidence.blob ? b : null;
  const summary = source === 'enroute_both' && geometric ? geometric.summary : b.summary || a.summary;
  return {
    ...a,
    source,
    summary,
    evidence,
    confidence: Math.min(1, Math.max(a.confidence, b.confidence) + (source === 'enroute_both' ? 0.15 : 0)),
    model: a.model ?? b.model,
    checkpointId: a.checkpointId ?? b.checkpointId ?? null,
  };
}
