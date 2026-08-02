/**
 * @file place-graph-source.test.ts
 * @description Fetching a real site's place graph from the platform, and the
 *   disk cache that makes the platform being down a stale map rather than no map
 *   (TASK-200).
 * @feature agentmode
 *
 * The frame assertions are the point of this file. Two of them:
 *   - units / yaw convention, rejected by the shared parser — a graph authored
 *     in centimetres would put every place 100× too far away and read as
 *     "UNKNOWN everywhere" with nothing in the logs to say why;
 *   - `frame.twinId`, rejected here — twins are NOT mutually registered, so a
 *     graph from another twin is expressed about another origin and would
 *     produce confidently wrong places rather than obviously wrong ones.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PlaceGraphSource } from '../place-graph-source.js';

const TWIN_ID = 'twin-abc';

function graphBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    frame: {
      id: `twin-${TWIN_ID}`,
      kind: 'site',
      units: 'm',
      yawConvention: 'deg,+x=0,CCW+',
      twinId: TWIN_ID,
      ...(overrides.frame as Record<string, unknown> | undefined),
    },
    places: [
      {
        id: 'AISLE-3',
        name: 'Aisle 3',
        placeType: 'aisle',
        floor: 0,
        polygon: [[8, -4], [10, -4], [10, 2], [8, 2]],
        source: 'surveyed',
        keepout: false,
        landmarks: [],
      },
    ],
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'frame')),
  };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

let root: string;

function makeSource(fetchImpl: typeof fetch, twinId = TWIN_ID): PlaceGraphSource {
  return new PlaceGraphSource({
    serverUrl: 'http://localhost:3001/',
    twinId,
    cachePath: path.join(root, 'nested', 'place-graph-cache.json'),
    fetchImpl,
  });
}

describe('PlaceGraphSource', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'place-graph-'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('builds the endpoint the server actually serves', () => {
    const source = makeSource(vi.fn() as unknown as typeof fetch);
    // Trailing slash on the base URL must not produce a double slash.
    expect(source.url).toBe('http://localhost:3001/api/digital-twins/twin-abc/places/_index.json');
  });

  it('fetches, validates and caches the graph', async () => {
    const source = makeSource((async () => okResponse(graphBody())) as unknown as typeof fetch);

    const result = await source.refresh();

    expect(result.origin).toBe('server');
    expect(result.graph?.places.map((p) => p.id)).toEqual(['AISLE-3']);
    // Cached as the SERVER'S bytes, so the next boot re-runs the same validator.
    const cached = JSON.parse(readFileSync(source.cacheFile, 'utf-8'));
    expect(cached.frame.twinId).toBe(TWIN_ID);
  });

  it('falls back to the cache when the server is down', async () => {
    const source = makeSource((async () => okResponse(graphBody())) as unknown as typeof fetch);
    await source.refresh();

    const offline = makeSource((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    const result = await offline.refresh();

    expect(result.origin).toBe('cache');
    expect(result.error).toContain('ECONNREFUSED');
    expect(result.graph?.places.map((p) => p.id)).toEqual(['AISLE-3']);
  });

  it('reports `none` — never a throw — when the server is down and there is no cache', async () => {
    const source = makeSource((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);

    const result = await source.refresh();

    expect(result.origin).toBe('none');
    expect(result.graph).toBeNull();
  });

  it('treats a non-2xx as unavailable rather than parsing the error body', async () => {
    const source = makeSource((async () =>
      ({ ok: false, status: 503, json: async () => ({ error: 'nope' }) }) as unknown as Response) as unknown as typeof fetch);

    const result = await source.refresh();
    expect(result.origin).toBe('none');
    expect(result.error).toContain('503');
  });

  it('REJECTS a graph belonging to another twin', async () => {
    // The hazard this guards: twin B's polygons are expressed about twin B's
    // origin, which is wherever the robot happened to stand when that scan
    // started. Applied to a robot localised in twin A they are silently offset.
    const source = makeSource(
      (async () => okResponse(graphBody({ frame: { twinId: 'twin-other' } }))) as unknown as typeof fetch,
    );

    const result = await source.refresh();

    expect(result.origin).toBe('none');
    expect(result.error).toContain('twin-other');
  });

  it('REJECTS a graph whose declared units do not match the resolver', async () => {
    const source = makeSource(
      (async () => okResponse(graphBody({ frame: { units: 'cm' } }))) as unknown as typeof fetch,
    );

    const result = await source.refresh();

    expect(result.origin).toBe('none');
    expect(result.error).toContain('frame.units');
  });

  it('REJECTS a graph whose declared yaw convention does not match', async () => {
    const source = makeSource(
      (async () =>
        okResponse(graphBody({ frame: { yawConvention: 'rad,+y=0,CW+' } }))) as unknown as typeof fetch,
    );

    const result = await source.refresh();
    expect(result.origin).toBe('none');
    expect(result.error).toContain('yawConvention');
  });

  it('keeps the last good cache when the server starts serving a bad graph', async () => {
    const good = makeSource((async () => okResponse(graphBody())) as unknown as typeof fetch);
    await good.refresh();

    const bad = makeSource(
      (async () => okResponse(graphBody({ version: 99 }))) as unknown as typeof fetch,
    );
    const result = await bad.refresh();

    expect(result.origin).toBe('cache');
    expect(result.graph?.places.map((p) => p.id)).toEqual(['AISLE-3']);
  });

  it('loadCached returns null (not a throw) for a corrupt cache', () => {
    const source = makeSource(vi.fn() as unknown as typeof fetch);
    writeFileSync(path.join(root, 'corrupt.json'), '{ not json', 'utf-8');
    const corrupt = new PlaceGraphSource({
      serverUrl: 'http://localhost:3001',
      twinId: TWIN_ID,
      cachePath: path.join(root, 'corrupt.json'),
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(corrupt.loadCached()).toBeNull();
  });

  it('loadCached refuses a cached graph from another twin', async () => {
    const source = makeSource((async () => okResponse(graphBody())) as unknown as typeof fetch);
    await source.refresh();

    // The robot was re-pointed at a different site without clearing the cache.
    const repointed = makeSource(vi.fn() as unknown as typeof fetch, 'twin-new');
    expect(repointed.loadCached()).toBeNull();
  });
});
