/**
 * @file WristCameraPanels.tsx
 * @description The wrist cameras' views in the VR scene (TASK-443): one small
 *              screen per wrist camera the session records, below the head
 *              screen, left wrist on the left, each with an L / R plate. The
 *              stream side is `useCameraScreen`, the head screen's own; what a
 *              wrist leaves out is deliberate — no take strip, no red E-stop
 *              frame, no haptics, half the texture rate, and its status in a
 *              keyed store of its own.
 * @feature robots
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { armCameraStream, useCameraScreen } from './useCameraScreen';
import type { VrCameraStatus } from './vrCameraStatus';
import { useVrWristCameraStatus } from './vrWristCameraStatus';
import { HUD_COLORS } from './vrHud';
import { useTextPlate } from './VrTextPlate';
import { vrUiDebug } from './vrUiRegistry';
import {
  EYE_Y_M,
  PANEL_ASPECT,
  WRIST_PANEL_CENTRE_Y_M,
  WRIST_PANEL_DISTANCE_M,
  WRIST_PANEL_OFFSET_Z_M,
  WRIST_PANEL_TEXTURE_HZ,
  WRIST_PANEL_WIDTH_M,
} from './vrConstants';

const WRIST_PANEL_TALL_M = WRIST_PANEL_WIDTH_M * PANEL_ASPECT;

/** The L / R plate on the screen's top-left corner, metres and pixels. */
const SIDE_PLATE_M = 0.05;
const SIDE_PLATE_PX = 64;

/** Stale badge, scaled to the smaller screen. */
const BADGE_WIDTH_M = 0.16;
const BADGE_HEIGHT_M = 0.04;

/** The offline plate, a quarter of the head screen's: the screen is under half its width. */
const WRIST_PLATE = { pxWidth: 512, pxHeight: 384, linePx: 40 };

const SURROUND_COLOR = 'rgb(70,76,92)';

export type WristSide = 'left' | 'right';

/** Which side a wrist camera is on, by its name; null for a name that says neither. */
export function wristSideOf(camera: string): WristSide | null {
  if (camera.startsWith('left_')) return 'left';
  if (camera.startsWith('right_')) return 'right';
  return null;
}

/**
 * Where a wrist screen sits and how it is turned, in the yaw group's frame.
 *
 * The model's forward is three +X and its LEFT is -Z (`RobotModel` turns the
 * URDF's +Y-left into -Z), so the left wrist's screen is at -Z. Each screen is
 * yawed to point its +Z normal back at the eye and pitched up toward it — they
 * sit half a metre below eye level, and a screen facing straight back would be
 * read at a slant.
 */
export function wristPanelPlacement(side: WristSide): { position: [number, number, number]; rotation: THREE.Euler } {
  const x = WRIST_PANEL_DISTANCE_M;
  const z = side === 'left' ? -WRIST_PANEL_OFFSET_Z_M : WRIST_PANEL_OFFSET_Z_M;
  const yaw = Math.atan2(-x, -z);
  const pitch = -Math.atan2(EYE_Y_M - WRIST_PANEL_CENTRE_Y_M, Math.hypot(x, z));
  return { position: [x, WRIST_PANEL_CENTRE_Y_M, z], rotation: new THREE.Euler(pitch, yaw, 0, 'YXZ') };
}

export interface WristCameraPanelsProps {
  robotId: string;
  /** The wrist cameras the session records, e.g. `['left_wrist_camera', 'right_wrist_camera']`. */
  cameras: readonly string[];
}

/**
 * One screen per wrist camera with a side. `VrScene` mounts this only when the
 * session records wrist cameras, so a head-only session opens no wrist ticket
 * and no wrist stream.
 */
export function WristCameraPanels({ robotId, cameras }: WristCameraPanelsProps) {
  const shown = useMemo(
    () => cameras.flatMap((camera) => {
      const side = wristSideOf(camera);
      return side ? [{ camera, side }] : [];
    }),
    [cameras],
  );
  const shownKey = shown.map((s) => s.camera).join(',');

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    vrUiDebug.wristCameras = shownKey ? shownKey.split(',') : [];
    return () => { vrUiDebug.wristCameras = []; };
  }, [shownKey]);

  return (
    <>
      {shown.map(({ camera, side }) => (
        <WristCameraPanel key={camera} robotId={robotId} camera={camera} side={side} />
      ))}
    </>
  );
}

