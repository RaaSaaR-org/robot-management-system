/**
 * @file useScanCapableRobots.ts
 * @description Robots that can run a digital-twin sweep (G1 — carries a Livox
 *   MID-360). Scan UI is gated to these; the viewer/gallery are not.
 * @feature digitaltwin
 */

import { useEffect, useMemo } from 'react';
import { useRobots } from '@/features/robots/hooks/useRobots';
import type { Robot, RobotType } from '@/features/robots/types/robots.types';

function normalizeRobotType(raw?: string): RobotType {
  const t = (raw ?? 'generic').toLowerCase();
  if (t.startsWith('g1')) return 'g1';
  if (t.startsWith('h1')) return 'h1';
  if (t.startsWith('so101')) return 'so101';
  return 'generic';
}

/** True if a robot carries a 3D LiDAR we can sweep a room with. */
export function isScanCapable(robot: Robot): boolean {
  const type = normalizeRobotType(
    (robot.metadata?.robotType as string | undefined) ?? (robot as { robotType?: string }).robotType,
  );
  return type === 'g1';
}

export function useScanCapableRobots(): { robots: Robot[]; isLoading: boolean } {
  const { robots, fetchRobots, isLoading } = useRobots();

  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  const scanCapable = useMemo(() => robots.filter(isScanCapable), [robots]);
  return { robots: scanCapable, isLoading };
}
