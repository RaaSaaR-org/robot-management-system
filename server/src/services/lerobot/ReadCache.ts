/**
 * @file ReadCache.ts
 * @description Weight-bounded LRU with a TTL and in-flight de-duplication, for decoded dataset reads
 * @feature datasets
 *
 * The episode browser pages through one episode in several requests; without
 * a cache each page re-reads and re-decodes the episode's parquet (TASK-355).
 * Entries are bounded by an estimated byte weight rather than a count, so one
 * long episode cannot crowd the heap, and concurrent requests for the same
 * key share one load instead of decoding the file twice.
 *
 * A load is work for whoever is waiting for it. A caller that passes a signal
 * leaves when it fires, and a load nobody waits for any more is told to stop
 * (TASK-492): clicking through sixty episodes used to leave sixty decodes
 * running for requests whose browser had long moved on.
 */

/** Thrown to a caller that left, and by a load that was told nobody is waiting. */
export class ReadAbandoned extends Error {
  constructor() {
    super('The read was abandoned: nobody is waiting for it');
    this.name = 'ReadAbandoned';
  }
}

export function isReadAbandoned(error: unknown): error is ReadAbandoned {
  return error instanceof ReadAbandoned;
}

export interface ReadCacheOptions {
  /** Upper bound on the summed weight of cached entries. */
  maxWeight: number;
  /** How long an entry stays valid after it was loaded. */
  ttlMs: number;
  /** Clock, for tests. */
  now?: () => number;
}

interface Entry<T> {
  value: T;
  weight: number;
  expires: number;
}

/** A load in progress and how many callers are waiting for it. */
interface Flight<T> {
  promise: Promise<T>;
  waiters: number;
  stop: AbortController;
}

export class ReadCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Flight<T>>();
  private weight = 0;
  private readonly now: () => number;

  constructor(private readonly options: ReadCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  /** The cached value for `key`, refreshing its recency, or undefined. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /**
   * The cached value, or the result of `load` — stored when its weight fits.
   * A failed load is not cached; callers waiting on it see the same error.
   *
   * With `signal`, this caller stops waiting when it fires and is rejected
   * with {@link ReadAbandoned}. `load` receives a signal of its own that fires
   * once every caller has left that way, so the work can stop; a caller that
   * passed no signal waits to the end and keeps the load alive.
   */
  async getOrLoad(
    key: string,
    weigh: (value: T) => number,
    load: (stop: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    if (signal?.aborted) throw new ReadAbandoned();
    let flight = this.inflight.get(key);
    if (!flight) {
      const stop = new AbortController();
      const started: Flight<T> = { waiters: 0, stop, promise: undefined as unknown as Promise<T> };
      started.promise = load(stop.signal)
        .then((value) => {
          // A load that was invalidated while it ran still answers its callers,
          // but what it read may describe files that are gone — it is not kept.
          if (this.inflight.get(key) === started) this.set(key, value, weigh(value));
          return value;
        })
        .finally(() => {
          if (this.inflight.get(key) === started) this.inflight.delete(key);
        });
      this.inflight.set(key, started);
      flight = started;
    }
    return this.join(key, flight, signal);
  }

  /** Wait for a load in flight, for as long as `signal` allows. */
  private join(key: string, flight: Flight<T>, signal?: AbortSignal): Promise<T> {
    flight.waiters++;
    if (!signal) return flight.promise;
    return new Promise<T>((resolve, reject) => {
      const leave = (): void => {
        reject(new ReadAbandoned());
        if (--flight.waiters > 0) return;
        // The last one out: the next request for this key starts its own load
        // rather than joining one that is being torn down.
        if (this.inflight.get(key) === flight) this.inflight.delete(key);
        flight.stop.abort();
      };
      signal.addEventListener('abort', leave, { once: true });
      flight.promise.then(
        (value) => {
          signal.removeEventListener('abort', leave);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', leave);
          reject(error);
        },
      );
    });
  }

  set(key: string, value: T, weight: number): void {
    this.delete(key);
    if (weight > this.options.maxWeight) return;
    this.entries.set(key, { value, weight, expires: this.now() + this.options.ttlMs });
    this.weight += weight;
    for (const oldest of this.entries.keys()) {
      if (this.weight <= this.options.maxWeight) break;
      this.delete(oldest);
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.weight -= entry.weight;
  }

  /**
   * Drop every entry whose key starts with `prefix`, and disown the loads in
   * flight under it so their results are not stored. Returns the entries dropped.
   */
  deletePrefix(prefix: string): number {
    let dropped = 0;
    for (const key of [...this.entries.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.delete(key);
      dropped++;
    }
    for (const key of [...this.inflight.keys()]) {
      if (key.startsWith(prefix)) this.inflight.delete(key);
    }
    return dropped;
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
    this.weight = 0;
  }

  /** Summed weight of what is cached, for the budget tests and the memory readout. */
  get totalWeight(): number {
    return this.weight;
  }

  get size(): number {
    return this.entries.size;
  }
}
