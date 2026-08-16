/**
 * @file inspector.test.ts
 * @description The patrol comparators (TASK-212): the perceptual-hash gate
 *              short-circuits on a like frame, the checklist diff produces the
 *              right finding types, the label diff honours the watch-list and
 *              the baseline, the map diff clusters, drops small blobs and
 *              tracked peers, and the Confirmer counts N-of-M with a cooldown.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { encode } from 'jpeg-js';
import {
  Confirmer,
  candidateKey,
  candidatesFromChecklist,
  checklistCompare,
  gateByHash,
  hashSimilarity,
  labelSetDiff,
  mapDiff,
  mergeCandidates,
  missingLabelCandidates,
  parseChecklistAnswer,
  perceptualHash,
  type Candidate,
  type ChecklistAnswers,
} from '../inspector.js';
import type { OccupancyMapSnapshot } from '../occupancy-map.js';
import type { Place } from '../place-resolver.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/** A JPEG of `w`×`h` filled by `paint(x, y) → [r, g, b]`. */
function jpeg(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return encode({ data, width: w, height: h }, 90).data;
}

/** A room: gradient floor with a dark rectangle "table" on the right. */
const ROOM = jpeg(160, 120, (x, y) => (x > 100 && x < 140 && y > 40 && y < 90 ? [30, 30, 30] : [200 - y, 180, 120 + x / 2]));
/** The same room, re-encoded through a tiny brightness change (camera noise). */
const ROOM_NOISY = jpeg(160, 120, (x, y) => (x > 100 && x < 140 && y > 40 && y < 90 ? [34, 34, 34] : [204 - y, 184, 124 + x / 2]));
/** The room with a big bright crate dropped in the left half. */
const ROOM_CRATE = jpeg(160, 120, (x, y) =>
  x > 10 && x < 70 && y > 30 && y < 110 ? [250, 200, 60] : x > 100 && x < 140 && y > 40 && y < 90 ? [30, 30, 30] : [200 - y, 180, 120 + x / 2],
);
/** Something else entirely: vertical stripes. */
const STRIPES = jpeg(160, 120, (x) => (Math.floor(x / 8) % 2 === 0 ? [255, 255, 255] : [0, 0, 0]));

const ANSWERS: ChecklistAnswers = {
  personPresent: false,
  doorState: 'closed',
  objectOnFloor: { yes: false, what: '' },
  lightsOn: 'no',
  outOfPlace: [],
  expectations: [true],
  oneLine: 'a quiet hallway',
  degraded: false,
};

const CP = { placeId: 'HALLWAY', name: 'Hallway door', expectations: ['fire extinguisher on the wall'] };

// ── pHash gate ──────────────────────────────────────────────────────────────

describe('perceptual hash gate', () => {
  it('hashes a JPEG to 64 bits and is identical for identical bytes', () => {
    const a = perceptualHash(ROOM);
    expect(a).not.toBeNull();
    expect(a! >> 64n).toBe(0n);
    expect(hashSimilarity(a!, perceptualHash(ROOM)!)).toBe(1);
  });

  it('short-circuits (unchanged) on the same view with camera noise, but not on a new crate or another scene', () => {
    expect(gateByHash(ROOM_NOISY, ROOM, 0.97)).toMatchObject({ unchanged: true });
    expect(gateByHash(ROOM_NOISY, ROOM, 0.97).similarity!).toBeGreaterThanOrEqual(0.97);
    const crate = gateByHash(ROOM_CRATE, ROOM, 0.97);
    expect(crate.unchanged).toBe(false);
    expect(crate.similarity!).toBeLessThan(0.97);
    expect(gateByHash(STRIPES, ROOM, 0.97).unchanged).toBe(false);
  });

  it('never says unchanged without a reference or with bytes that are not a JPEG', () => {
    expect(gateByHash(ROOM, null)).toEqual({ unchanged: false, similarity: null });
    expect(gateByHash(Buffer.from('not a jpeg'), ROOM)).toEqual({ unchanged: false, similarity: null });
    expect(perceptualHash(Buffer.from('nope'))).toBeNull();
  });
});

// ── checklist ───────────────────────────────────────────────────────────────

describe('parseChecklistAnswer', () => {
  it('reads the schema, tolerates a fence and a sentence, and pads expectations', () => {
    const a = parseChecklistAnswer(
      'Sure! ```json {"personPresent": false, "doorState": "Open", "objectOnFloor": {"yes": true, "what": "Box"}, "lightsOn": "yes", "outOfPlace": ["chair"], "expectations": [true], "oneLine": "a box in the corridor"}```',
      2,
    );
    expect(a.degraded).toBe(false);
    expect(a.doorState).toBe('open');
    expect(a.objectOnFloor).toEqual({ yes: true, what: 'box' });
    expect(a.lightsOn).toBe('yes');
    expect(a.expectations).toEqual([true, null]);
  });

  it('degrades on garbage without throwing, and a person listed as out of place counts as present', () => {
    expect(parseChecklistAnswer('I cannot see', 0).degraded).toBe(true);
    expect(parseChecklistAnswer('{"outOfPlace": ["person"]}', 0).personPresent).toBe(true);
  });
});

