/**
 * @file HeadCameraPanel.tsx
 * @description The robot's own head-camera view, drawn as a panel inside the VR
 *              scene: an MJPEG stream uploaded to a texture at a bounded rate and
 *              only when the picture has actually changed, plus the two failure
 *              states the panel used to hide — a stream that never loaded, and a
 *              stream that stopped moving without ever saying so — and, since
 *              TASK-401, a way back from every failure rather than only one.
 *              TASK-418: a strip along its top edge carries the take state —
 *              REC, the latched E-stop, the verdict after a stop, the session's
 *              end — and the frame turns red while recording or latched.
 *              TASK-443: the stream side lives in `useCameraScreen`, shared
 *              with the wrist panels; the strip, the haptics and the status
 *              store stay here.
 * @feature robots
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import * as THREE from 'three';
import { readCssColor } from '../../common/readCssColor';
import { armCameraStream, useCameraScreen } from './useCameraScreen';
import type { ArmFn } from './useCameraReconnect';
import { useVrCameraStatus } from './vrCameraStatus';
import { HAPTICS, pulsePreset, type HapticSource } from './vrHaptics';
import { HUD_COLORS } from './vrHud';
import { useTextPlate } from './VrTextPlate';
import { VR_UI_MATERIAL, VR_UI_RENDER_ORDER } from './VrPanel';
import { vrUiDebug } from './vrUiRegistry';
import type { VrRigTelemetry } from './VrTeleopRig';
import {
  composeCameraStrip,
  initialCameraStrip,
  stepCameraStrip,
  type CameraStrip,
  type CameraStripMemory,
  type CameraStripTone,
  type VrSessionBridge,
} from './vrSessionBridge';
import {
  PANEL_ASPECT,
  PANEL_CAMERA,
  PANEL_DISTANCE_M,
  PANEL_HEIGHT_M,
  PANEL_TEXTURE_HZ,
  PANEL_WIDTH_M,
} from './vrConstants';

const PANEL_TALL_M = PANEL_WIDTH_M * PANEL_ASPECT;

/**
 * Point the panel's `<img>` at a fresh head-camera stream, ticket and all —
 * see `armCameraStream` for why a ticket, and why the URL stays relative.
 *
 * @returns whether the stream was armed. `false` means no ticket, which the
 *          caller must surface: an `<img>` whose `src` was never assigned fires
 *          no `onerror`, so nothing else would ever say so.
 */
export const armStream: ArmFn = armCameraStream(PANEL_CAMERA);

/** Stale badge geometry, in metres. */
const BADGE_WIDTH_M = 0.3;
const BADGE_HEIGHT_M = 0.075;

/**
 * The take strip (TASK-418): just above the screen's top edge, outside the
 * picture, the screen's full width. Recomposed a few times a second.
 */
const STRIP_HEIGHT_M = 0.075;
const STRIP_PX_WIDTH = 1024;
const STRIP_PX_HEIGHT = 96;
const STRIP_HZ = 8;
const STRIP_LOOK: Record<CameraStripTone, { bg: string; text: string }> = {
  rec: { bg: 'rgba(150,20,20,0.94)', text: 'white' },
  estop: { bg: 'rgba(150,20,20,0.96)', text: 'white' },
  ok: { bg: 'rgba(9,11,17,0.9)', text: 'palegreen' },
  warn: { bg: 'rgba(9,11,17,0.9)', text: 'khaki' },
  dim: { bg: 'rgba(9,11,17,0.9)', text: 'gainsboro' },
  ended: { bg: 'rgba(9,11,17,0.94)', text: 'khaki' },
};

/**
 * The robot's own view, hanging in the scene in front of it.
 *
 * Deliberately a PANEL and not a full-screen backdrop. The head camera does not
 * turn when the wearer's head turns, and a full-screen image that ignores head
 * motion is textbook simulator sickness — made worse here by the stream's own
 * latency. As a panel it behaves like a monitor bolted in front of the robot:
 * look at it to see what the robot sees, look away and the room is still there.
 *
 * It lives inside the yaw group, so a recenter swings it around to face the
 * wearer along with the robot, and it stays put in the world in between.
 *
 * TWO FAILURES IT USED TO HIDE:
 *  - On a load error it returned `null`, so mid-session the screen the operator
 *    was looking at simply vanished — indistinguishable from having turned away
 *    from it, and leaving no clue that there had ever been a camera. It now
 *    renders a plate of the same size in the same place saying so.
 *  - An `<img>` bound to `multipart/x-mixed-replace` does NOT fire `error` when
 *    the upstream stops producing frames: the connection stays open and the last
 *    frame stays decoded, so a frozen picture was pixel-for-pixel identical to a
 *    live picture of a stationary scene. `vrCamera.ts` classifies that; this
 *    file supplies the sample and shows the result.
 */
export interface HeadCameraPanelProps {
  robotId: string;
  /**
   * The recording session (TASK-418), read from the frame loop like the board
   * does — no subscription of its own. Absent on the robot page: the strip then
   * shows only the latched E-stop.
   */
  vrSession?: VrSessionBridge;
  /** The rig's telemetry, for the latched E-stop. */
  telemetryRef?: { current: VrRigTelemetry };
}

