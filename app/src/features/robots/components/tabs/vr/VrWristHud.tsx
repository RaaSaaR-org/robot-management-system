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
import { composeHud, markerAppearance, HUD_COLORS, type HudLine } from './vrHud';
import { useTextPlate } from './VrTextPlate';
import { GRIP_THRESHOLD } from './vrConstants';
import type { VrRigTelemetry } from './VrTeleopRig';

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
const HUD_POSITION: [number, number, number] = [0, 0.05, 0.07];
const HUD_ROTATION: [number, number, number] = [-Math.PI / 3, 0, 0];

/**
 * And where it sits on a tracked HAND's wrist joint.
 *
 * 9 cm straight out from the joint, with no rotation of its own — the plate is
 * turned to face the head every frame instead. WebXR's hand joint spaces do not
 * share the grip space's convention, and picking an offset for a frame nobody
 * here can check in a headset is how a panel ends up edge-on to the wearer.
 * A distance is a distance in any frame; a billboard needs no frame at all.
 */
const HUD_POSITION_HAND: [number, number, number] = [0, 0.09, 0];

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
export function VrWristHud({ telemetryRef }: { telemetryRef: { current: VrRigTelemetry } }) {
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

    // Billboard the plate when it is on a hand. The controller offsets below
    // are geometry from WebXR's GRIP space convention; a hand's `wrist` joint
    // is a different frame and its numbers would be a guess. Facing the head
    // needs no convention at all — only the joint's position.
    if (plateMesh.current && anchors.left.onHand) {
      plateMesh.current.lookAt(state.camera.getWorldPosition(FACING));
    }

    const now = state.clock.elapsedTime;
    if (now - lastCompose.current < 1 / HUD_COMPOSE_HZ) return;
    lastCompose.current = now;

    const lines: HudLine[] = composeHud({
      estopLatched: t.estopLatched,
      link: t.link,
      msSinceState: t.msSinceState,
      armLeft: t.armLeft,
      armRight: t.armRight,
      driving: t.driving,
      vx: t.vx,
      vy: t.vy,
      omega: t.omega,
      recording: t.recording,
    });
    // Appended, never inserted, and never while latched: `composeHud` guarantees
    // a latched E-Stop returns exactly its two red lines and nothing competing
    // with them, and an extra readout under that banner is exactly the
    // competition it exists to avoid.
    // The plate holds `HUD_MAX_LINES`; `composeHud` returns at most four and
    // gives up its TURN line while recording precisely so this one still fits.
    if (!t.estopLatched && t.rttMs !== null) {
      const rtt = Math.round(t.rttMs);
      lines.push({
        id: 'rtt',
        text: `RTT ${rtt}ms`,
        color: rtt < RTT_OK_MS ? HUD_COLORS.ok : rtt < RTT_WARN_MS ? HUD_COLORS.warn : HUD_COLORS.bad,
      });
    }
    plate.draw(lines);
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
              rotation={anchors.left.onHand ? [0, 0, 0] : HUD_ROTATION}
              // Drawn last and without a depth test: a status panel that
              // disappears when the operator's wrist passes behind the robot's
              // torso is a status panel that is missing at the moment they are
              // reaching into something.
              renderOrder={10}
            >
              <planeGeometry args={[HUD_WIDTH_M, HUD_HEIGHT_M]} />
              <meshBasicMaterial map={plate.texture} transparent toneMapped={false} depthTest={false} />
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
