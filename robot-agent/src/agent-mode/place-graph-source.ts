/**
 * @file place-graph-source.ts
 * @description Where a place graph comes from when it is not a file somebody
 *              hand-wrote (TASK-200): the platform's
 *              `/api/digital-twins/:id/places/_index.json`, cached to disk so the
 *              server being down is a stale map rather than no map.
 *
 *              The server emits the graph in EXACTLY the shape the resolver
 *              reads, so this module does zero translation — it validates with
 *              the same {@link parsePlaceGraph} used for a local file, and a
 *              payload that fails that check is discarded rather than adapted.
 * @feature agentmode
 * @status live
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parsePlaceGraph } from './place-resolver.js';
import type { PlaceGraph } from './place-resolver.js';

/**
 * How long to wait for the platform before falling back to the cache.
 *
 * 5 s, and it matters that this is short: the fetch runs at boot and on refresh,
 * never in a block, but Agent Mode's contract is that the server being down
 * never stalls anything — so the bound has to be a bound, not a TCP default.
 */
export const PLACE_GRAPH_FETCH_TIMEOUT_MS = 5000;

/** Where the fetched graph ended up coming from. */
export type PlaceGraphOrigin = 'server' | 'cache' | 'none';

export interface PlaceGraphResult {
  graph: PlaceGraph | null;
  origin: PlaceGraphOrigin;
  /** Why the server copy was not used, when it was not. */
  error?: string;
}

export interface PlaceGraphSourceOptions {
  /** Platform base URL, e.g. `http://localhost:3001`. */
  serverUrl: string;
  /** The `DigitalTwin` whose zones define this robot's places. */
  twinId: string;
  /** Absolute path of the on-disk cache copy. */
  cachePath: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch + disk-cache one twin's place graph.
 *
 * Nothing here is on a block's critical path. {@link loadCached} is synchronous
 * and is what the robot boots from; {@link refresh} runs in the background and
 * swaps a newer graph in if and when the platform answers.
 */
export class PlaceGraphSource {
  private readonly serverUrl: string;
  private readonly twinId: string;
  private readonly cachePath: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PlaceGraphSourceOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.twinId = options.twinId;
    this.cachePath = options.cachePath;
    this.timeoutMs = options.timeoutMs ?? PLACE_GRAPH_FETCH_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  /** The endpoint this source reads. */
  get url(): string {
    return `${this.serverUrl}/api/digital-twins/${encodeURIComponent(this.twinId)}/places/_index.json`;
  }

  /** The on-disk copy's path. */
  get cacheFile(): string {
    return this.cachePath;
  }

  /**
   * The cached copy, or null when there is none / it is unreadable. Synchronous
   * and cheap: it is the boot path, and a robot that waits on the network to
   * find out where it is has already lost the argument.
   */
  loadCached(): PlaceGraph | null {
    try {
      const graph = parsePlaceGraph(JSON.parse(readFileSync(this.cachePath, 'utf-8')), this.cachePath);
      return this.assertTwin(graph);
    } catch (err) {
      // A missing cache on first boot is normal and silent-ish; a CORRUPT one is
      // not, and must be visible rather than presenting as "no map configured".
      const why = message(err);
      if (!why.includes('ENOENT')) {
        console.warn(`[PlaceGraph] cached graph at ${this.cachePath} unusable: ${why}`);
      }
      return null;
    }
  }

  /**
   * Ask the platform, validate, cache, return. NEVER throws: a failure returns
   * the cached copy with the reason attached, and no copy at all returns
   * `origin: 'none'` — which the caller reports as UNKNOWN, the honest answer.
   */
  async refresh(): Promise<PlaceGraphResult> {
    try {
      const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      const graph = this.assertTwin(parsePlaceGraph(body, this.url));
      this.writeCache(body);
      return { graph, origin: 'server' };
    } catch (err) {
      const error = message(err);
      const cached = this.loadCached();
      if (cached) {
        console.warn(`[PlaceGraph] ${this.url} unavailable (${error}) — using the cached copy`);
        return { graph: cached, origin: 'cache', error };
      }
      console.warn(`[PlaceGraph] ${this.url} unavailable (${error}) and no cache — place stays UNKNOWN`);
      return { graph: null, origin: 'none', error };
    }
  }

  /**
   * Refuse a graph belonging to a different twin.
   *
   * Twins are NOT mutually registered — each one's origin is an arbitrary robot
   * pose at scan start — so a graph from twin B applied to a robot localised in
   * twin A does not produce wrong NAMES, it produces wrong GEOMETRY silently
   * offset by however far apart the two scans began. That is a confidently wrong
   * place, which this whole feature exists to avoid, and it is why `frame.twinId`
   * is asserted rather than logged.
   */
  private assertTwin(graph: PlaceGraph): PlaceGraph {
    if (graph.frame.twinId !== this.twinId) {
      throw new Error(
        `frame.twinId is ${JSON.stringify(graph.frame.twinId ?? null)}, expected ${JSON.stringify(this.twinId)} — ` +
          'places from another twin are expressed about another origin',
      );
    }
    return graph;
  }

  /**
   * Write the SERVER'S BYTES, re-serialised from the parsed body rather than
   * from our own normalised object: the cache must round-trip through the same
   * validator on the next boot, and caching a normalised form would hide a
   * server that had started emitting something the parser only just tolerates.
   */
  private writeCache(body: unknown): void {
    try {
      mkdirSync(dirname(this.cachePath), { recursive: true });
      const tmp = `${this.cachePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf-8');
      // Atomic: a half-written cache read at the next boot would be a corrupt
      // map, which is worse than no map.
      renameSync(tmp, this.cachePath);
    } catch (err) {
      console.warn(`[PlaceGraph] could not cache to ${this.cachePath}: ${message(err)}`);
    }
  }
}
