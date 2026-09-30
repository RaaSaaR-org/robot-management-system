/**
 * @file useSitePlaces.ts
 * @description Load the reachable (non-keepout) places of any number of sites
 *              on demand, one request per site (TASK-332: process "Move to
 *              place" steps pick a site, then one of its places).
 * @feature digitaltwin
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { twinApi } from '../api/twinApi';
import type { PlaceGraphPlace } from '../types/twin.types';
import { reachablePlaces } from '../utils/places';

/** A site's places: loading, loaded, or failed to load. */
export type SitePlaces =
  | { status: 'loading' }
  | { status: 'ready'; places: PlaceGraphPlace[] }
  | { status: 'error' };

/**
 * `placesOf(twinId)` → that site's reachable places, fetching them the first
 * time it is asked. Each site is fetched at most once per mounted hook.
 */
export function useSitePlaces(): (twinId: string) => SitePlaces {
  const [bySite, setBySite] = useState<Record<string, SitePlaces>>({});
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback((twinId: string) => {
    requested.current.add(twinId);
    // The state update lands after the request resolves, never during render.
    twinApi
      .getPlaceGraph(twinId)
      .then((graph) => {
        if (mounted.current) {
          setBySite((prev) => ({ ...prev, [twinId]: { status: 'ready', places: reachablePlaces(graph.places) } }));
        }
      })
      .catch(() => {
        if (mounted.current) setBySite((prev) => ({ ...prev, [twinId]: { status: 'error' } }));
      });
  }, []);

  return useCallback(
    (twinId: string): SitePlaces => {
      const known = bySite[twinId];
      if (known) return known;
      if (!requested.current.has(twinId)) load(twinId);
      return { status: 'loading' };
    },
    [bySite, load],
  );
}
