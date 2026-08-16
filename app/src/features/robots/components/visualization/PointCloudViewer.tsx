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
import { UI_DATE_LOCALE } from '@/shared/utils/format';

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
  /** Robot id for the high-rate telemetry channel (TASK-191) */
  robotId?: string;
  /** Render the robot model standing inside the cloud (default true) */
  showRobotModel?: boolean;
  /** Color the points by height or intensity (default 'height') */
  colorMode?: PointCloudColorMode;
  /** Point size in world units (default 0.025) */
  pointSize?: number;
  /**
   * Clip the cloud to the room band (default false). A head-mounted MID-360
   * (−7°…+52° vertical FOV) sees mostly the ceiling — a dense slab hovering
   * over an almost empty floor that reads as "upside down". Clipping points
   * above {@link CEILING_CUTOFF_M} and below-floor reflections reveals the
   * walls and obstacles at robot height instead.
   */
  hideCeiling?: boolean;
  className?: string;
  /**
   * A world-frame cloud (TASK-211): draw the robot as a pose marker at this
   * odom pose instead of a model at the origin, and orbit around the cloud's
   * centre. `yawDeg` follows the robotics convention (0 = +x, CCW).
   */
  robotPose?: { x: number; y: number; yawDeg: number } | null;
  /** Where the orbit camera looks (robotics frame, metres); default the origin. */
  orbitTarget?: [number, number, number];
  /** Overlay label instead of the frame's sensor name. */
  label?: string;
}

/** Room-band clip: everything above this height is treated as ceiling. */
const CEILING_CUTOFF_M = 2.2;
/** Points below this are through-window / reflection noise, not floor. */
const FLOOR_NOISE_CUTOFF_M = -0.3;

