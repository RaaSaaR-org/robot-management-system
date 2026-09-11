/**
 * @file TwinViewer.tsx
 * @description 3D viewer for a digital twin: the L0/L1 backdrop (point cloud or
 *   GLB mesh), L2 zone volumes, the walked path, and the live robot pose (L3) —
 *   all in one shared world frame. Reuses the perception viewer's scene
 *   conventions.
 * @feature digitaltwin
 */

import { Suspense, memo, useEffect, useRef, useState, type RefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
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
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import { Button } from '@/shared/components/ui';
import { useCssColor } from '../utils/cssColor';

/** Whether this browser can create a WebGL context (headless/locked-down browsers can't). */
function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

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

/**
 * Frame the camera on the twin's world AABB whenever it changes. Real imported
 * scans are rarely centered on the origin (a MID-360 capture can span tens of
 * meters off-center), so the default fixed camera would show mostly empty grid.
 * The world group is rotated -90° about X (robotics z-up → three y-up), so a
 * world point (x, y, z) sits at scene (x, z, -y).
 */
function FitCameraToBounds({
  bounds,
  controlsRef,
}: {
  bounds?: DigitalTwinDTO['bounds'];
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((s) => s.camera);
  const { minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0 } = bounds ?? {};
  useEffect(() => {
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    // No real extent yet (draft twin / live preview) — keep the default view.
    if (spanX < 0.5 && spanY < 0.5) return;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const floor = Math.min(0, minZ);
    const span = Math.max(spanX, spanY);
    const dist = Math.min(Math.max(span * 0.85, 6), 140);
    camera.position.set(cx + dist * 0.55, floor + dist * 0.65, -cy + dist * 0.55);
    if ('far' in camera) {
      camera.far = Math.max(1000, dist * 10);
      camera.updateProjectionMatrix();
    }
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(cx, floor, -cy);
      controls.maxDistance = Math.max(70, dist * 2.5);
      controls.update();
      // Make "Reset view" return to this fitted framing, not the origin.
      controls.saveState();
    }
  }, [minX, minY, minZ, maxX, maxY, camera, controlsRef]);
  return null;
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
  // Axis gizmo in the signal tokens: x stopped, y measured, z estimated.
  const axisX = useCssColor('--signal-stopped');
  const axisY = useCssColor('--signal-measured');
  const axisZ = useCssColor('--signal-estimated');
  const [webgl] = useState(detectWebGL);

  if (!webgl) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center bg-inset p-6', className)} role="status">
        <p className="max-w-sm text-center text-[13px] text-ink-tertiary">
          This browser can't show the 3D view (WebGL is unavailable). The scan still records; use the Zones tab for the floor plan.
        </p>
      </div>
    );
  }

  return (
    // The canvas is transparent (r3f default alpha), so the inset surface token
    // shows through as the viewport ground in both themes.
    <div className={cn('relative h-full w-full overflow-hidden bg-inset', className)}>
      <Canvas camera={{ position: [11, 9, 13], fov: 50 }} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.7} color="white" />
          <directionalLight position={[8, 14, 6]} intensity={1.3} color="white" />
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
          <FitCameraToBounds bounds={bounds} controlsRef={controlsRef} />

          {/* Orientation gizmo (click an axis to snap the camera). */}
          <GizmoHelper alignment="top-right" margin={[56, 56]}>
            <GizmoViewport axisColors={[axisX, axisY, axisZ]} labelColor="white" />
          </GizmoHelper>
        </Suspense>
      </Canvas>

      {/* Dimensions / point-count HUD over the canvas. */}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-tag border border-line-subtle bg-panel px-2 py-1 text-xs tabular-nums text-ink-tertiary">
        {dims ? (
          <>
            <span className="text-ink-primary">{dims.width.toFixed(1)} × {dims.length.toFixed(1)} m</span>
            <span>·</span>
            <span>{Math.round(dims.area)} m²</span>
            {cloud && <><span>·</span><span>{cloud.pointCount.toLocaleString(UI_DATE_LOCALE)} pts</span></>}
          </>
        ) : cloud ? (
          `${cloud.pointCount.toLocaleString(UI_DATE_LOCALE)} pts`
        ) : backdropKind === 'mesh' && meshUrl ? (
          'mesh'
        ) : (
          'No scan yet'
        )}
      </div>

      {/* Reset camera. */}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => controlsRef.current?.reset()}
        className="absolute bottom-2 right-2"
        title="Reset camera"
      >
        Reset view
      </Button>
    </div>
  );
});
