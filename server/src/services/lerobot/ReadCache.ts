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
 */

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

export class ReadCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly inflight = new Map<string, Promise<T>>();
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
   */
  async getOrLoad(key: string, weigh: (value: T) => number, load: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = load()
      .then((value) => {
        this.set(key, value, weigh(value));
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
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

  clear(): void {
    this.entries.clear();
    this.weight = 0;
  }

  get size(): number {
    return this.entries.size;
  }
}
