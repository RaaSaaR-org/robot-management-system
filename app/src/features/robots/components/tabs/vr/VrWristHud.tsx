/**
 * @file VrWristHud.tsx
 * @description The in-headset heads-up display: a small status panel anchored to
 *              the LEFT controller's grip space, plus a marker on each hand that
 *              says whether that arm is actually engaged. What it says comes from
 *              `vrHud.ts`; this file only draws it.
 * @feature robots
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXRInputSourceState, XRSpace } from '@react-three/xr';
import * as THREE from 'three';
import { composeHud, finishWristHud, markerAppearance, HUD_COLORS, type HudLine } from './vrHud';
import { whyFromTelemetry } from './vrWhy';
import { useTextPlate } from './VrTextPlate';
import { VR_UI_MATERIAL, VR_UI_RENDER_ORDER } from './VrPanel';
import { GRIP_THRESHOLD } from './vrConstants';
import type { VrRigTelemetry } from './VrTeleopRig';
import { hudTakeOf, type VrSessionBridge } from './vrSessionBridge';

/**
 * Panel size in metres — 12 x 6 cm, the size of a large smartwatch.
 *
 * Big enough to read at the ~35 cm a raised wrist sits from the eyes, small
 * enough that it does not become the thing the operator looks at. It is
 * WRIST-anchored and never head-locked: a panel welded to the view is both a
 * comfort problem (it cannot be looked away from, so the eyes keep refocusing on
 * something that never moves against the world) and a safety one — this display
 * exists to be consulted, not to be in the way of the robot's hands.
 */
const HUD_WIDTH_M = 0.12;
const HUD_HEIGHT_M = 0.06;
/** 2:1, matching the plane, at a density that keeps 40 px glyphs crisp. */
const HUD_PX_WIDTH = 512;
const HUD_PX_HEIGHT = 256;

/**
 * Where the panel sits in the left controller's GRIP space, and how it is turned.
 *
 * WebXR defines grip space with -Z along the direction the held object points and
 * +Y out of the back of the hand, so +Z is back toward the wrist and +Y is the
 * face of a wristwatch. The panel is therefore parked slightly back and up, and
 * pitched 60° so it faces up-and-back toward the eyes when the arm is held
 * naturally. This is geometry from that convention, not a measurement — worth
 * re-checking on a real Quest before anyone treats the numbers as tuned.
 */
/**
 * TASK-418: ABOVE the wrist, like a watch face lifted toward the eyes, not in
 * front of it. Parked 5 cm out and 7 cm back the plate floated in front of the
 * session board whenever the left hand was held forward — in a 2064x2208 render
 * of the neutral pose it covered the board's Start button. 10 cm off the back of
 * the hand it sits above the board's top edge (≈ -12° below the eyes) and left of
 * the camera screen, and it turns to face the eyes every frame (the billboard,
 * below) rather than relying on a fixed pitch.
 */
export const HUD_POSITION: [number, number, number] = [0, 0.17, 0.05];

/**
 * And where it sits on a tracked HAND's wrist joint.
 *
 * 9 cm straight out from the joint, with no rotation of its own — the plate is
 * turned to face the head every frame instead. WebXR's hand joint spaces do not
 * share the grip space's convention, and picking an offset for a frame nobody
 * here can check in a headset is how a panel ends up edge-on to the wearer.
 * A distance is a distance in any frame; a billboard needs no frame at all.
 */
export const HUD_POSITION_HAND: [number, number, number] = [0, 0.09, 0];

/** Scratch for the billboard, so the frame loop allocates nothing. */
const FACING = new THREE.Vector3();

/** Recomposes per second. The link age changes continuously; the eye does not. */
const HUD_COMPOSE_HZ = 8;

/** Marker radius in metres — a fingertip-sized bead at the grip origin. */
const MARKER_RADIUS_M = 0.011;

/** RTT thresholds for the HUD colour, in ms. */
const RTT_OK_MS = 120;
const RTT_WARN_MS = 300;

function applyMarker(mesh: THREE.Mesh | null, squeeze: number, saturated: boolean): void {
  if (!mesh) return;
  const look = markerAppearance({ squeeze, saturated, gripThreshold: GRIP_THRESHOLD });
  mesh.scale.setScalar(look.scale);
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.color.set(look.color);
  material.opacity = look.opacity;
}

/**
 * The wrist HUD and the two hand markers.
 *
 * THE PROBLEM THE MARKERS SOLVE: four different causes of a dead arm — the grip
 * released, tracking lost, the controller's battery gone, the socket down — were
 * pixel-for-pixel identical inside the headset. The arm simply stopped following
 * the hand, and the only way to tell which had happened was to take the headset
 * off. The marker answers the first three (it is dim when the grip is open,
 * bright when engaged, red when the arm is on a stop, and ABSENT when the
 * controller is not being tracked at all) and the panel's LINK line answers the
 * fourth.
 *
 * Renders only inside a session: `gripSpace` is undefined outside one, so the
 * desktop preview is left clean.
 *
 * FOLLOWS THE HANDS TOO. Every anchor here used to be a CONTROLLER grip space,
 * so an operator using hand tracking with the controllers put down — the only
 * way that feature is worth having — got no status plate, no markers, and
 * therefore no sight of the E-Stop banner while the arms were following their
 * hands with no clutch. A side with no controller falls back to that hand's
 * `wrist` joint space.
 */