describe('checklistCompare', () => {
  it('maps each differing item to its finding type, only toward "not normal"', () => {
    const cur: ChecklistAnswers = {
      ...ANSWERS,
      personPresent: true,
      doorState: 'open',
      objectOnFloor: { yes: true, what: 'bag' },
      lightsOn: 'yes',
      outOfPlace: ['ladder'],
      expectations: [false],
    };
    const items = checklistCompare(cur, ANSWERS, CP);
    expect(items.map((i) => i.type)).toEqual(['person', 'door_open', 'object_on_floor', 'lights_on', 'out_of_place', 'expectation_failed']);
    expect(items.find((i) => i.type === 'object_on_floor')!.summary).toMatch(/bag on the floor at Hallway door/);
    expect(items.find((i) => i.type === 'expectation_failed')!.summary).toMatch(/fire extinguisher/);
    // The reverse direction — baseline open, now closed; baseline lit, now dark — is not a finding.
    expect(checklistCompare(ANSWERS, { ...ANSWERS, doorState: 'open', lightsOn: 'yes' }, CP)).toEqual([]);
  });

  it('is silent when lights are unknown on either side, and honours accepted answers', () => {
    expect(checklistCompare({ ...ANSWERS, lightsOn: 'yes' }, { ...ANSWERS, lightsOn: 'unknown' }, CP)).toEqual([]);
    const cur = { ...ANSWERS, objectOnFloor: { yes: true, what: 'box' } };
    expect(checklistCompare(cur, ANSWERS, CP)).toHaveLength(1);
    expect(checklistCompare(cur, ANSWERS, CP, { objectOnFloor: ['box'] })).toEqual([]);
  });

  it('keys checkpoint candidates per checkpoint, so two views of one room never share a finding', () => {
    const items = checklistCompare({ ...ANSWERS, outOfPlace: ['table'] }, ANSWERS, CP);
    const ctx = { place: 'HALLWAY', model: null, baselinePhotoKey: 'b/cp-a.jpg', currentPhotoKey: 'r/cp-a.jpg' };
    const [a] = candidatesFromChecklist(items, { ...ctx, checkpointId: 'cp-a' });
    const [b] = candidatesFromChecklist(items, { ...ctx, checkpointId: 'cp-b' });
    expect(a.key).not.toBe(b.key);
    expect(a.key).toBe(candidateKey('out_of_place', 'HALLWAY', 'cp-a'));
    // En-route candidates keep the type × place key (that is the cooldown).
    expect(candidateKey('out_of_place', 'HALLWAY')).toBe('out_of_place|HALLWAY');
    const confirmer = new Confirmer({ n: 2, m: 3 });
    const first = confirmer.observe([a], { immediate: true });
    confirmer.markEmitted(a.key, 'f-1');
    const second = confirmer.observe([b], { immediate: true });
    expect(first.confirmed).toHaveLength(1);
    expect(second.confirmed).toHaveLength(1);
    expect(second.reobserved).toHaveLength(0);
  });
});

// ── label diff ──────────────────────────────────────────────────────────────

describe('labelSetDiff', () => {
  const WATCH = ['person', 'box', 'crate', 'ladder'];

  it('raises unexpected_object only for NEW labels on the watch-list, and person separately', () => {
    const r = labelSetDiff(['wall', 'crate', 'Person', 'plant'], ['wall', 'floor'], 'HALLWAY', WATCH);
    expect(r.added.sort()).toEqual(['crate', 'person', 'plant']);
    expect(r.missing).toEqual(['floor']);
    expect(r.candidates.map((c) => c.type).sort()).toEqual(['person', 'unexpected_object']);
    const obj = r.candidates.find((c) => c.type === 'unexpected_object')!;
    expect(obj.key).toBe(candidateKey('unexpected_object', 'HALLWAY'));
    expect(obj.evidence.labels?.added).toEqual(['crate']);
    expect(obj.source).toBe('enroute_semantic');
  });

  it('respects the baseline: a crate the baseline leg already had is not new', () => {
    expect(labelSetDiff(['crate'], ['crate', 'wall'], 'HALLWAY', WATCH).candidates).toEqual([]);
    // Off-watch-list labels never become candidates however new they are.
    expect(labelSetDiff(['plant', 'lamp'], [], 'HALLWAY', WATCH).candidates).toEqual([]);
  });

  it('missingLabelCandidates: a watch-listed baseline label the whole leg never saw', () => {
    const c = missingLabelCandidates(new Set(['wall', 'door']), ['wall', 'ladder', 'floor'], 'WORKSHOP', WATCH);
    expect(c).toHaveLength(1);
    expect(c[0]!.type).toBe('missing_object');
    expect(c[0]!.evidence.labels?.missing).toEqual(['ladder']);
    expect(missingLabelCandidates(new Set(['ladder']), ['ladder'], 'WORKSHOP', WATCH)).toEqual([]);
  });
});

