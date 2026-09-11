/**
 * @file useRobotNames.ts
 * @description Resolves robot ids to names from the robots store, loading
 *              the robots once when the store is empty
 * @feature fleetlearning
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useRobotsStore } from '@/features/robots/store/robotsStore';

export function useRobotNames(): (robotId: string) => string {
  const robots = useRobotsStore((s) => s.robots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);

  useEffect(() => {
    if (robots.length === 0) void fetchRobots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const names = useMemo(() => new Map(robots.map((r) => [r.id, r.name])), [robots]);
  return useCallback((id: string) => names.get(id) ?? id, [names]);
}
