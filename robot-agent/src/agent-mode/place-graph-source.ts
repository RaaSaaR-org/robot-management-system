/**
 * @file place-graph-source.ts
 * @description Where a place graph comes from when it is not a file somebody
 *              hand-wrote: the platform's
 *              `/api/digital-twins/:id/places/_index.json` for an explicitly
 *              named twin (TASK-200), or `/api/robots/:id/places` — the twin the
 *              robot is BOUND to (TASK-328) — cached to disk so the server being
 *              down is a stale map rather than no map.
 *
 *              The server emits the graph in EXACTLY the shape the resolver
 *              reads, so this module does zero translation — it validates with
 *              the same {@link parsePlaceGraph} used for a local file, and a
 *              payload that fails that check is discarded rather than adapted.
 * @feature agentmode
 * @status live
 */

import { platformAuthHeaders } from '../utils/platform-auth.js';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Where the fetched graph ended up coming from.
 *
 * `unbound` is the platform's authoritative "this robot has no site" (TASK-328):
 * not a failure, so it is never papered over with a cached graph from a binding
 * that no longer exists.
 */
export type PlaceGraphOrigin = 'server' | 'cache' | 'none' | 'unbound';

export interface PlaceGraphResult {
  graph: PlaceGraph | null;
  origin: PlaceGraphOrigin;
  /** Why the server copy was not used, when it was not. */
  error?: string;
}

/**
 * Which graph to ask for: a named twin's (`PLACE_TWIN_ID`), or whatever twin the
 * robot is bound to on the platform (`Robot.twinId`).
 */
export type PlaceGraphTarget = { twinId: string } | { robotId: string };

/** The server's 404 body for a robot without a site (TASK-327). */
export const NO_SITE_ERROR = 'robot has no site';

export type PlaceGraphSourceOptions = PlaceGraphTarget & {
  /** Platform base URL, e.g. `http://localhost:3001`. */
  serverUrl: string;
  /** Absolute path of the on-disk cache copy. */
  cachePath: string;
  timeoutMs?: number;
  /** Injected for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
};

/**
 * The on-disk cache path for a binding source: one file per robot, so two
 * agents sharing a data directory never boot from each other's site.
 */
export function robotCachePath(cachePath: string, robotId: string): string {
  const safe = robotId.replace(/[^A-Za-z0-9_-]/g, '_');
  return cachePath.endsWith('.json')
    ? `${cachePath.slice(0, -'.json'.length)}.robot-${safe}.json`
    : `${cachePath}.robot-${safe}`;
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
  private readonly target: PlaceGraphTarget;
  private readonly cachePath: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  /** The last failure line logged; cleared by a successful fetch. */
  private lastReported: string | null = null;

  constructor(options: PlaceGraphSourceOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.target = 'twinId' in options ? { twinId: options.twinId } : { robotId: options.robotId };
    this.cachePath = options.cachePath;
    this.timeoutMs = options.timeoutMs ?? PLACE_GRAPH_FETCH_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  /** The endpoint this source reads. */
  get url(): string {
    return 'twinId' in this.target
      ? `${this.serverUrl}/api/digital-twins/${encodeURIComponent(this.target.twinId)}/places/_index.json`
      : `${this.serverUrl}/api/robots/${encodeURIComponent(this.target.robotId)}/places`;
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
      const res = await this.fetchImpl(this.url, { headers: platformAuthHeaders(), signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.status === 404 && 'robotId' in this.target && (await this.isNoSite(res))) {
        // The platform answered, and the answer is "no site". Drop the cache: it
        // describes a binding that no longer exists, and booting from it while
        // the server is down would name places at a site the robot has left.
        this.dropCache();
        return { graph: null, origin: 'unbound' };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      const graph = this.assertTwin(parsePlaceGraph(body, this.url));
      this.writeCache(body);
      this.lastReported = null;
      return { graph, origin: 'server' };
    } catch (err) {
      const error = message(err);
      const cached = this.loadCached();
      if (cached) {
        this.report('warn', `[PlaceGraph] ${this.url} unavailable (${error}) — using the cached copy`);
        return { graph: cached, origin: 'cache', error };
      }
      // An explicit PLACE_TWIN_ID that cannot be loaded is a misconfiguration
      // worth a warning. The binding source runs on EVERY robot with no place
      // env at all, so a platform it cannot reach is routine, not a fault.
      this.report(
        'robotId' in this.target ? 'info' : 'warn',
        `[PlaceGraph] ${this.url} unavailable (${error}) and no cache — place stays UNKNOWN`,
      );
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
    if ('robotId' in this.target) {
      // A binding source does not know the twin in advance — the binding is the
      // platform's to change — but whatever it serves must still NAME its twin,
      // or nothing downstream could tell which origin the polygons are about.
      if (!graph.frame.twinId) {
        throw new Error('frame.twinId is missing — a site graph must name the twin it is expressed in');
      }
      return graph;
    }
    if (graph.frame.twinId !== this.target.twinId) {
      throw new Error(
        `frame.twinId is ${JSON.stringify(graph.frame.twinId ?? null)}, expected ${JSON.stringify(this.target.twinId)} — ` +
          'places from another twin are expressed about another origin',
      );
    }
    return graph;
  }

  /**
   * Log a refresh failure once per distinct message: the source refreshes on a
   * timer (TASK-328), and the same "server down" line every minute is how an
   * operator learns to stop reading the log.
   */
  private report(level: 'info' | 'warn', line: string): void {
    if (line === this.lastReported) return;
    this.lastReported = line;
    if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  /** Whether a 404 is the server's "robot has no site" rather than a missing robot or route. */
  private async isNoSite(res: Response): Promise<boolean> {
    try {
      const body = (await res.json()) as { error?: unknown };
      return body?.error === NO_SITE_ERROR;
    } catch {
      return false;
    }
  }

  private dropCache(): void {
    try {
      rmSync(this.cachePath, { force: true });
    } catch (err) {
      console.warn(`[PlaceGraph] could not remove stale cache ${this.cachePath}: ${message(err)}`);
    }
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