export function HeadCameraPanel({ robotId, vrSession, telemetryRef }: HeadCameraPanelProps) {
  const surroundRef = useRef<THREE.Mesh>(null);
  const stripRef = useRef<THREE.Mesh>(null);
  /** The strip's memory of the session, and what it last showed (TASK-418). */
  const stripMemory = useRef<CameraStripMemory | null>(null);
  const stripNow = useRef<CameraStrip | null>(null);
  const lastStrip = useRef(-Infinity);
  const left = useXRInputSourceState('controller', 'left');
  const right = useXRInputSourceState('controller', 'right');

  const stripPlate = useTextPlate({
    pxWidth: STRIP_PX_WIDTH,
    pxHeight: STRIP_PX_HEIGHT,
    linePx: 80,
    align: 'center',
  });

  // The stream, its liveness, its reconnects and its plates (TASK-443: shared
  // with the wrist panels). The status goes to the one head-camera store.
  const publish = useVrCameraStatus((s) => s.publish);
  const resetStatus = useVrCameraStatus((s) => s.reset);
  const screen = useCameraScreen({
    robotId,
    camera: PANEL_CAMERA,
    arm: armStream,
    textureHz: PANEL_TEXTURE_HZ,
    publish,
  });
  const { texture, offlinePlate, showPlate, badgePlate, badgeRef, staleNow } = screen;
  useEffect(() => () => resetStatus(), [resetStatus]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;

    // TASK-418: the take strip, before the camera's step — it must speak even
    // while the picture is offline or connecting.
    if (now - lastStrip.current >= 1 / STRIP_HZ) {
      lastStrip.current = now;
      const view = vrSession?.getState() ?? null;
      const nowMs = Date.now();
      if (view) {
        stripMemory.current = stripMemory.current
          ? stepCameraStrip(stripMemory.current, view, nowMs)
          : initialCameraStrip(view);
      }
      const strip = composeCameraStrip(view, telemetryRef?.current.estopLatched === true, stripMemory.current, nowMs);
      stripNow.current = strip;
      if (import.meta.env.DEV) vrUiDebug.strip = strip?.text ?? '';
      if (stripRef.current) stripRef.current.visible = strip !== null;
      if (strip) {
        const look = STRIP_LOOK[strip.tone];
        stripPlate.draw([{ id: 'strip', text: strip.text, color: look.text, bold: true }], { background: look.bg });
      }
      const surround = surroundRef.current;
      if (surround) {
        (surround.material as THREE.MeshBasicMaterial).color.set(
          strip?.redFrame || staleNow.current ? HUD_COLORS.bad : readCssColor('--color-primary', 'white'),
        );
      }
    }

    const poll = screen.step(now);
    if (!poll) return;

    if (poll.becameStale) {
      // `linkLost` rather than a preset of its own: this IS a link loss from the
      // operator's point of view — the thing they were steering by has stopped
      // arriving — and it is long enough not to be mistaken for a saturation tap.
      const sources: Array<HapticSource | undefined> = [left?.inputSource, right?.inputSource];
      for (const source of sources) pulsePreset(source, HAPTICS.linkLost);
    }

    const surround = surroundRef.current;
    if (surround) {
      (surround.material as THREE.MeshBasicMaterial).color.set(
        poll.isStale || stripNow.current?.redFrame ? HUD_COLORS.bad : readCssColor('--color-primary', 'white'),
      );
    }
  });

  return (
    <group position={[PANEL_DISTANCE_M, PANEL_HEIGHT_M, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh>
        <planeGeometry args={[PANEL_WIDTH_M, PANEL_TALL_M]} />
        {/* toneMapped: this is a camera image, not lit geometry — leave its
            values alone or the render pipeline crushes the highlights. The
            offline plate takes the SAME geometry in the SAME place, so a stream
            that dies mid-session leaves the screen where the operator last saw
            it instead of leaving a hole in the scene. */}
        <meshBasicMaterial map={showPlate ? offlinePlate.texture : texture} toneMapped={false} />
      </mesh>
      {/* A thin surround, so the panel reads as a screen and not a hole. Turns
          red while the picture is frozen — the one state that otherwise looks
          exactly like a working camera. */}
      <mesh ref={surroundRef} position={[0, 0, -0.005]}>
        <planeGeometry args={[PANEL_WIDTH_M + 0.03, PANEL_TALL_M + 0.03]} />
        <meshBasicMaterial color={readCssColor('--color-primary', 'white')} />
      </mesh>
      {stripPlate.texture && (
        <mesh
          ref={stripRef}
          visible={false}
          position={[0, PANEL_TALL_M / 2 + 0.015 + STRIP_HEIGHT_M / 2 + 0.006, 0.002]}
          renderOrder={VR_UI_RENDER_ORDER.strip}
          name="vr-camera-strip"
        >
          <planeGeometry args={[PANEL_WIDTH_M + 0.03, STRIP_HEIGHT_M]} />
          <meshBasicMaterial map={stripPlate.texture} {...VR_UI_MATERIAL} />
        </mesh>
      )}
      {badgePlate.texture && (
        <mesh
          ref={badgeRef}
          visible={false}
          position={[0, PANEL_TALL_M / 2 - BADGE_HEIGHT_M, 0.01]}
          renderOrder={10}
        >
          <planeGeometry args={[BADGE_WIDTH_M, BADGE_HEIGHT_M]} />
          <meshBasicMaterial map={badgePlate.texture} transparent toneMapped={false} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}