// ── map diff ────────────────────────────────────────────────────────────────

/** A 10 m × 10 m grid at 0.1 m from (−5, −5); `occupied(x, y)` paints walls/objects. */
function grid(occupied: (x: number, y: number) => boolean, frameId: string | null = 'boot-1'): OccupancyMapSnapshot {
  const res = 0.1;
  const width = 100;
  const height = 100;
  const q = new Int8Array(width * height);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const x = -5 + (cx + 0.5) * res;
      const y = -5 + (cy + 0.5) * res;
      q[cy * width + cx] = occupied(x, y) ? 4 * 25 : -4 * 25;
    }
  }
  return {
    version: 1,
    frame: 'odom',
    frameId,
    resolution: res,
    originX: -5,
    originY: -5,
    width,
    height,
    encoding: 'int8-logodds-b64',
    cells: Buffer.from(q.buffer).toString('base64'),
    occupiedAbove: 1.2,
    freeBelow: -1.2,
    poseCount: 1,
    lastIntegratedAt: null,
    knownCells: width * height,
    occupiedCells: 0,
  };
}

const wall = (x: number, _y: number): boolean => x > 4.8;
const HALLWAY: Place = {
  id: 'HALLWAY',
  name: 'Hallway',
  placeType: 'cell',
  floor: 0,
  polygon: [[-5, -5], [5, -5], [5, 5], [-5, 5]],
  source: 'surveyed',
  keepout: false,
  landmarks: [],
};

describe('mapDiff', () => {
  const baseline = grid(wall);

  it('clusters new occupied cells into one blob with centroid, area and place', () => {
    // A 0.6 × 0.6 m crate at (1, 1) → 36 cells, 0.36 m².
    const now = grid((x, y) => wall(x, y) || (Math.abs(x - 1) < 0.3 && Math.abs(y - 1) < 0.3));
    const r = mapDiff(baseline, now, { pose: { x: 0, y: 0 }, radiusM: 6, minBlobM2: 0.15, places: [HALLWAY] });
    expect(r.blobs).toHaveLength(1);
    expect(r.blobs[0]!.x).toBeCloseTo(1, 1);
    expect(r.blobs[0]!.y).toBeCloseTo(1, 1);
    expect(r.blobs[0]!.areaM2).toBeCloseTo(0.36, 1);
    expect(r.blobs[0]!.place).toBe('HALLWAY');
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ type: 'unexpected_object', source: 'enroute_geometric', place: 'HALLWAY' });
    expect(r.candidates[0]!.evidence.blob?.cells).toBe(36);
  });

  it('ignores blobs under the minimum area, outside the radius, and inside a tracked peer', () => {
    // A single 0.1 × 0.1 cell (0.01 m²) at (1, 1): noise.
    const speck = grid((x, y) => wall(x, y) || (Math.abs(x - 1) < 0.05 && Math.abs(y - 1) < 0.05));
    expect(mapDiff(baseline, speck, { pose: { x: 0, y: 0 }, minBlobM2: 0.15 }).blobs).toEqual([]);
    // A crate 4 m away with a 2 m radius: out of reach.
    const far = grid((x, y) => wall(x, y) || (Math.abs(x - 4) < 0.3 && Math.abs(y) < 0.3));
    expect(mapDiff(baseline, far, { pose: { x: 0, y: 0 }, radiusM: 2, minBlobM2: 0.15 }).blobs).toEqual([]);
    // The same crate is another robot when a peer stands there.
    const now = grid((x, y) => wall(x, y) || (Math.abs(x - 1) < 0.3 && Math.abs(y - 1) < 0.3));
    const peer = mapDiff(baseline, now, { pose: { x: 0, y: 0 }, minBlobM2: 0.15, peers: [{ x: 1, y: 1, radiusM: 0.6, label: 'robot B' }] });
    expect(peer.blobs).toEqual([]);
    // …and an accepted blob ("this is normal") is ignored too.
    const accepted = mapDiff(baseline, now, { pose: { x: 0, y: 0 }, minBlobM2: 0.15, accepted: [{ x: 1.1, y: 0.9, radiusM: 0.8 }] });
    expect(accepted.blobs).toEqual([]);
  });

  it('refuses to compare maps of different odometry sessions', () => {
    const now = grid((x, y) => wall(x, y) || (Math.abs(x - 1) < 0.3 && Math.abs(y - 1) < 0.3), 'boot-2');
    const r = mapDiff(baseline, now, { pose: { x: 0, y: 0 } });
    expect(r.blobs).toEqual([]);
    expect(r.reason).toMatch(/odometry session/);
    expect(mapDiff(null, now, { pose: { x: 0, y: 0 } }).reason).toMatch(/no map/);
  });
});

