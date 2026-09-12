/**
 * @file Robot3DViewer.tsx
 * @description 3D viewer component for robot visualization with Three.js
 * @feature robots
 */

import { Suspense, memo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Center } from '@react-three/drei';
import { RobotModel } from './RobotModel';
import { normalizeRobotType, type RobotType, type JointState } from '../../types/robots.types';
import { Skeleton } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { readCssColor } from '../common/readCssColor';
import { ViewerGuard } from './ViewerGuard';

// ============================================================================
// TYPES
// ============================================================================

export interface Robot3DViewerProps {
  /** Robot type for loading correct model */
  robotType: RobotType;
  /** Current joint states from telemetry */
  jointStates?: JointState[];
  /** Whether to show animation when idle */
  isAnimating?: boolean;
  /**
   * Robot id enabling the high-rate telemetry channel (TASK-191): the model
   * then reads ~10 Hz fast frames imperatively in its render loop instead of
   * waiting for the 2 s `jointStates` prop.
   */
  robotId?: string;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// LOADING PLACEHOLDER
// ============================================================================

function LoadingPlaceholder() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 1.5, 0.3]} />
      <meshStandardMaterial color={readCssColor('--text-muted', 'gray')} wireframe />
    </mesh>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export const Robot3DViewer = memo(function Robot3DViewer({
  robotType: rawRobotType,
  jointStates,
  isAnimating = true,
  robotId,
  className,
}: Robot3DViewerProps) {
  const robotType = normalizeRobotType(rawRobotType);
  // three.js needs literal colors: read the theme tokens once per render.
  const background = readCssColor('--bg-tertiary', 'black');
  const cellColor = readCssColor('--border-color-strong', 'gray');
  const sectionColor = readCssColor('--color-primary', 'white');

  // Camera position based on robot type
  const cameraPosition: [number, number, number] =
    robotType === 'so101' ? [0.5, 0.4, 0.5] :
    robotType === 'g1' || robotType === 'g1_edu' ? [1.5, 1.0, 1.5] :
    [2, 1.5, 2];

  return (
    <div className={cn('relative h-full min-h-[300px] w-full overflow-hidden rounded-control', className)}>
      <ViewerGuard className="rounded-none">
        <Canvas
          camera={{ position: cameraPosition, fov: 50 }}
          shadows
          gl={{ antialias: true }}
          style={{ background }}
        >
          <Suspense fallback={<LoadingPlaceholder />}>
            <ambientLight intensity={0.7} color="white" />
            <directionalLight
              position={[5, 10, 5]}
              intensity={2.0}
              color="white"
              castShadow
              shadow-mapSize={[1024, 1024]}
            />
            <directionalLight position={[-3, 5, -3]} intensity={1.2} color="white" />
            <directionalLight position={[0, 5, 5]} intensity={0.8} color="white" />

            <Center>
              <RobotModel
                robotType={robotType}
                jointStates={jointStates}
                isAnimating={isAnimating}
                robotId={robotId}
              />
            </Center>

            <Grid
              args={[10, 10]}
              cellSize={0.5}
              cellThickness={0.5}
              cellColor={cellColor}
              sectionSize={2}
              sectionThickness={1}
              sectionColor={sectionColor}
              fadeDistance={12}
              position={[0, robotType === 'so101' ? -0.05 : robotType === 'g1' || robotType === 'g1_edu' ? -0.75 : -0.95, 0]}
            />

            <OrbitControls
              enablePan={true}
              enableZoom={true}
              enableRotate={true}
              maxPolarAngle={Math.PI / 2}
              minDistance={0.5}
              maxDistance={10}
            />
          </Suspense>
        </Canvas>
      </ViewerGuard>
    </div>
  );
});

// ============================================================================
// FALLBACK COMPONENT
// ============================================================================

/** Suspense fallback while the 3D bundle loads: a calm skeleton, no animation theatre. */
export function Robot3DViewerFallback({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative h-full min-h-[300px] w-full', className)}
      role="status"
      aria-label="Loading 3D model"
    >
      <Skeleton className="absolute inset-0 h-full w-full rounded-control" />
      <span className="absolute inset-0 flex items-center justify-center text-[13px] text-ink-tertiary">
        Loading 3D model…
      </span>
    </div>
  );
}
