/**
 * @file createStore.ts
 * @description Zustand store factory with devtools, persist, and immer middleware
 * @feature store
 * @dependencies zustand, immer
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Draft } from 'immer';

// ============================================================================
// TYPES
// ============================================================================

export interface StoreOptions<T> {
  /** Store name for DevTools identification */
  name: string;
  /** Enable persistence to localStorage */
  persist?: boolean;
  /** Storage key (defaults to name if not provided) */
  storageKey?: string;
  /** Partial state to persist (defaults to entire state) */
  partialize?: (state: T) => Partial<T>;
  /** Enable DevTools in development (default: true) */
  devtools?: boolean;
}

/** Set function type for immer-enabled stores */
export type ImmerSet<T> = (fn: (state: Draft<T>) => void) => void;

/** Get function type for stores */
export type StoreGet<T> = () => T;

/** State creator function type */
export type StoreInitializer<T> = (
  set: ImmerSet<T>,
  get: StoreGet<T>
) => T;

// ============================================================================
// STORE FACTORY
// ============================================================================

/**
 * Creates a Zustand store with optional devtools, persistence, and immer middleware.
 *
 * @example
 * ```typescript
 * interface CounterState {
 *   count: number;
 *   increment: () => void;
 *   decrement: () => void;
 * }
 *
 * const useCounterStore = createStore<CounterState>(
 *   (set) => ({
 *     count: 0,
 *     increment: () => set((state) => { state.count += 1 }),
 *     decrement: () => set((state) => { state.count -= 1 }),
 *   }),
 *   { name: 'CounterStore', persist: true }
 * );
 * ```
 */
export function createStore<T extends object>(
  initializer: StoreInitializer<T>,
  options: StoreOptions<T>
) {
  const {
    name,
    persist: enablePersist = false,
    storageKey,
    partialize,
    devtools: enableDevtools = true,
  } = options;

  // Determine if we're in development
  const isDev = import.meta.env.DEV;

  // Wrap initializer to work with middleware chain
  const storeInitializer = (set: (fn: (state: Draft<T>) => void) => void, get: () => T) => {
    return initializer(set, get);
  };

  // Build the store with middleware chain
  // Using type assertions to handle complex middleware chain types
  if (enablePersist && enableDevtools && isDev) {
    return create<T>()(
      devtools(
        persist(
          immer(storeInitializer as Parameters<typeof immer<T>>[0]),
          {
            name: storageKey || name,
            partialize: partialize || ((state) => state as Partial<T>),
          }
        ),
        { name, enabled: isDev }
      )
    );
  }

  if (enablePersist) {
    return create<T>()(
      persist(
        immer(storeInitializer as Parameters<typeof immer<T>>[0]),
        {
          name: storageKey || name,
          partialize: partialize || ((state) => state as Partial<T>),
        }
      )
    );
  }

  if (enableDevtools && isDev) {
    return create<T>()(
      devtools(
        immer(storeInitializer as Parameters<typeof immer<T>>[0]),
        { name, enabled: isDev }
      )
    );
  }

  return create<T>()(
    immer(storeInitializer as Parameters<typeof immer<T>>[0])
  );
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/** Extract state type from a store */
export type StoreState<T> = T extends { getState: () => infer S } ? S : never;

/** Extract actions type from a store (non-function properties) */
export type StoreActions<T> = {
  [K in keyof T as T[K] extends (...args: unknown[]) => unknown ? K : never]: T[K];
};

/** Create a selector type for a store */
export type StoreSelector<T, R> = (state: T) => R;