/** Drop ceiling + below-floor points; returns the frame unchanged when empty. */
function clipRoomBand(frame: PointCloudFrame): PointCloudFrame {
  const n = frame.pointCount;
  const src = frame.positions instanceof Float32Array ? frame.positions : new Float32Array(frame.positions);
  const positions = new Float32Array(n * 3);
  const intensities = frame.hasIntensity ? new Float32Array(n) : null;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const z = src[i * 3 + 2];
    if (z > CEILING_CUTOFF_M || z < FLOOR_NOISE_CUTOFF_M) continue;
    positions[m * 3] = src[i * 3];
    positions[m * 3 + 1] = src[i * 3 + 1];
    positions[m * 3 + 2] = z;
    if (intensities) intensities[m] = Number(frame.intensities[i] ?? 0);
    m++;
  }
  if (m === n) return frame;
  return {
    ...frame,
    pointCount: m,
    positions: positions.subarray(0, m * 3),
    intensities: intensities ? intensities.subarray(0, m) : frame.intensities,
  };
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

    // Robust 2–98 percentile range so a handful of outliers (long-range
    // returns, reflections) don't compress the whole ramp into one hue.
    // Raw LiDAR intensities are NOT 0..1 (MID-360 reports ~0..255), so
    // intensity mode needs the same normalization as height.
    const useIntensity = colorMode === 'intensity' && frame.hasIntensity;
    const values = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      values[i] = useIntensity ? Number(frame.intensities[i] ?? 0) : positions[i * 3 + 2];
    }
    const sorted = values.slice().sort();
    const lo = sorted[Math.floor(0.02 * (n - 1))];
    const hi = sorted[Math.ceil(0.98 * (n - 1))];
    const span = hi - lo || 1;

    for (let i = 0; i < n; i++) {
      const [r, g, b] = turbo((values[i] - lo) / span);
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
// POSE MARKER — a flat arrow at the robot's odom pose (world clouds)
// ============================================================================

function PoseMarker({ pose, floorY }: { pose: { x: number; y: number; yawDeg: number }; floorY: number }) {
  const geometry = useMemo(() => {
    // Triangle in the robotics XY plane pointing +x; rotated by yaw below.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0.35, 0, 0, -0.2, 0.2, 0, -0.2, -0.2, 0]), 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const yaw = (pose.yawDeg * Math.PI) / 180;
  // Robotics z-up → three.js y-up: (x, y, z) → (x, z, -y).
  return (
    <group position={[pose.x, floorY + 0.05, -pose.y]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry} rotation={[0, 0, yaw]}>
        <meshBasicMaterial color="#2A5FFF" side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, 0, yaw]}>
        <ringGeometry args={[0.32, 0.36, 32]} />
        <meshBasicMaterial color="#2A5FFF" side={THREE.DoubleSide} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// ============================================================================
// VIEWER
// ============================================================================

export const PointCloudViewer = memo(function PointCloudViewer({
  frame,
  robotType = 'generic',
  jointStates,
  robotId,
  showRobotModel = true,
  colorMode = 'height',
  pointSize = 0.025,
  hideCeiling = false,
  className,
  robotPose = null,
  orbitTarget,
  label,
}: PointCloudViewerProps) {
  const colors = brandColors();
  const floorY = showRobotModel ? -0.75 : 0;

  const displayFrame = useMemo(() => {
    // Tiny frames are idle heartbeats, not scans — clipping them away would
    // just turn "1 pt" into a misleading "0 of 1 pts".
    if (!frame || !hideCeiling || frame.pointCount < 50) return frame;
    return clipRoomBand(frame);
  }, [frame, hideCeiling]);
  const clippedCount = frame && displayFrame ? frame.pointCount - displayFrame.pointCount : 0;

  return (
    <div className={cn('relative w-full h-full min-h-[300px] rounded-lg overflow-hidden', className)}>
      <Canvas
        camera={{
          position: orbitTarget ? [orbitTarget[0] + 6, orbitTarget[2] + 7, -orbitTarget[1] + 6] : [3, 2.2, 3],
          fov: 50,
        }}
        gl={{ antialias: true }}
        style={{
          background: `linear-gradient(180deg, var(--bg-secondary, #1E1F24) 0%, var(--bg-tertiary, #0C1440) 100%)`,
        }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.7} color="#ffffff" />
          <directionalLight position={[5, 10, 5]} intensity={1.4} color="#ffffff" />
          <pointLight position={[-3, 3, -3]} intensity={0.8} color={colors.accent} distance={14} />

          {displayFrame && displayFrame.pointCount > 0 && (
            <PointCloudPoints frame={displayFrame} colorMode={colorMode} pointSize={pointSize} floorY={floorY} />
          )}

          {robotPose && <PoseMarker pose={robotPose} floorY={floorY} />}

          {showRobotModel && (
            <Center>
              <RobotModel robotType={robotType} jointStates={jointStates} isAnimating={!!frame} robotId={robotId} />
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
            maxDistance={orbitTarget ? 40 : 20}
            target={orbitTarget ? [orbitTarget[0], floorY + orbitTarget[2], -orbitTarget[1]] : undefined}
          />
        </Suspense>
      </Canvas>

      {/* Overlay info */}
      <div className="absolute bottom-2 left-2 text-xs text-theme-tertiary bg-surface-900/80 px-2 py-1 rounded font-mono">
        {frame && displayFrame
          ? `${(label ?? frame.sensor.replace(/_/g, ' ')).toUpperCase()} · ${
              clippedCount > 0
                ? `${displayFrame.pointCount.toLocaleString(UI_DATE_LOCALE)} of ${frame.pointCount.toLocaleString(UI_DATE_LOCALE)} pts · clipped`
                : `${frame.pointCount.toLocaleString(UI_DATE_LOCALE)} pts`
            }`
          : 'Awaiting scan…'}
      </div>

      {/* Provenance badge: REAL recorded / LIVE hardware vs. simulated */}
      {frame?.source && (
        <div
          className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-1 rounded uppercase tracking-wide ${
            frame.source === 'sim'
              ? 'bg-surface-900/80 text-theme-tertiary'
              : 'bg-cobalt-500 text-white'
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
