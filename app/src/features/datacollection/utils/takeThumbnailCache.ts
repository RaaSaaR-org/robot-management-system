/**
 * @file takeThumbnailCache.ts
 * @description One blob URL per take thumbnail, fetched through the API client
 *              (the route is behind auth). The store forgets a take's entry when
 *              that take number is discarded or started again, so a reused
 *              number never shows the old frame, and its blob URL is revoked.
 * @feature datacollection
 */

import { datacollectionApi } from '../api/datacollectionApi';

/** One request per take; the promise resolves to a blob URL, or null when there is none. */
const cache = new Map<string, Promise<string | null>>();

const keyOf = (sessionId: string, take: number): string => `${sessionId}:${take}`;

export function loadThumbnail(sessionId: string, take: number): Promise<string | null> {
  const key = keyOf(sessionId, take);
  let entry = cache.get(key);
  if (!entry) {
    entry = datacollectionApi
      .fetchThumbnail(sessionId, take)
      .then((blob) => (blob && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null))
      .catch(() => {
        cache.delete(key); // a failed fetch may succeed later; a 404 is cached as null
        return null;
      });
    cache.set(key, entry);
  }
  return entry;
}

/** Forget a take's thumbnail (it was discarded or restarted) and free its blob URL. */
export function forgetThumbnail(sessionId: string, take: number): void {
  const key = keyOf(sessionId, take);
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  void entry.then((url) => {
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  });
}
