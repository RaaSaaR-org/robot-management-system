/**
 * @file LivePoses.tsx
 * @description L3 overlay — the live robot(s) standing in the twin at their
 *   world pose. The robot model is native y-up, so it lives OUTSIDE the world-
 *   frame (z-up) group: we map world (x,y) → scene (x, -y) and rotate about the
 *   scene up-axis by the world yaw.
 * @feature digitaltwin
 */

import { memo } from 'react';
import { Center } from '@react-three/drei';
import { RobotModel } from '@/features/robots/components/visualization/RobotModel';
import type { RobotType } from '@/features/robots/types/robots.types';
import type { TwinPose } from '../types/twin.types';

/** Lift so the centered model's feet rest near the floor (scene y=0). */
const FOOT_Y = 0.75;

export interface LivePosesProps {
  pose: TwinPose;
  robotType?: RobotType;
  animating?: boolean;
}

export const LivePoses = memo(function LivePoses({ pose, robotType = 'g1', animating = true }: LivePosesProps) {
  // world (x, y, z-up) → three scene (x, z-up→y, -y). Robot stays upright.
  return (
    <group position={[pose.x, 0, -pose.y]} rotation={[0, pose.yaw, 0]}>
      <group position={[0, FOOT_Y, 0]}>
        <Center>
          <RobotModel robotType={robotType} isAnimating={animating} />
        </Center>
      </group>
    </group>
  );
});
