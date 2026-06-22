/**
 * @file useDebounce.ts
 * @description Hook for debouncing value changes
 * @feature shared
 * @dependencies None
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Debounces a value, only updating after the specified delay has passed
 * since the last change.
 *
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds (default: 500ms)
 * @returns The debounced value
 *
 * @example
 * ```typescript
 * const [searchTerm, setSearchTerm] = useState('');
 * const debouncedSearch = useDebounce(searchTerm, 300);
 *
 * useEffect(() => {
 *   if (debouncedSearch) {
 *     fetchSearchResults(debouncedSearch);
 *   }
 * }, [debouncedSearch]);
 * ```
 */
export function useDebounce<T>(value: T, delay: number = 500): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Returns a debounced callback function that only executes after the
 * specified delay has passed since the last call.
 *
 * @param callback - The function to debounce
 * @param delay - Delay in milliseconds (default: 500ms)
 * @returns A debounced version of the callback
 *
 * @example
 * ```typescript
 * const debouncedSave = useDebouncedCallback((value: string) => {
 *   saveToServer(value);
 * }, 1000);
 * ```
 */
export function useDebouncedCallback<T extends (...args: Parameters<T>) => void>(
  callback: T,
  delay: number = 500
): (...args: Parameters<T>) => void {
  // Hold the pending timer in a ref, not state: rapid synchronous calls share
  // the same render closure, so a useState id would always be stale and the
  // previous timer would never be cleared (firing once per call instead of
  // debouncing). A ref is always current.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest callback without changing the debounced fn's identity.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // Clear any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );
}