// ── confirmer ───────────────────────────────────────────────────────────────

function cand(type: Candidate['type'], place: string, source: Candidate['source'] = 'enroute_semantic'): Candidate {
  return {
    key: candidateKey(type, place),
    type,
    source,
    place,
    summary: `${type} in ${place}`,
    evidence: source === 'enroute_geometric' ? { blob: { x: 1, y: 1, areaM2: 0.4, cells: 40 } } : { labels: { added: ['crate'], missing: [] } },
    confidence: 0.6,
    model: null,
  };
}

describe('Confirmer', () => {
  it('confirms after N of M consecutive observations, not on the first', () => {
    const c = new Confirmer({ n: 2, m: 3 });
    expect(c.observe([cand('unexpected_object', 'HALLWAY')]).confirmed).toEqual([]);
    const second = c.observe([cand('unexpected_object', 'HALLWAY')]);
    expect(second.confirmed).toHaveLength(1);
    expect(second.confirmed[0]!.evidence.observations).toBe(2);
  });

  it('a miss inside the window still confirms (2 of 3), three misses forget the track', () => {
    const c = new Confirmer({ n: 2, m: 3 });
    c.observe([cand('person', 'KITCHEN')]);
    c.observe([]); // miss
    expect(c.observe([cand('person', 'KITCHEN')]).confirmed).toHaveLength(1);
    const d = new Confirmer({ n: 2, m: 3 });
    d.observe([cand('person', 'KITCHEN')]);
    d.observe([]);
    d.observe([]);
    d.observe([]);
    expect(d.observe([cand('person', 'KITCHEN')]).confirmed).toEqual([]);
  });

  it('cooldown: one finding per type per place per run — later hits re-observe, a new place is new', () => {
    const c = new Confirmer({ n: 2, m: 3 });
    c.observe([cand('unexpected_object', 'HALLWAY')]);
    const first = c.observe([cand('unexpected_object', 'HALLWAY')]);
    expect(first.confirmed).toHaveLength(1);
    c.markEmitted(first.confirmed[0]!.key, 'finding-1');
    c.observe([cand('unexpected_object', 'HALLWAY')]);
    const again = c.observe([cand('unexpected_object', 'HALLWAY')]);
    expect(again.confirmed).toEqual([]);
    expect(again.reobserved).toHaveLength(1);
    expect(c.findingIdFor(candidateKey('unexpected_object', 'HALLWAY'))).toBe('finding-1');
    c.observe([cand('unexpected_object', 'KITCHEN')]);
    expect(c.observe([cand('unexpected_object', 'KITCHEN')]).confirmed).toHaveLength(1);
  });

  it('merges a semantic and a geometric sighting of the same key into one enroute_both candidate', () => {
    const c = new Confirmer({ n: 2, m: 3 });
    c.observe([cand('unexpected_object', 'HALLWAY', 'enroute_semantic'), cand('unexpected_object', 'HALLWAY', 'enroute_geometric')]);
    const r = c.observe([cand('unexpected_object', 'HALLWAY', 'enroute_geometric')]);
    expect(r.confirmed).toHaveLength(1);
    expect(r.confirmed[0]!.source).toBe('enroute_both');
    expect(r.confirmed[0]!.evidence.blob).toBeDefined();
    expect(r.confirmed[0]!.evidence.labels?.added).toEqual(['crate']);
    const m = mergeCandidates(cand('unexpected_object', 'HALLWAY', 'enroute_semantic'), cand('unexpected_object', 'HALLWAY', 'enroute_geometric'));
    expect(m.source).toBe('enroute_both');
    expect(m.confidence).toBeGreaterThan(0.6);
  });

  it('immediate candidates (checkpoint checklist) confirm on their one observation and do not touch the stream', () => {
    const c = new Confirmer({ n: 2, m: 3 });
    c.observe([cand('unexpected_object', 'HALLWAY')]);
    const r = c.observe([cand('door_open', 'HALLWAY', 'checkpoint')], { immediate: true });
    expect(r.confirmed).toHaveLength(1);
    // The en-route track was not given a miss by the immediate round.
    expect(c.observe([cand('unexpected_object', 'HALLWAY')]).confirmed).toHaveLength(1);
  });
});
