/**
 * @file vrConstants.ts
 * @description Tuning constants for the WebXR teleop rig — stream rates, the
 *              measured geometry of the first-person viewpoint, the head-camera
 *              panel, and the drive/turn mapping — plus the dev-only WebXR
 *              device-emulator switch. Every number here was measured or tuned
 *              against a real Meta Quest / the G1 sim; the comments say against
 *              what, so nobody re-guesses them.
 * @feature robots
 */

import * as THREE from 'three';

/** How often (seconds) controller poses are streamed to the agent (~20 Hz). */
export const SEND_INTERVAL_S = 0.05;
/**
 * Per-frame smoothing factor toward the target pose (0..1; higher = snappier).
 *
 * @deprecated Superseded by `POSE_TAU_S` in `vrSmoothing.ts`. A per-FRAME factor
 * makes the arm's responsiveness a function of the headset's refresh rate: the
 * same 0.25 is a 48 ms time constant at 72 Hz and 29 ms at 120 Hz, so a Quest
 * that switched refresh rate on a thermal event changed the feel of the arm by
 * 1.7x. Use `smoothTowards(current, target, POSE_TAU_S, dt)`.
 */
export const SMOOTHING = 0.25;
/** Grip (squeeze) threshold above which an arm is "engaged". */
export const GRIP_THRESHOLD = 0.5;
/**
 * How far below the top of the robot's silhouette its eyes sit, in metres.
 * There is no eye frame in the URDF, so the viewpoint's HEIGHT comes from the
 * model's own extent rather than a per-embodiment constant. Cross-checked on
 * the G1 EDU: crown at +0.531 in the centred model, so eyes at +0.431 — within
 * a centimetre of shoulder height (+0.292) plus a G1 neck.
 */
export const EYE_BELOW_CROWN_M = 0.1;
/**
 * Links whose midpoint gives the body's vertical axis, for the viewpoint's
 * horizontal placement.
 *
 * The bounding box cannot give this: arms and feet skew its centre (measured
 * 0.169 m off-axis on the G1 EDU, which put the viewpoint outside the head).
 * `head_link` looks like the obvious anchor and is a trap — the URDF loader
 * leaves it unplaced at the model root, indistinguishable from the pelvis.
 * The shoulder links ARE placed, and their midpoint is on the axis by
 * construction.
 */
export const AXIS_LINKS = ['left_shoulder_pitch_link', 'right_shoulder_pitch_link'] as const;
/**
 * How far FORWARD of the head's centre the viewpoint sits, in metres. Small, but
 * enough that the near plane is clear of the head mesh's own polygons.
 */
export const EYE_FORWARD_M = 0.08;
/**
 * The model's forward axis in three-space. `RobotModel` rotates the URDF's Z-up
 * frame by -90° about X, which maps URDF +X (forward, by REP-103) onto three +X.
 */
export const ROBOT_FORWARD = new THREE.Vector3(1, 0, 0);
/**
 * Frames spent converging on a recenter. The correction is a feedback loop — it
 * reads where the headset actually ended up and closes the remaining gap — so it
 * lands in one or two frames; the rest is headroom for a pose that arrives late.
 */
export const RECENTER_FRAMES = 20;
/**
 * Which camera the in-scene panel shows. `head_camera` is what the G1 sim scenes
 * and `g1_sidecar.py` expose.
 *
 * A robot that does not serve it keeps the panel and gets a CAMERA OFFLINE plate
 * of the same size in the same place. This comment used to say the mesh hid
 * itself on the first load error, which is the behaviour `HeadCameraPanel`
 * deliberately REMOVED: a screen that vanishes mid-session is indistinguishable
 * from having turned away from it and leaves no clue there was ever a camera.
 * Embodiments that serve no head camera at all (the SO-101 desk arm) are given
 * no panel by `VrScene` instead, which is a different decision made in a
 * different place.
 */
export const PANEL_CAMERA = 'head_camera';
/** Panel geometry, in metres, in the robot's own frame. */
export const PANEL_DISTANCE_M = 1.15;
export const PANEL_HEIGHT_M = 0.4;
export const PANEL_WIDTH_M = 0.8;
/** 640x480 upstream. */
export const PANEL_ASPECT = 3 / 4;
/**
 * Texture uploads per second.
 *
 * The MJPEG stream runs at ~14 fps while the headset renders at 72, so
 * uploading once per rendered frame would push the same pixels to the GPU five
 * times over — 1.2 MB of RGBA each time. This is deliberately a little above
 * the stream rate, so no frame waits for an upload slot; the panel additionally
 * checks its 8x8 fingerprint before each upload, so a slot that finds the same
 * picture costs nothing. Over-provisioning the RATE is the point, uploading the
 * same pixels was never part of it.
 */
export const PANEL_TEXTURE_HZ = 20;
/**
 * How often (seconds) base velocity is streamed. Slower than the arm stream:
 * this is one RPC to the locomotion controller per message, and the agent drops
 * a tick that arrives while the previous one is still in flight.
 */
export const DRIVE_SEND_INTERVAL_S = 0.1;
/** Thumbstick travel ignored as rest. Quest sticks do not return to exactly 0. */
export const STICK_DEADZONE = 0.15;
/**
 * Nominal top speeds the sticks map to. The agent clamps to the robot's own
 * configured walk/turn speed regardless — these only decide how much of the
 * stick's travel is useful.
 */
export const DRIVE_MAX_MPS = 0.4;
export const TURN_MAX_RAD_S = (45 * Math.PI) / 180;
/**
 * WebXR device emulation. Off by default — when enabled the emulator overlays
 * large controller/ray gizmos, fake hands, and a device panel across the whole
 * page, which looks broken in a normal browser. In a dev build you can opt in
 * per-tab by adding `?xremu` to the URL to test the rig without a headset; a real
 * Meta Quest always uses native WebXR regardless of this setting.
 */
export function resolveXrEmulator(): { type: 'metaQuest3'; syntheticEnvironment: false } | false {
  if (!import.meta.env.DEV) return false;
  try {
    if (new URLSearchParams(window.location.search).has('xremu')) {
      // syntheticEnvironment:false skips the emulator's fake room so the dev
      // preview shows only our own scene (grid + robot). The emulator's control
      // panel and controller gizmos are injected by the library and can't be
      // disabled — they exist only in this dev-only ?xremu mode.
      return { type: 'metaQuest3', syntheticEnvironment: false };
    }
  } catch {
    /* ignore malformed query string */
  }
  return false;
}
export const XR_EMULATOR = resolveXrEmulator();

/** True when the WebXR emulator is wired up (dev `?xremu` on localhost). */
export const EMULATOR_ACTIVE =
  XR_EMULATOR !== false && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

/**
 * After this many seconds without an accepted heading sample, the heading
 * history is discarded rather than rate-checked against.
 *
 * `MAX_HEAD_TURN_RAD_S` is 720°/s, so a gap of 0.25 s already permits a 180°
 * step — and 180° is the largest step `wrapAngle` can even express. Past that
 * point the rate check cannot reject anything, so pretending it still means
 * something only risks rejecting a real turn against a heading read in a
 * different pose. "No history" is the honest state, and `limitHeadingStep`
 * accepts the first sample outright.
 */
export const HEADING_GAP_RESET_S = 0.25;
