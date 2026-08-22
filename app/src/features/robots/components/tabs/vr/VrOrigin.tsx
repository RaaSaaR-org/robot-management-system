/**
 * @file VrOrigin.tsx
 * @description The XR origin for VR teleop: on entering a session (and on every
 *              recenter) it turns the robot to face the wearer and puts the
 *              headset inside the robot's head, by measuring where the headset
 *              actually ended up rather than assuming a standing height. Also the
 *              parent of anything that has to be positioned from an `XRSpace`
 *              (the wrist HUD), which is why it renders children.
 * @feature robots
 */

import { useEffect, useRef, useMemo, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { XROrigin } from '@react-three/xr';
import * as THREE from 'three';
import { headingFromCamera, wrapAngle } from './vrHeading';
import { AXIS_LINKS, EYE_BELOW_CROWN_M, EYE_FORWARD_M, RECENTER_FRAMES, ROBOT_FORWARD } from './vrConstants';

/**
 * Residual below which the viewpoint is close enough, in metres.
 *
 * 2 mm is an order of magnitude under the ~2 cm of positional noise a Quest's
 * inside-out tracking produces while someone stands still, so it is reached on
 * the first or second frame in practice and is never chased.
 */
const CONVERGED_POSITION_M = 0.002;

/**
 * Frame-to-frame yaw change below which the head counts as still, in radians
 * (0.5°). The yaw is set ABSOLUTELY from the current gaze each frame, so this is
 * not a convergence measure — it is a stillness measure, and it is here so a
 * recenter pressed mid-turn does not finish while the world is still swinging.
 */
const CONVERGED_YAW_RAD = (0.5 * Math.PI) / 180;

/**
 * Puts the headset inside the robot's head.
 *
 * `XROrigin` positions the player's FEET, and WebXR then stacks the wearer's own
 * standing height on top of it — so the origin cannot be set from the robot's
 * geometry alone; it depends on how tall the person in the headset is. Rather
 * than ask, this measures: it reads where the headset actually ended up and
 * moves the origin by the remaining error, which converges in a frame or two
 * whatever the wearer's height and wherever they are standing in their room.
 *
 * The correction runs only while `pending` counts down — on entering VR, and on
 * an explicit recenter. It deliberately does NOT run every frame: continuously
 * pinning the view to the head would cancel the wearer's own leaning and
 * crouching, and a headset that does not answer head movement is the classic
 * way to make somebody ill.
 *
 * THE BUG THAT DOCSTRING DID NOT PREVENT: it then ran all 20 frames regardless,
 * because there was no convergence exit — 0.28 s at 72 Hz of exactly the
 * head-cancelling it warns about, on every session start and every A/X press,
 * which is the most common thing an operator does. It now exits the moment the
 * residual is under 2 mm and the head is still, keeping 20 only as a ceiling for
 * a pose that arrives late.
 *
 * NOR DID IT PREVENT THIS ONE: "on entering VR" was a claim, not a check. The
 * arming effect fires on MOUNT (`recenterKey` starts at 0), so the burst ran on
 * the DESKTOP preview the instant the modal opened. Outside a session
 * `state.camera` is the OrbitControls camera — `XROrigin` adds `gl.xr.getCamera()`
 * to its group, it does not swap `state.camera` — so the yaw was written from
 * the orbit camera's bearing, which for the default [1.5, 1, 1.5] viewpoint is
 * 135°: the robot turned its back on the viewer as the dialog appeared, and
 * stayed that way, because the modal only zeroes the yaw group when LEAVING VR.
 * The `frame` argument is non-null only inside a session — the same guard the
 * rig uses — so the burst now genuinely runs in VR and nowhere else.
 */
export function VrOrigin({ modelRef, yawRef, headingRef, robotHeadingRef, recenterKey, children }: {
  modelRef: React.RefObject<THREE.Group | null>;
  yawRef: React.RefObject<THREE.Group | null>;
  /** Written here, read by `VrTeleopRig` — see `HEADING` note in the rig. */
  headingRef: { current: number };
  /**
   * The robot's commanded bearing, seeded here and then integrated by the rig's
   * closed loop. A recenter is the one moment the wearer's bearing and the
   * robot's are known to agree — it is literally defined as "you are now facing
   * where the robot faces" — so it is the only honest place to seed it.
   */
  robotHeadingRef: { current: number };
  recenterKey: number;
  /** Rendered inside the origin group; `XROrigin` takes group props. */
  children?: ReactNode;
}) {
  const originRef = useRef<THREE.Group>(null);
  const pending = useRef(0);
  /** Yaw applied on the previous correction frame; NaN on the first of a burst. */
  const lastYaw = useRef(Number.NaN);
  const box = useMemo(() => new THREE.Box3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const camWorld = useMemo(() => new THREE.Vector3(), []);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const camQuat = useMemo(() => new THREE.Quaternion(), []);
  const linkWorld = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    pending.current = RECENTER_FRAMES;
    lastYaw.current = Number.NaN;
  }, [recenterKey]);

  useFrame((state, _delta, frame) => {
    // No XRFrame means no session: see the docstring. The arm is left standing
    // so that a recenter pressed as the session begins is still honoured on its
    // first in-session frame.
    if (!frame) return;
    if (pending.current <= 0) return;
    const origin = originRef.current;
    const model = modelRef.current;
    if (!origin || !model) return;
    pending.current -= 1;

    // Yaw FIRST: the wearer entered facing wherever they happened to be facing
    // in their room, which has nothing to do with where the robot faces — so
    // turn the ROBOT to them. Turning the origin instead does not work:
    // `XROrigin` feeds only its position into the reference space, and a
    // rotation written onto it is silently ignored (it accumulated to 139 rad in
    // testing while the view never moved). Rotating scene content is a plain
    // three transform and behaves. It has to happen before the measurements
    // below, which read world positions off a model that is about to turn.
    //
    // The bearing comes from `headingFromCamera`, not from projecting the
    // forward vector here: that projection is cos(pitch) long, so it collapses
    // exactly when an operator recentres while looking down at the robot's
    // hands — the one gaze they hold most often.
    state.camera.getWorldQuaternion(camQuat);
    const bearing = headingFromCamera(camQuat);
    const yawGroup = yawRef.current;
    const turned = yawGroup !== null && bearing !== null;
    let yawStep = Number.POSITIVE_INFINITY;
    if (turned && yawGroup && bearing !== null) {
      // Same convention the bearing was derived in: an object with
      // rotation.y = θ looks along -Z, so its ground direction is
      // (-sin θ, 0, -cos θ) and atan2(x, z) is θ + π.
      camDir.set(-Math.sin(bearing), 0, -Math.cos(bearing));
      const yaw = bearing + Math.PI - Math.atan2(ROBOT_FORWARD.x, ROBOT_FORWARD.z);
      yawStep = Number.isFinite(lastYaw.current)
        ? Math.abs(wrapAngle(yaw - lastYaw.current))
        : Number.POSITIVE_INFINITY;
      lastYaw.current = yaw;
      yawGroup.rotation.y = yaw;
      yawGroup.updateMatrixWorld(true);
      headingRef.current = bearing;
      robotHeadingRef.current = bearing;
    }

    // Where the eyes belong: on the body's vertical axis, just under the crown
    // of the model as it actually stands, a little forward so the head's own
    // mesh stays behind the near plane.
    box.setFromObject(model);
    if (box.isEmpty()) return;
    box.getCenter(target);
    // Height from the silhouette; the horizontal position from the shoulders,
    // which unlike the bounding box are not dragged off-axis by the limbs.
    const axis = AXIS_LINKS.map((n) => model.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    if (axis.length === AXIS_LINKS.length) {
      target.set(0, 0, 0);
      for (const link of axis) target.add(link.getWorldPosition(linkWorld));
      target.divideScalar(axis.length);
    }
    target.y = box.max.y - EYE_BELOW_CROWN_M;
    // Forward means where the robot faces AFTER the turn above — which is the
    // wearer's own heading — not the model's local +X.
    target.addScaledVector(turned ? camDir : ROBOT_FORWARD, EYE_FORWARD_M);

    // Then position: move the origin by whatever gap is left between the
    // headset and the eye point. Measured, not computed — see above.
    state.camera.getWorldPosition(camWorld);
    const residual = target.sub(camWorld);
    const residualLen = residual.length();
    origin.position.add(residual);

    // Stop as soon as the correction has nothing left to do. `yawStep` is
    // Infinity on the first frame of a burst by construction, so this never
    // exits before at least two frames have been applied — one frame is not
    // enough evidence that the head is still.
    if (residualLen < CONVERGED_POSITION_M && yawStep < CONVERGED_YAW_RAD) {
      pending.current = 0;
    }
  });

  return <XROrigin ref={originRef}>{children}</XROrigin>;
}
