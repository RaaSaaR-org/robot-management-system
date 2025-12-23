/**
 * @file Robot3DViewer.tsx
 * @description 3D viewer component for robot visualization with Three.js
 * @feature robots
 */

import { Suspense, memo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Center } from '@react-three/drei';
import { RobotModel } from './RobotModel';
import type { RobotType, JointState } from '../../types/robots.types';
import { cn } from '@/shared/utils/cn';
import { Spinner } from '@/shared/components/ui';

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
      <meshStandardMaterial color="#4a5568" wireframe />
    </mesh>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export const Robot3DViewer = memo(function Robot3DViewer({
  robotType,
  jointStates,
  isAnimating = true,
  className,
}: Robot3DViewerProps) {
  // Camera position based on robot type
  const cameraPosition: [number, number, number] =
    robotType === 'so101' ? [0.5, 0.4, 0.5] : [2, 1.5, 2];

  return (
    <div className={cn('w-full h-full min-h-[300px] rounded-lg overflow-hidden', className)}>
      <Canvas
        camera={{ position: cameraPosition, fov: 50 }}
        shadows
        gl={{ antialias: true }}
        style={{
          background: 'linear-gradient(180deg, #1E1F24 0%, #0C1440 100%)'
        }}
      >
        <Suspense fallback={<LoadingPlaceholder />}>
          {/* Main lighting - bright for visibility */}
          <ambientLight intensity={0.6} color="#ffffff" />
          <directionalLight
            position={[5, 10, 5]}
            intensity={2.0}
            color="#ffffff"
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <directionalLight position={[-3, 5, -3]} intensity={1.2} color="#ffffff" />
          <directionalLight position={[0, 5, 5]} intensity={0.8} color="#ffffff" />

          {/* Accent lights for futuristic glow */}
          <pointLight position={[-3, 2, -3]} intensity={1.2} color="#18E4C3" distance={10} />
          <pointLight position={[3, 0, 3]} intensity={0.8} color="#2A5FFF" distance={10} />
          <pointLight position={[0, 3, -2]} intensity={0.6} color="#18E4C3" distance={8} />
          <pointLight position={[0, -1, 2]} intensity={0.5} color="#ffffff" distance={6} />

          {/* Robot Model */}
          <Center>
            <RobotModel
              robotType={robotType}
              jointStates={jointStates}
              isAnimating={isAnimating}
            />
          </Center>

          {/* Ground Grid - brand colors */}
          <Grid
            args={[10, 10]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor="#2A5FFF"
            sectionSize={2}
            sectionThickness={1}
            sectionColor="#18E4C3"
            fadeDistance={12}
            position={[0, robotType === 'so101' ? -0.05 : -0.95, 0]}
          />

          {/* Controls */}
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

      {/* Overlay info */}
      <div className="absolute bottom-2 left-2 text-xs text-theme-tertiary bg-surface-900/80 px-2 py-1 rounded">
        {robotType.toUpperCase()} Model
      </div>
    </div>
  );
});

// ============================================================================
// FALLBACK COMPONENT
// ============================================================================

export function Robot3DViewerFallback({ className }: { className?: string }) {
  return (
    <div className={cn('w-full h-full min-h-[300px] flex items-center justify-center bg-surface-800 rounded-lg', className)}>
      <Spinner size="lg" color="cobalt" label="Loading 3D viewer..." />
    </div>
  );
}
