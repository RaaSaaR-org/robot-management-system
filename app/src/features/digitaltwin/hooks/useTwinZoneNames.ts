/**
 * @file useTwinZoneNames.ts
 * @description Resolve TwinZone ids to their names for views that store only the
 *   id (deployment `targetZones`, verification `robotScope: 'zone'`, TASK-330).
 *   The zone API is twin-scoped, so this walks the twins once and indexes every
 *   zone. An id that is not found — or a lookup that fails — falls back to the
 *   id itself, so a view never shows a blank.
 * @feature digitaltwin
 */

import { useCallback, useEffect, useState } from 'react';
import { twinApi } from '../api/twinApi';
import { twinZoneApi } from '../api/twinZoneApi';

/** Every TwinZone id → name across all twins. */
export async function loadTwinZoneNames(): Promise<Map<string, string>> {
  const twins = await twinApi.listTwins();
  const perTwin = await Promise.all(
    twins.map((twin) => twinZoneApi.getZones(twin.id).catch(() => [])),
  );
  const names = new Map<string, string>();
  for (const zones of perTwin) {
    for (const zone of zones) names.set(zone.id, zone.name);
  }
  return names;
}

/**
 * `zoneName(id)` → the TwinZone's name, or `id` while loading / when unknown.
 * Loads nothing while `ids` is empty.
 */
export function useTwinZoneNames(ids: readonly (string | null | undefined)[]): (id: string) => string {
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  const key = ids.filter((id): id is string => !!id).sort().join('\n');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    loadTwinZoneNames()
      .then((loaded) => {
        if (!cancelled) setNames(loaded);
      })
      .catch(() => {
        // fall back to ids
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return useCallback((id: string) => names.get(id) ?? id, [names]);
}
