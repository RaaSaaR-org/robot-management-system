/**
 * @file RobotPathTrail.tsx
 * @description The walked path of the scanning robot, drawn as a line just above
 *   the floor. Lives inside the world-frame group (world coords, z-up).
 * @feature digitaltwin
 */

import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { TwinPose } from '../types/twin.types';

export interface RobotPathTrailProps {
  path: TwinPose[];
  color?: string;
}

export const RobotPathTrail = memo(function RobotPathTrail({ path, color = '#FF6700' }: RobotPathTrailProps) {
  const line = useMemo(() => {
    const pts = path.map((p) => new THREE.Vector3(p.x, p.y, 0.04));
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color });
    return new THREE.Line(geom, mat);
  }, [path, color]);

  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    },
    [line],
  );

  return <primitive object={line} />;
});