interface WristCameraPanelProps {
  robotId: string;
  camera: string;
  side: WristSide;
}

function WristCameraPanel({ robotId, camera, side }: WristCameraPanelProps) {
  const placement = useMemo(() => wristPanelPlacement(side), [side]);
  const arm = useMemo(() => armCameraStream(camera), [camera]);
  const surroundRef = useRef<THREE.Mesh>(null);

  const publishWrist = useVrWristCameraStatus((s) => s.publish);
  const removeWrist = useVrWristCameraStatus((s) => s.remove);
  const publish = useCallback(
    (next: Partial<VrCameraStatus>) => publishWrist(camera, next),
    [publishWrist, camera],
  );
  useEffect(() => () => removeWrist(camera), [removeWrist, camera]);

  const screen = useCameraScreen({
    robotId,
    camera,
    arm,
    textureHz: WRIST_PANEL_TEXTURE_HZ,
    publish,
    plate: WRIST_PLATE,
  });
  const { texture, offlinePlate, showPlate, badgePlate, badgeRef } = screen;

  const sidePlate = useTextPlate({
    pxWidth: SIDE_PLATE_PX,
    pxHeight: SIDE_PLATE_PX,
    linePx: 52,
    align: 'center',
  });
  useEffect(() => {
    sidePlate.draw([{ id: 'side', text: side === 'left' ? 'L' : 'R', color: HUD_COLORS.text, bold: true }]);
  }, [sidePlate, side]);

  /** Whether the surround is drawn red, so it is recoloured only on a change. */
  const surroundRed = useRef(false);

  useFrame((state) => {
    screen.step(state.clock.elapsedTime);
    // A frozen wrist turns its own surround red and shows its badge — and
    // nothing else: no pulse. The controllers buzz for the picture the
    // operator steers by, and that is the head screen's.
    //
    // Read off `staleNow` every frame rather than off a poll: a re-arm clears
    // it, and a re-arm that ends on the offline plate polls no more — the
    // surround would stay red around a plate that describes no picture.
    const red = screen.staleNow.current;
    const surround = surroundRef.current;
    if (surround && red !== surroundRed.current) {
      surroundRed.current = red;
      (surround.material as THREE.MeshBasicMaterial).color.set(red ? HUD_COLORS.bad : SURROUND_COLOR);
    }
  });

  return (
    <group position={placement.position} rotation={placement.rotation} name={`vr-wrist-panel-${side}`}>
      <mesh>
        <planeGeometry args={[WRIST_PANEL_WIDTH_M, WRIST_PANEL_TALL_M]} />
        {/* A camera image, not lit geometry — see the head screen. The plate
            takes the same geometry in the same place. */}
        <meshBasicMaterial map={showPlate ? offlinePlate.texture : texture} toneMapped={false} />
      </mesh>
      <mesh ref={surroundRef} position={[0, 0, -0.004]}>
        <planeGeometry args={[WRIST_PANEL_WIDTH_M + 0.016, WRIST_PANEL_TALL_M + 0.016]} />
        <meshBasicMaterial color={SURROUND_COLOR} />
      </mesh>
      {sidePlate.texture && (
        <mesh
          position={[
            -WRIST_PANEL_WIDTH_M / 2 + SIDE_PLATE_M / 2 + 0.008,
            WRIST_PANEL_TALL_M / 2 - SIDE_PLATE_M / 2 - 0.008,
            0.006,
          ]}
          renderOrder={10}
        >
          <planeGeometry args={[SIDE_PLATE_M, SIDE_PLATE_M]} />
          <meshBasicMaterial map={sidePlate.texture} transparent toneMapped={false} depthTest={false} />
        </mesh>
      )}
      {badgePlate.texture && (
        <mesh
          ref={badgeRef}
          visible={false}
          position={[0, -WRIST_PANEL_TALL_M / 2 + BADGE_HEIGHT_M, 0.01]}
          renderOrder={10}
        >
          <planeGeometry args={[BADGE_WIDTH_M, BADGE_HEIGHT_M]} />
          <meshBasicMaterial map={badgePlate.texture} transparent toneMapped={false} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}
