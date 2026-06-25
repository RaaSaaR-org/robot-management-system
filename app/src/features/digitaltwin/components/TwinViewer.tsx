/**
 * @file TwinViewer.tsx
 * @description 3D viewer for a digital twin: the L0/L1 backdrop (point cloud or
 *   GLB mesh), L2 zone volumes, the walked path, and the live robot pose (L3) —
 *   all in one shared world frame. Reuses the perception viewer's scene
 *   conventions.
 * @feature digitaltwin
 */

import { Suspense, memo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { brandColors } from '@/brand';
import { cn } from '@/shared/utils/cn';
import type { RobotType } from '@/features/robots/types/robots.types';
import { twinDimensions } from '../types/twin.types';
import type { AccumulatedCloud, TwinPose, TwinZoneDTO, DigitalTwinDTO } from '../types/twin.types';
import { TwinBackdrop, type TwinBackdropKind } from './TwinBackdrop';
import { ZoneVolumes } from './ZoneVolumes';
import { RobotPathTrail } from './RobotPathTrail';
import { LivePoses } from './LivePoses';

export interface TwinViewerProps {
  cloud: AccumulatedCloud | null;
  /** Backdrop representation. Defaults to 'points'. */
  backdropKind?: TwinBackdropKind;
  /** GLB url for backdropKind='mesh'. */
  meshUrl?: string;
  /** World-meters AABB — drives the dimensions readout. */
  bounds?: DigitalTwinDTO['bounds'];
  /** L2 zones to render as extruded volumes. */
  zones?: TwinZoneDTO[];
  selectedZoneId?: string | null;
  onSelectZone?: (id: string) => void;
  path?: TwinPose[];
  robotPose?: TwinPose | null;
  robotType?: RobotType;
  pointSize?: number;
  className?: string;
}

export const TwinViewer = memo(function TwinViewer({
  cloud,
  backdropKind = 'points',
  meshUrl,
  bounds,
  zones = [],
  selectedZoneId,
  onSelectZone,
  path = [],
  robotPose,
  robotType = 'g1',
  pointSize = 0.04,
  className,
}: TwinViewerProps) {
  const colors = brandColors();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const dims = twinDimensions(bounds);

  return (
    <div className={cn('relative w-full h-full min-h-[360px] rounded-lg overflow-hidden', className)}>
      <Canvas
        camera={{ position: [11, 9, 13], fov: 50 }}
        gl={{ antialias: true }}
        style={{ background: 'linear-gradient(180deg, var(--bg-secondary, #1E1F24) 0%, var(--bg-tertiary, #0C1440) 100%)' }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.7} color="#ffffff" />
          <directionalLight position={[8, 14, 6]} intensity={1.3} color="#ffffff" />
          <pointLight position={[-6, 6, -6]} intensity={0.6} color={colors.accent} distance={40} />

          {/* World-frame group (robotics z-up → three y-up). Backdrop, zones and
              path use world coordinates directly inside here. */}
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <TwinBackdrop kind={backdropKind} cloud={cloud} meshUrl={meshUrl} pointSize={pointSize} />
            {zones.length > 0 && (
              <ZoneVolumes zones={zones} selectedZoneId={selectedZoneId} onSelect={onSelectZone} />
            )}
            {path.length > 1 && <RobotPathTrail path={path} />}
          </group>

          {/* Live robot — native y-up, mapped from world pose. */}
          {robotPose && <LivePoses pose={robotPose} robotType={robotType} />}

          <Grid
            args={[30, 30]}
            cellSize={1}
            cellThickness={0.5}
            cellColor={colors.primary}
            sectionSize={5}
            sectionThickness={1}
            sectionColor={colors.accent}
            fadeDistance={60}
            position={[0, 0, 0]}
          />

          <OrbitControls ref={controlsRef} makeDefault enablePan enableZoom enableRotate maxPolarAngle={Math.PI / 2} minDistance={2} maxDistance={70} />

          {/* Orientation gizmo (click an axis to snap the camera). */}
          <GizmoHelper alignment="top-right" margin={[56, 56]}>
            <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" />
          </GizmoHelper>
        </Suspense>
      </Canvas>

      {/* Dimensions / point-count HUD. */}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 text-xs text-theme-tertiary bg-surface-900/80 px-2 py-1 rounded font-mono">
        {dims ? (
          <>
            <span className="text-theme-secondary">{dims.width.toFixed(1)} × {dims.length.toFixed(1)} m</span>
            <span>·</span>
            <span>{Math.round(dims.area)} m²</span>
            {cloud && <><span>·</span><span>{cloud.pointCount.toLocaleString()} pts</span></>}
          </>
        ) : cloud ? (
          `${cloud.pointCount.toLocaleString()} pts`
        ) : backdropKind === 'mesh' && meshUrl ? (
          'mesh'
        ) : (
          'No scan yet'
        )}
      </div>

      {/* Reset camera. */}
      <button
        type="button"
        onClick={() => controlsRef.current?.reset()}
        className="absolute bottom-2 right-2 text-xs text-theme-secondary bg-surface-900/80 hover:bg-surface-800 px-2 py-1 rounded border border-surface-700"
        title="Reset camera"
      >
        Reset view
      </button>
    </div>
  );
});