export function VrWristHud({
  telemetryRef,
  vrSession,
}: {
  telemetryRef: { current: VrRigTelemetry };
  /** The recording session (TASK-413): its take is the HUD's first line. */
  vrSession?: VrSessionBridge;
}) {
  const left = useXRInputSourceState('controller', 'left');
  const right = useXRInputSourceState('controller', 'right');
  const leftHand = useXRInputSourceState('hand', 'left');
  const rightHand = useXRInputSourceState('hand', 'right');
  const leftMarker = useRef<THREE.Mesh>(null);
  const rightMarker = useRef<THREE.Mesh>(null);
  const plateMesh = useRef<THREE.Mesh>(null);
  const lastCompose = useRef(0);

  /**
   * What each side's HUD hangs off: the controller's grip space when there is
   * one, otherwise the tracked hand's wrist joint.
   */
  const anchors = useMemo(() => {
    const wristOf = (hand: ReturnType<typeof useXRInputSourceState<'hand'>>) =>
      hand?.inputSource?.hand?.get('wrist' as never) ?? null;
    return {
      left: { space: left?.inputSource.gripSpace ?? wristOf(leftHand), onHand: !left?.inputSource.gripSpace },
      right: { space: right?.inputSource.gripSpace ?? wristOf(rightHand), onHand: !right?.inputSource.gripSpace },
    };
  }, [left, right, leftHand, rightHand]);
  const plate = useTextPlate({
    pxWidth: HUD_PX_WIDTH,
    pxHeight: HUD_PX_HEIGHT,
    linePx: 52,
  });

  useFrame((state) => {
    const t = telemetryRef.current;
    // Markers every frame: this is the operator's only feedback on where the
    // grip's bite point is, and a marker that answered at 8 Hz would feel like
    // the input was being dropped.
    // A tracked hand has no squeeze — it has no clutch at all, it drives
    // whenever it is tracked — so `tracked` is what says whether that arm is
    // engaged. Reading it here is also the only place it is read: the rig wrote
    // it every frame and nothing consumed it, which meant nothing in the
    // headset said a hand was driving.
    applyMarker(leftMarker.current,
      t.left.tracked === 'hand' ? 1 : t.left.squeeze, t.left.saturated);
    applyMarker(rightMarker.current,
      t.right.tracked === 'hand' ? 1 : t.right.squeeze, t.right.saturated);

    // Billboard the plate. A hand's `wrist` joint does not share the grip
    // space's convention, so a fixed rotation there would be a guess; facing
    // the head needs no convention at all — only the anchor's position.
    // TASK-418: the controller plate too, from its place on the forearm.
    if (plateMesh.current) {
      plateMesh.current.lookAt(state.camera.getWorldPosition(FACING));
    }

    const now = state.clock.elapsedTime;
    if (now - lastCompose.current < 1 / HUD_COMPOSE_HZ) return;
    lastCompose.current = now;

    const lines: HudLine[] = composeHud({
      estopLatched: t.estopLatched,
      link: t.link,
      msSinceState: t.msSinceState,
      posesOutstanding: t.posesOutstanding,
      armLeft: t.armLeft,
      armRight: t.armRight,
      driving: t.driving,
      vx: t.vx,
      vy: t.vy,
      omega: t.omega,
      baseDamped: t.baseDamped,
      moveEnabled: t.moveEnabled,
      baseMode: t.baseMode,
      modeControl: t.modeControl,
      recording: hudTakeOf(vrSession?.getState()),
      arm: t.arm,
      clutchHeld: t.clutch.left || t.clutch.right,
      handTracked: t.left.tracked === 'hand' || t.right.tracked === 'hand',
    });
    // TASK-417: RTT only while poses are outstanding — an idle RTT is a
    // number frozen at the last pose. `finishWristHud` puts a blocking reason
    // first (never under a latched E-stop, whose banner already says it), keeps
    // the plate's budget, and always ends on the `B/Y = STOP` tag.
    const rtt = t.posesOutstanding && t.rttMs !== null ? Math.round(t.rttMs) : null;
    const why = whyFromTelemetry(t, Date.now());
    const drawn = finishWristHud(lines, {
      estopLatched: t.estopLatched,
      whyBlock: why.severity === 'block' ? why.short : null,
      rttLine: rtt === null
        ? null
        : {
            id: 'rtt',
            text: `RTT ${rtt}ms`,
            color: rtt < RTT_OK_MS ? HUD_COLORS.ok : rtt < RTT_WARN_MS ? HUD_COLORS.warn : HUD_COLORS.bad,
          },
    });
    plate.draw(drawn);
  });

  return (
    <>
      {anchors.left.space && (
        <XRSpace space={anchors.left.space}>
          <mesh ref={leftMarker}>
            <sphereGeometry args={[MARKER_RADIUS_M, 16, 12]} />
            <meshBasicMaterial transparent toneMapped={false} />
          </mesh>
          {plate.texture && (
            <mesh
              ref={plateMesh}
              position={anchors.left.onHand ? HUD_POSITION_HAND : HUD_POSITION}
              // Drawn last and without a depth test: a status panel that
              // disappears when the operator's wrist passes behind the robot's
              // torso is a status panel that is missing at the moment they are
              // reaching into something. TASK-418: over the robot but UNDER the
              // panels, so a raised wrist can never hide a board button.
              renderOrder={VR_UI_RENDER_ORDER.hud}
            >
              <planeGeometry args={[HUD_WIDTH_M, HUD_HEIGHT_M]} />
              <meshBasicMaterial map={plate.texture} {...VR_UI_MATERIAL} />
            </mesh>
          )}
        </XRSpace>
      )}
      {anchors.right.space && (
        <XRSpace space={anchors.right.space}>
          <mesh ref={rightMarker}>
            <sphereGeometry args={[MARKER_RADIUS_M, 16, 12]} />
            <meshBasicMaterial transparent toneMapped={false} />
          </mesh>
        </XRSpace>
      )}
    </>
  );
}
