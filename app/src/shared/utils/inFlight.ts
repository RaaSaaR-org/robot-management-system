/**
 * @file inFlight.ts
 * @description Single-flight helper: concurrent calls with the same key share
 *   one promise instead of each hitting the network (TASK-362 — several
 *   components mounting together used to fire the same GET once each).
 * @feature shared
 */

/** A keyed single-flight runner. */
export interface SingleFlight {
  /** Run `fn`, or join the call with the same key that is still pending. */
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/** Create an independent single-flight runner (one per store). */
export function createSingleFlight(): SingleFlight {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing as Promise<T>;
      const promise = fn().finally(() => {
        if (pending.get(key) === promise) pending.delete(key);
      });
      pending.set(key, promise);
      return promise;
    },
  };
}
