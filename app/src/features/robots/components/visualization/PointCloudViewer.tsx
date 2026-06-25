/**
 * @file PointCloudViewer.tsx
 * @description 3D point-cloud viewer (Three.js) for depth / LiDAR perception.
 *              Renders a THREE.Points cloud and can place the robot model inside
 *              its own scan. Reuses the Robot3DViewer scene conventions.
 * @feature robots
 */

import { Suspense, memo, useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Center } from '@react-three/drei';
import * as THREE from 'three';
import { RobotModel } from './RobotModel';
import type { RobotType, JointState, PointCloudFrame } from '../../types/robots.types';
import { cn } from '@/shared/utils/cn';
import { brandColors } from '@/brand';

// ============================================================================
// TYPES
// ============================================================================

export type PointCloudColorMode = 'height' | 'intensity';

export interface PointCloudViewerProps {
  /** Latest point-cloud frame (null while connecting) */
  frame: PointCloudFrame | null;
  /** Robot type for the embedded model */
  robotType?: RobotType;
  /** Joint states to pose the embedded model */
  jointStates?: JointState[];
  /** Render the robot model standing inside the cloud (default true) */
  showRobotModel?: boolean;
  /** Color the points by height or intensity (default 'height') */
  colorMode?: PointCloudColorMode;
  /** Point size in world units (default 0.025) */
  pointSize?: number;
  className?: string;
}

// ============================================================================
// COLOR RAMP (blue → cyan → green → yellow → red)
// ============================================================================

function turbo(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  // 5-stop ramp
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [0.13, 0.32, 0.85]],
    [0.25, [0.0, 0.78, 0.92]],
    [0.5, [0.18, 0.85, 0.30]],
    [0.75, [0.98, 0.82, 0.12]],
    [1.0, [0.92, 0.18, 0.12]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (x >= t0 && x <= t1) {
      const f = (x - t0) / (t1 - t0 || 1);
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// ============================================================================
// POINTS
// ============================================================================

interface PointCloudPointsProps {
  frame: PointCloudFrame;
  colorMode: PointCloudColorMode;
  pointSize: number;
  floorY: number;
}

function PointCloudPoints({ frame, colorMode, pointSize, floorY }: PointCloudPointsProps) {
  const geometry = useMemo(() => {
    const n = frame.pointCount;
    const src = frame.positions;
    const positions = src instanceof Float32Array ? src : new Float32Array(src);
    const colors = new Float32Array(n * 3);

    // Height range (robotics z = positions[i*3+2]) for the height colormap.
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const z = positions[i * 3 + 2];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const zSpan = maxZ - minZ || 1;

    for (let i = 0; i < n; i++) {
      let t: number;
      if (colorMode === 'intensity' && frame.hasIntensity) {
        t = frame.intensities[i] ?? 0;
      } else {
        t = (positions[i * 3 + 2] - minZ) / zSpan;
      }
      const [r, g, b] = turbo(t);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
  }, [frame, colorMode]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () => new THREE.PointsMaterial({ size: pointSize, vertexColors: true, sizeAttenuation: true }),
    [pointSize],
  );
  useEffect(() => () => material.dispose(), [material]);

  // Rotate robotics z-up → three.js y-up; lift floor (z=0) to the grid plane.
  return (
    <points
      geometry={geometry}
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, floorY, 0]}
      frustumCulled={false}
    />
  );
}

// ============================================================================
// VIEWER
// ============================================================================

export const PointCloudViewer = memo(function PointCloudViewer({
  frame,
  robotType = 'generic',
  jointStates,
  showRobotModel = true,
  colorMode = 'height',
  pointSize = 0.025,
  className,
}: PointCloudViewerProps) {
  const colors = brandColors();
  const floorY = showRobotModel ? -0.75 : 0;

  return (
    <div className={cn('relative w-full h-full min-h-[300px] rounded-lg overflow-hidden', className)}>
      <Canvas
        camera={{ position: [3, 2.2, 3], fov: 50 }}
        gl={{ antialias: true }}
        style={{
          background: `linear-gradient(180deg, var(--bg-secondary, #1E1F24) 0%, var(--bg-tertiary, #0C1440) 100%)`,
        }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.7} color="#ffffff" />
          <directionalLight position={[5, 10, 5]} intensity={1.4} color="#ffffff" />
          <pointLight position={[-3, 3, -3]} intensity={0.8} color={colors.accent} distance={14} />

          {frame && frame.pointCount > 0 && (
            <PointCloudPoints frame={frame} colorMode={colorMode} pointSize={pointSize} floorY={floorY} />
          )}

          {showRobotModel && (
            <Center>
              <RobotModel robotType={robotType} jointStates={jointStates} isAnimating={!!frame} />
            </Center>
          )}

          <Grid
            args={[16, 16]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor={colors.primary}
            sectionSize={2}
            sectionThickness={1}
            sectionColor={colors.accent}
            fadeDistance={20}
            position={[0, floorY, 0]}
          />

          <OrbitControls
            enablePan
            enableZoom
            enableRotate
            maxPolarAngle={Math.PI / 2}
            minDistance={0.8}
            maxDistance={20}
          />
        </Suspense>
      </Canvas>

      {/* Overlay info */}
      <div className="absolute bottom-2 left-2 text-xs text-theme-tertiary bg-surface-900/80 px-2 py-1 rounded font-mono">
        {frame
          ? `${frame.sensor.replace(/_/g, ' ').toUpperCase()} · ${frame.pointCount.toLocaleString()} pts`
          : 'Awaiting scan…'}
      </div>

      {/* Provenance badge: REAL recorded / LIVE hardware vs. simulated */}
      {frame?.source && (
        <div
          className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-1 rounded uppercase tracking-wide ${
            frame.source === 'sim'
              ? 'bg-surface-900/80 text-theme-tertiary'
              : 'bg-[#FF6700] text-black'
          }`}
          title={frame.sourceLabel ?? frame.source}
        >
          {frame.source === 'sim'
            ? 'Simulated'
            : frame.source === 'hardware'
              ? 'Live sensor'
              : `Real data${frame.sourceLabel ? ` · ${frame.sourceLabel}` : ''}`}
        </div>
      )}
    </div>
  );
});
