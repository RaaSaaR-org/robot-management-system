/**
 * @file useRobotOptions.ts
 * @description Robot choices for the deploy / roll back / history selects,
 *              loaded from the robots store (offline robots included)
 * @feature updates
 */

import { useEffect, useMemo } from 'react';
import { useRobotsStore } from '@/features/robots/store/robotsStore';
import type { SelectOption } from '@/shared/components/ui';

export interface RobotOptions {
  options: SelectOption[];
  isLoading: boolean;
  nameOf: (robotId: string) => string;
}

/** Loads the robots once when `enabled` turns true. */
export function useRobotOptions(enabled: boolean): RobotOptions {
  const robots = useRobotsStore((s) => s.robots);
  const isLoading = useRobotsStore((s) => s.isLoading);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);

  useEffect(() => {
    if (enabled && robots.length === 0) void fetchRobots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return useMemo(() => {
    const names = new Map(robots.map((r) => [r.id, r.name]));
    return {
      options: robots.map((r) => ({ value: r.id, label: `${r.name} · ${r.status}` })),
      isLoading,
      nameOf: (id: string) => names.get(id) ?? id,
    };
  }, [robots, isLoading]);
}
