/**
 * @file VrScene.tsx
 * @description The teleop 3D scene: the R3F canvas and its `<XR>` subtree —
 *              lights, the yaw group holding the posed robot and its head-camera
 *              panel, the grid, desktop orbit controls, the XR origin, the wrist
 *              HUD and the in-XR controller rig. Rendered both as the desktop
 *              preview and, unchanged, as what the wearer sees inside the headset.
 * @feature robots
 */

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Center } from '@react-three/drei';
import { XR, type XRStore } from '@react-three/xr';
import * as THREE from 'three';
import { brandColors } from '@/brand';
import { RobotModel } from '../../visualization/RobotModel';
import type { JointState, RobotType } from '../../../types/robots.types';
import type { VrJointMap } from './vrRetarget';
import { HeadCameraPanel } from './HeadCameraPanel';
import { VrWristHud } from './VrWristHud';
import { VrOrigin } from './VrOrigin';
import { VrTeleopRig, type VrRigTelemetry } from './VrTeleopRig';

export interface VrSceneProps {
  store: XRStore;
  /** Robot whose head camera feeds the in-scene panel. */
  robotId: string;
  modelType: RobotType;
  jointStates: JointState[];
  /** Wraps the posed model so its bounding box can be measured for the viewpoint. */
  modelRef: React.RefObject<THREE.Group | null>;
  /** Turns the robot to face the wearer's heading on recenter — see `VrOrigin`. */
  yawRef: React.RefObject<THREE.Group | null>;
  /** The wearer's bearing, and the bearing the robot has been commanded to. */
  headingRef: { current: number };
  robotHeadingRef: { current: number };
  /** The robot's last reported pose, for seeding the rig's pose filter. */
  robotPositionsRef: { current: Readonly<Record<string, number>> };
  /** Whether the rig may stream — see `shouldStream`. */
  canStreamRef: { current: boolean };
  telemetryRef: { current: VrRigTelemetry };
  recenterKey: number;
  inVr: boolean;
  jointMap: VrJointMap;
  send: (payload: unknown) => void;
  onRecenter: () => void;
  onEstop: () => void;
  /**
   * End the current episode and start the next — bound to the LEFT stick click.
   * Absent on the robot detail page, which has no session behind it, and the rig
   * leaves the binding unwired when it is.
   */
  onNextEpisode?: () => void;
}

/*
 * There is deliberately no `recording` prop here. The REC line reaches the wrist
 * HUD through `telemetryRef`, which the modal already mirrors it onto — the same
 * route `estopLatched`, `link` and `rttMs` take, and for the same reason: this
 * scene re-renders the whole R3F tree, so a frame counter arriving as a prop
 * would rebuild the canvas every time the server ticked it.
 */

export function VrScene({
  store,
  robotId,
  modelType,
  jointStates,
  modelRef,
  yawRef,
  headingRef,
  robotHeadingRef,
  robotPositionsRef,
  canStreamRef,
  telemetryRef,
  recenterKey,
  inVr,
  jointMap,
  send,
  onRecenter,
  onEstop,
  onNextEpisode,
}: VrSceneProps) {
  const cameraPos: [number, number, number] = modelType === 'so101' ? [0.5, 0.4, 0.5] : [1.5, 1.0, 1.5];

  return (
    <Canvas
      camera={{ position: cameraPos, fov: 50 }}
      gl={{ antialias: true }}
      style={{ background: 'linear-gradient(180deg, var(--bg-secondary, #1E1F24) 0%, var(--bg-tertiary, #0C1440) 100%)' }}
    >
      <XR store={store}>
        <ambientLight intensity={0.7} color="#ffffff" />
        <directionalLight position={[5, 10, 5]} intensity={2.0} color="#ffffff" />
        <directionalLight position={[-3, 5, -3]} intensity={1.2} color="#ffffff" />
        <pointLight position={[-3, 2, -3]} intensity={1.0} color={brandColors().accent} distance={10} />

        <group ref={yawRef}>
          <group ref={modelRef}>
            <Center>
              <RobotModel robotType={modelType} jointStates={jointStates} isAnimating={false} />
            </Center>
          </group>
          {/* Outside `modelRef` on purpose: `VrOrigin` measures the
              eye point off that group's bounding box, and a screen floating
              a metre in front of the robot would drag it forward.

              Not on the SO-101. The panel's geometry is fixed in the ROBOT's
              frame (1.15 m away, 0.8 x 0.6 m), which is several times the size
              of a desk arm this scene already treats as small — see the 0.5 m
              camera distance and the -0.05 grid above. And no SO-101 sidecar
              serves `head_camera`, so that oversized screen was guaranteed to
              resolve to a permanent CAMERA OFFLINE billboard rather than a
              picture. */}
          {modelType !== 'so101' && <HeadCameraPanel robotId={robotId} />}
        </group>

        {/* Puts the headset in the robot's head. Inert outside a session.
            The HUD lives INSIDE it because `XRSpace` writes the grip pose as a
            LOCAL matrix relative to the nearest `xrSpaceContext` — which
            `XROrigin` provides — so a wrist panel mounted as a sibling would be
            placed in the wrong frame the moment the origin moves. */}
        <VrOrigin
          modelRef={modelRef}
          yawRef={yawRef}
          headingRef={headingRef}
          robotHeadingRef={robotHeadingRef}
          recenterKey={recenterKey}
        >
          <VrWristHud telemetryRef={telemetryRef} />
        </VrOrigin>

        <Grid
          args={[10, 10]}
          cellSize={0.5}
          cellColor={brandColors().primary}
          sectionSize={2}
          sectionColor={brandColors().accent}
          fadeDistance={12}
          position={[0, modelType === 'so101' ? -0.05 : -0.75, 0]}
        />

        <OrbitControls enablePan enableZoom enableRotate maxPolarAngle={Math.PI / 2} minDistance={0.5} maxDistance={10} />

        {/* MOUNTED UNCONDITIONALLY. It used to be `{connected && <VrTeleopRig/>}`,
            so a dropped socket unmounted it — and inside the headset nothing
            changed at all: the scene kept rendering, the robot kept its last
            pose, and the operator went on moving their hands at a robot that was
            no longer listening, with no recenter and no E-Stop. The sends are
            gated on `canStreamRef` instead, which leaves both buttons working
            while the link is down. */}
        <VrTeleopRig
          jointMap={jointMap}
          send={send}
          onRecenter={onRecenter}
          onEstop={onEstop}
          onNextEpisode={onNextEpisode}
          headingRef={headingRef}
          robotHeadingRef={robotHeadingRef}
          robotPositionsRef={robotPositionsRef}
          canStreamRef={canStreamRef}
          telemetryRef={telemetryRef}
          recenterKey={recenterKey}
          inVr={inVr}
        />
      </XR>
    </Canvas>
  );
}
