/**
 * @file VrTeleopRig.tsx
 * @description In-XR rig: reads the Meta Quest controllers every frame and
 *              streams arm joint targets and base velocity to the robot agent.
 *              Renders nothing — it exists inside the `<XR>` tree only to get a
 *              `useFrame` with the WebXR frame in hand. All of the arithmetic it
 *              used to do inline now lives in the pure modules next to it
 *              (`vrHeading`, `vrDrive`, `vrSmoothing`, `vrRetarget`); what is
 *              left here is the wiring, the edge detection and the send cadence.
 * @feature robots
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import * as THREE from 'three';
import { retargetArm, type RetargetResult, type VrJointMap } from './vrRetarget';
import {
  handKeypointsToRobotFrame,
  isStopPinch,
  wristToRobotFrame,
  HAND_JOINT_NAMES,
  STOP_HOLD_S,
  type RobotHandKeypoints,
  type RobotWristPose,
  type XrRigidTransform,
} from './vrWrist';
import { isStickClick, pickDriveStick, stickAxis } from './vrDrive';
import {
  headingController,
  headingFromCamera,
  limitHeadingStep,
  rotateStick,
  wrapAngle,
  type StickVector,
} from './vrHeading';
import { advanceTargets, type JointTargets } from './vrSmoothing';
import { HAPTICS, pulsePreset, type HapticPreset, type HapticSource } from './vrHaptics';
import type { LinkState } from './vrSession';
import {
  DRIVE_MAX_MPS,
  DRIVE_SEND_INTERVAL_S,
  GRIP_THRESHOLD,
  HEADING_GAP_RESET_S,
  SEND_INTERVAL_S,
  TURN_MAX_RAD_S,
} from './vrConstants';

/** What one hand is doing, for its in-headset marker. */
export interface VrHandTelemetry {
  /** Grip axis, 0..1. */
  squeeze: number;
  /** True while any joint on that arm was clipped by its working range. */
  saturated: boolean;
  /**
   * What is driving this side this frame: a tracked hand, a controller, or
   * nothing. Null under the orientation mapping, which has no pose source.
   */
  tracked: 'hand' | 'controller' | null;
}

/**
 * The single mutable object the rig, the HUD and the modal share.
 *
 * Deliberately a REF and not React state. The rig produces new values 72-120
 * times a second; routing that through `setState` would re-render the whole
 * modal — including the R3F canvas — at headset frame rate, which is the one
 * thing a VR page cannot afford. The rig writes the top half every frame, the
 * modal writes the bottom half on its own (much slower) React cadence, and
 * `VrHud` reads the whole thing inside its own `useFrame` and repaints a canvas
 * only when the text actually changed.
 */
export interface VrRigTelemetry {
  // ---- written by the rig, every frame -------------------------------------
  armLeft: boolean;
  armRight: boolean;
  /**
   * True while a STICK is commanding base motion.
   *
   * Deliberately not "the base is moving": it used to be `vx || vy || omega`,
   * and `omega` comes from the head-follow controller, which is non-zero for any
   * heading error over 2°. So the HUD read MODE DRIVE whenever the operator had
   * turned their body slightly, with no stick touched and both grips free — on
   * the one readout whose whole job is to say which mode they are in. The yaw is
   * reported on its own TURN line instead.
   */
  driving: boolean;
  /** Commanded forward speed, m/s, in the ROBOT's frame. */
  vx: number;
  /**
   * Commanded LEFT (strafe) speed, m/s, in the robot's frame.
   *
   * Was computed, rotated into the robot frame, sent, and then dropped on the
   * floor: a pure sideways walk at the full 0.4 m/s displayed `SPEED 0.00 m/s`.
   */
  vy: number;
  /** Commanded yaw rate, rad/s, CCW positive. */
  omega: number;
  left: VrHandTelemetry;
  right: VrHandTelemetry;
  // ---- written by the modal ------------------------------------------------
  estopLatched: boolean;
  /**
   * True while the base sits in a non-locomoting FSM — see `HudState`.
   *
   * Written by the modal from the agent's `{type:'base'}` frame, never inferred
   * here: the browser cannot see the robot's FSM, and guessing it from "the
   * stick is pushed and the odometry is not moving" would flag every robot that
   * is simply standing against a wall.
   */
  baseDamped: boolean;
  link: LinkState;
  /** Age of the last `{type:'state'}` frame, ms. */
  msSinceState: number | null;
  /** Smoothed control-loop round trip, ms. */
  rttMs: number | null;
  /**
   * The episode being captured, or null when nothing is recording.
   *
   * Written by the modal, not the rig: the rig can ASK for the next episode but
   * it is the session that decides one started, and the frame count is the
   * server's number. `VrWristHud` hands this straight to `composeHud`.
   */
  recording: { episode: number; frames: number } | null;
}

export function createRigTelemetry(): VrRigTelemetry {
  return {
    armLeft: false,
    armRight: false,
    driving: false,
    vx: 0,
    vy: 0,
    omega: 0,
    left: { squeeze: 0, saturated: false, tracked: null },
    right: { squeeze: 0, saturated: false, tracked: null },
    estopLatched: false,
    // False until the agent says otherwise. The opposite default would put
    // "BASE DAMPED" on the plate of every robot for the first tick of every
    // session, and a warning that is usually wrong is a warning nobody reads.
    baseDamped: false,
    // 'lost' until a state frame proves otherwise — the fail-safe direction for
    // a control link, and the same rule `linkState()` applies.
    link: 'lost',
    msSinceState: null,
    rttMs: null,
    recording: null,
  };
}

export interface VrTeleopRigProps {
  jointMap: VrJointMap;
  send: (payload: unknown) => void;
  /** Put the viewpoint back in the robot's head (A/X on either controller). */
  onRecenter: () => void;
  /**
   * Raise the E-Stop. The modal owns the actual `estopSequence` call because it
   * also owns the REST client and the latch flag, and the operator must get the
   * identical sequence whether they pressed B/Y in the headset or the STOP
   * button on the desktop — two copies of a stop sequence is one copy too many.
   */
  onEstop: () => void;
  /**
   * End the current episode and start the next one. Bound to the LEFT thumbstick
   * CLICK — see the frame loop.
   *
   * OPTIONAL, and the binding only exists when it is passed. The same rig is
   * mounted from the robot detail page, where there is no session and no episode
   * to advance; a click there must do nothing rather than throw or, worse, buzz
   * a confirmation for something that did not happen.
   */
  onNextEpisode?: () => boolean | Promise<boolean>;
  /**
   * WEARER heading — the compass bearing the operator's body is facing. Seeded
   * by `VrOrigin` on a recenter and kept current here every frame.
   */
  headingRef: { current: number };
  /**
   * ROBOT heading — the bearing the base has actually been COMMANDED to, which
   * is what the arm retargeting must subtract.
   *
   * These two used to be one number, and that was a bug with teeth: the turn was
   * an open loop, so every radian the rate cap clipped was heading the robot
   * never got. Subtracting the WEARER's bearing then aimed a shoulder that is
   * bolted to the ROBOT at a frame the robot was not in — after a fast 180° body
   * turn the arms were being driven from a frame ~144° away from the one they
   * live in. `headingController` integrates what was actually commanded into
   * this ref, so clipping now only slows the turn down.
   */
  robotHeadingRef: { current: number };
  /**
   * The robot's last reported pose, for seeding the filter. A ref rather than a
   * prop value so a 20 Hz stream of `{type:'state'}` messages does not rebuild
   * this component's frame closure twenty times a second.
   */
  robotPositionsRef: { current: Readonly<Record<string, number>> };
  /**
   * Whether sends are allowed (`shouldStream`). A REF, not a prop that unmounts
   * the rig: the rig has to stay mounted through a link drop so that recenter
   * and the E-Stop keep working, and so the wearer's own view does not change
   * state under them. Only the sends are gated.
   */
  canStreamRef: { current: boolean };
  telemetryRef: { current: VrRigTelemetry };
  /** Bumped on every recenter — resets the heading history (see the reset effect). */
  recenterKey: number;
  /** Whether an immersive session is running — also resets the heading history. */
  inVr: boolean;
  /**
   * How the arm is driven.
   *
   * `orientation` is the original mapping in `vrRetarget.ts`: controller angles
   * onto joint angles, computed here and sent as `{positions}`. It reads no
   * controller POSITION at all, so reaching forward does nothing.
   *
   * `ik` streams where the hand IS — `{wrists}` — and the agent solves the arm.
   * That is the mode a recorded demonstration wants, because the operator's
   * hand and the robot's go to the same place.
   *
   * Both stay: `orientation` is the fallback for an embodiment the agent has no
   * chain for, and it is 645 lines of tested behaviour.
   */
  retargetMode: 'orientation' | 'ik';
  /**
   * Use tracked hands where they are available.
   *
   * A tracked hand supplies BOTH the wrist pose and the fingers for its side,
   * and has no clutch — there is no grip button on a hand, so it drives
   * whenever it is tracked. A side with no tracked hand falls back to that
   * side's controller, so one of each works.
   */
  handTracking: boolean;
}

/** How long a buzz stays queued waiting for the haptic rate limit, in seconds. */
const BUZZ_RETRY_WINDOW_S = 1;

type ControllerState = ReturnType<typeof useXRInputSourceState<'controller'>>;
type HandState = ReturnType<typeof useXRInputSourceState<'hand'>>;

export function VrTeleopRig({
  jointMap,
  send,
  onRecenter,
  onEstop,
  onNextEpisode,
  headingRef,
  robotHeadingRef,
  robotPositionsRef,
  canStreamRef,
  telemetryRef,
  recenterKey,
  inVr,
  retargetMode,
  handTracking,
}: VrTeleopRigProps) {
  const left = useXRInputSourceState('controller', 'left');
  const right = useXRInputSourceState('controller', 'right');
  const leftHand = useXRInputSourceState('hand', 'left');
  const rightHand = useXRInputSourceState('hand', 'right');
  // A/X recenters, B/Y stops. In immersive VR the modal's DOM is not on screen,
  // so neither header button can be reached — the wearer needs both without
  // taking the headset off.
  const recenterHeld = useRef(false);
  const estopHeld = useRef(false);
  /**
   * When both hands started making the stop gesture, or null.
   *
   * The hands-only stop. It is edge-triggered like B/Y — `stopPinchFired` holds
   * until the gesture is released — so an operator who keeps holding it while
   * the robot stops does not re-fire the stop every frame.
   */
  const stopPinchSince = useRef<number | null>(null);
  const stopPinchFired = useRef(false);
  /** Left stick click last frame — the episode boundary is edge-triggered too. */
  const nextEpisodeHeld = useRef(false);
  /** The XR clock, readable from the async episode-boundary callback. */
  const clockRef = useRef(0);

  // Smoothed absolute targets we actually stream.
  const targetsRef = useRef<JointTargets>({});
  const lastSentRef = useRef(0);
  const camQuat = useMemo(() => new THREE.Quaternion(), []);
  const ctrlQuat = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);

  /** Wearer's heading last frame; NaN means "no history", see `limitHeadingStep`. */
  const prevHeading = useRef(Number.NaN);
  /**
   * Seconds of frames since a heading sample was last ACCEPTED.
   *
   * `limitHeadingStep` measures a rate, and a rate needs the elapsed time since
   * the reading it is compared against — not since the last frame. Those are the
   * same number only while samples keep arriving.
   */
  const headingGap = useRef(0);
  const lastDriveRef = useRef(0);
  /** True while the last thing we sent was motion, so we can send one final stop. */
  const wasDriving = useRef(false);
  /** Grip state last frame, per hand, for the clutch haptics. */
  const gripHeld = useRef({ left: false, right: false });
  /** Link state last frame, so 'lost' buzzes once rather than every frame. */
  const prevLink = useRef<LinkState>('lost');
  /** A buzz waiting on the 120 ms haptic rate limit — see the frame loop. */
  const pendingBuzz = useRef<{ preset: HapticPreset; until: number } | null>(null);

  /**
   * Forget the heading history.
   *
   * THE BUG THIS FIXES: `prevHeading` was initialised once at mount, and the rig
   * stays mounted for as long as the modal is open. Take the headset off, walk
   * round the desk, put it back on without closing the modal, and the first
   * frame differentiated a brand-new bearing against a minutes-old one — a step
   * of up to π over one frame's dt, which the old open loop happily sent as a
   * saturated turn command. The robot spun at the full cap on the exact frame
   * the operator regained their view.
   *
   * `robotHeadingRef` is set to NaN rather than to a value: `VrOrigin` reseeds
   * both refs on the recenter frame (the one moment the wearer's bearing and the
   * robot's are known to agree), and the frame loop below only fills it in if
   * that has not happened — a recenter that finds no model must not leave the
   * closed loop chasing a stale target.
   *
   * The button latches are reset here for the same reason the rest is: they
   * are initialised once at mount and the rig outlives every session. End a
   * session with B/Y still held and `estopHeld` stayed true, so the edge
   * detector below swallowed a press made on the FIRST frame of the next
   * session — a narrow window, but it is the E-Stop's edge. `nextEpisodeHeld` is
   * in that list for the same reason: an operator whose thumb is resting on a
   * clicked stick as one session ends would otherwise have the first deliberate
   * episode boundary of the next one swallowed, with nothing on the plate to say
   * why.
   */
  useEffect(() => {
    prevHeading.current = Number.NaN;
    headingGap.current = 0;
    robotHeadingRef.current = Number.NaN;
    wasDriving.current = false;
    gripHeld.current = { left: false, right: false };
    recenterHeld.current = false;
    estopHeld.current = false;
    nextEpisodeHeld.current = false;
  }, [recenterKey, inVr, robotHeadingRef]);

  // Read the controller orientation straight from the WebXR frame's grip space.
  // We deliberately do NOT use `ctrl.object` (the default controller model): that
  // object only exists when the controller model is rendered, and it relies on a
  // remote asset fetch. The grip-space pose is native to WebXR, always available
  // in-session, and lets us keep the headset view clean (no controller gizmos).
  useFrame((state, delta, frame) => {
    const referenceSpace = state.gl.xr.getReferenceSpace?.();
    /**
     * The stop gesture, read straight off the joints.
     *
     * Deliberately NOT inside `readHand`: that returns null the moment any
     * retargeting input is missing or `handTracking` is off, and a stop must
     * not depend on the retargeting being healthy. This asks the two joints it
     * needs and nothing else.
     */
    const stopPinched = (hand: HandState): boolean => {
      const joints = hand?.inputSource?.hand;
      if (!joints || !referenceSpace || !frame) return false;
      const at = (name: string): { x: number; y: number; z: number } | null => {
        const space = joints.get(name as never);
        if (!space) return null;
        return frame.getJointPose?.(space, referenceSpace)?.transform.position ?? null;
      };
      return isStopPinch(at(HAND_JOINT_NAMES.thumbTip), at(HAND_JOINT_NAMES.pinkyTip));
    };
    const now = state.clock.elapsedTime;
    clockRef.current = now;
    const telemetry = telemetryRef.current;
    // No cast: `XRInputSource` satisfies `HapticSource` structurally
    // (`handedness` is a string, `gamepad` is typed `unknown` there precisely
    // because its actuators are optional on every real device).
    const leftSource: HapticSource | undefined = left?.inputSource;
    const rightSource: HapticSource | undefined = right?.inputSource;

    // ---- queued buzz -----------------------------------------------------
    // `pulse()` is rate limited to one per hand per 120 ms so that a held
    // out-of-range pose reads as a series of taps instead of a hum. That limit
    // must never swallow the E-Stop confirmation, which is the one buzz the
    // operator will be waiting for, so an important preset is queued and retried
    // until it lands (or the window expires on a controller with no actuator).
    const buzz = pendingBuzz.current;
    if (buzz) {
      const fired = [pulsePreset(leftSource, buzz.preset), pulsePreset(rightSource, buzz.preset)];
      if (fired.some(Boolean) || now >= buzz.until) pendingBuzz.current = null;
    }

    // ---- buttons ---------------------------------------------------------
    // Edge-triggered: once per press, not once per frame held.
    const recenterPressed =
      right?.gamepad['a-button']?.state === 'pressed' ||
      left?.gamepad['x-button']?.state === 'pressed';
    if (recenterPressed && !recenterHeld.current) onRecenter();
    recenterHeld.current = recenterPressed;

    // ---- next episode ----------------------------------------------------
    // LEFT thumbstick CLICK, and only when the host actually has episodes. The
    // four face buttons are taken by recenter and the E-Stop, both bound on BOTH
    // hands on purpose (see below), and freeing one of those for a recording
    // control would trade a safety property for a convenience. The stick click
    // is unused, takes a deliberate push rather than a nudge — a deflected stick
    // reads 'touched', never 'pressed', see `isStickClick` — and a mis-hit costs
    // an episode boundary rather than a stop.
    //
    // Handled BEFORE the E-Stop so a frame carrying both leaves the STOP's buzz
    // in `pendingBuzz`: there is one slot, and the stop confirmation is the one
    // the operator will be waiting for.
    const nextEpisodePressed = isStickClick(left?.gamepad['xr-standard-thumbstick']);
    if (nextEpisodePressed && !nextEpisodeHeld.current && onNextEpisode) {
      // Buzz on the ANSWER, not on the press. A buzz is a promise the operator
      // acts on — they stop watching and start the next take — so confirming a
      // boundary the session refused (paused, or the robot said no) is worse
      // than confirming nothing. `state.clock.elapsedTime` is read again inside
      // the callback because the frame that resolves is not this one.
      void Promise.resolve(onNextEpisode()).then((accepted) => {
        if (accepted) {
          pendingBuzz.current = {
            preset: HAPTICS.episodeMark,
            until: clockRef.current + BUZZ_RETRY_WINDOW_S,
          };
        }
      });
    }
    nextEpisodeHeld.current = nextEpisodePressed;

    // B on the right hand OR Y on the left. Both, either hand, on purpose: an
    // operator reaching for a stop is not going to recall which controller owns
    // which glyph, and a stop they have to think about is not a stop.
    const estopPressed =
      right?.gamepad['b-button']?.state === 'pressed' ||
      left?.gamepad['y-button']?.state === 'pressed';
    if (estopPressed && !estopHeld.current) {
      pendingBuzz.current = { preset: HAPTICS.estop, until: now + BUZZ_RETRY_WINDOW_S };
      onEstop();
    }
    estopHeld.current = estopPressed;

    // The same stop, reachable with no controller in the room: thumb to little
    // finger on BOTH hands, held. Read every frame regardless of `handTracking`
    // — a stop the operator has to have armed the right toggle to reach is not
    // a stop — and it costs two joint lookups per hand when no hand is tracked.
    const stopping = stopPinched(leftHand) && stopPinched(rightHand);
    if (!stopping) {
      stopPinchSince.current = null;
      stopPinchFired.current = false;
    } else {
      if (stopPinchSince.current === null) stopPinchSince.current = now;
      if (!stopPinchFired.current && now - stopPinchSince.current >= STOP_HOLD_S) {
        stopPinchFired.current = true;
        // No haptics to promise it with: a tracked hand has no actuator. The
        // confirmation the operator gets is the arm stopping and the HUD's red
        // banner, which is why the HUD had to follow the hands too.
        onEstop();
      }
    }

    // ---- link-lost buzz --------------------------------------------------
    if (telemetry.link === 'lost' && prevLink.current !== 'lost') {
      pendingBuzz.current = { preset: HAPTICS.linkLost, until: now + BUZZ_RETRY_WINDOW_S };
    }
    prevLink.current = telemetry.link;

    if (!frame) return;

    // ---- heading ---------------------------------------------------------
    // Turning is PHYSICAL, never a stick. Smooth stick yaw is the single most
    // reliable way to make someone sick in VR — the inner ear reports standing
    // still while the eyes report rotation. Turning your body has no such
    // conflict, and the robot then turns to follow.
    state.camera.getWorldQuaternion(camQuat);
    const sample = headingFromCamera(camQuat);
    // THE GAP IS PART OF THE RATE. `headingFromCamera` returns null whenever the
    // gaze is steeper than ~75°, which is precisely the pose an operator holds
    // while watching the robot's own hands. There was no `else` here, so the
    // clock never advanced across that gap and the next sample was rate-checked
    // against a per-FRAME delta — about 10° of allowance. Turn your body further
    // than that while looking down and every sample afterwards was rejected
    // against a stale `prev`, permanently: the base stopped turning, "forward"
    // walked off-axis, and `retargetArm` drove `shoulder_yaw` into its soft
    // range by the same error. Only an A/X recenter cleared it, and nothing told
    // the operator to press it.
    headingGap.current += delta;
    if (sample !== null) {
      // Long enough without a reading and there is no rate worth measuring —
      // the honest answer is "no history", which `limitHeadingStep` accepts
      // outright, rather than a rejection against a heading from another pose.
      if (headingGap.current > HEADING_GAP_RESET_S) prevHeading.current = Number.NaN;
      const step = limitHeadingStep(prevHeading.current, sample, headingGap.current);
      if (!step.rejected) headingGap.current = 0;
      prevHeading.current = step.heading;
      // Published continuously, not just on recenter: `VrOrigin` seeds this and
      // the closed loop below reads it every frame.
      headingRef.current = step.heading;
      // Only if `VrOrigin` did not already reseed it — see the reset effect.
      if (!Number.isFinite(robotHeadingRef.current)) robotHeadingRef.current = step.heading;
    }

    // THE CLOSED LOOP MAY ONLY INTEGRATE WHAT THE ROBOT IS ACTUALLY TOLD TO DO.
    // The `{move}` frame below goes out only under `canStreamRef`, but the loop
    // ran and wrote back every frame regardless — so while streaming was gated
    // (E-Stop latched, or the socket down) the client kept crediting the robot
    // with a turn nobody commanded. Press B, turn 90° to read the desktop
    // banner, press Reset E-Stop, and `robotHeadingRef` was ~90° from the base's
    // real bearing; `compute()` below subtracts it, so the first grip after the
    // reset aimed a shoulder that is bolted to the robot at a frame the robot
    // was not in. That is verbatim the failure this ref was added to fix. While
    // the stream is gated the loop HOLDS: no omega, nothing integrated, and the
    // ref still says where the base really points. When streaming resumes the
    // error is real again and the robot turns to follow, capped as always.
    const streaming = canStreamRef.current;
    // The write-back is conditional on the robot heading being KNOWN. With a
    // degenerate camera quaternion the seed above never runs, and
    // `headingController` answers a non-finite input by holding at 0 — writing
    // that back would silently pin the robot's bearing to zero and, because 0 is
    // finite, stop the seed from ever running again. The arm retargeting would
    // then subtract a heading nobody measured.
    const robotHeadingKnown = Number.isFinite(robotHeadingRef.current);
    const turn = streaming
      ? headingController({
          wearer: headingRef.current,
          robot: robotHeadingRef.current,
          dt: delta,
          maxRate: TURN_MAX_RAD_S,
        })
      : { omega: 0, robotHeading: robotHeadingRef.current, error: 0 };
    if (streaming && robotHeadingKnown) robotHeadingRef.current = turn.robotHeading;

    // ---- driving ---------------------------------------------------------
    // Runs before the arm work: an operator holding a pose still has to be able
    // to walk, and letting go of both grips must not also stop the base.
    const handStick = (ctrl: ControllerState): StickVector | null => {
      if (!ctrl) return null;
      const squeeze = ctrl.gamepad['xr-standard-squeeze'];
      if (squeeze && (squeeze.button ?? 0) >= GRIP_THRESHOLD) return null; // that hand is on an arm
      const stick = ctrl.gamepad['xr-standard-thumbstick'];
      if (!stick) return null;
      // Stick +y is BACK in the WebXR gamepad mapping, and the robot's +y is its
      // left, so both axes invert on the way to a base velocity.
      return { fwd: -stickAxis(stick.yAxis), left: -stickAxis(stick.xAxis) };
    };
    const stick = pickDriveStick([handStick(left), handStick(right)]);
    // The operator pushes the stick where they are LOOKING; the base takes
    // velocities in its own frame. While the closed loop is still catching up
    // those differ by exactly `turn.error`, and without this rotation a forward
    // push mid-turn walks the robot sideways.
    const drive = stick ? rotateStick(stick, turn.error) : null;
    const vx = (drive?.fwd ?? 0) * DRIVE_MAX_MPS;
    const vy = (drive?.left ?? 0) * DRIVE_MAX_MPS;
    const omega = turn.omega;
    // Two different questions, and conflating them is what put DRIVE on the HUD
    // for a head turn: `stickDriving` is "the operator is asking the base to
    // translate", `moving` is "there is anything at all to send".
    const stickDriving = vx !== 0 || vy !== 0;
    const moving = stickDriving || omega !== 0;

    if (now - lastDriveRef.current >= DRIVE_SEND_INTERVAL_S && streaming) {
      // Send while moving, plus exactly one zero on the way back to rest. The
      // agent's dead-man would stop the robot on its own, but only after another
      // third of a second of floor.
      if (moving || wasDriving.current) {
        lastDriveRef.current = now;
        send({ move: { vx, vy, omega } });
        wasDriving.current = moving;
      }
    }

    // ---- arms ------------------------------------------------------------
    const compute = (ctrl: ControllerState, side: 'left' | 'right'): RetargetResult | null => {
      if (!ctrl) return null;
      const squeeze = ctrl.gamepad['xr-standard-squeeze'];
      if (!squeeze || (squeeze.button ?? 0) < GRIP_THRESHOLD) return null; // clutch

      const gripSpace = ctrl.inputSource?.gripSpace;
      if (!referenceSpace || !gripSpace) return null;
      const pose = frame.getPose(gripSpace, referenceSpace);
      if (!pose) return null;

      const o = pose.transform.orientation;
      ctrlQuat.set(o.x, o.y, o.z, o.w);
      euler.setFromQuaternion(ctrlQuat, 'YXZ');
      const trigger = ctrl.gamepad['xr-standard-trigger']?.button ?? 0;
      const axes = ctrl.gamepad['xr-standard-thumbstick'];

      return retargetArm(
        side,
        jointMap,
        {
          pitch: euler.x,
          // Relative to the ROBOT's facing, not the wearer's — the shoulder is
          // bolted to the robot. See `robotHeadingRef`.
          yaw: wrapAngle(euler.y - robotHeadingRef.current),
          roll: euler.z,
        },
        { x: axes?.xAxis ?? 0, y: axes?.yAxis ?? 0 },
        trigger,
      );
    };

    // ---- where the hands ARE (TASK-216) ----------------------------------
    // Everything below is measured FROM THE HEAD and un-yawed by the ROBOT's
    // bearing, so the wearer's height, where they are standing and which way
    // they are facing all cancel — see `vrWrist.ts`. That is what keeps this
    // rig free of the startup pose-match `xr_teleoperate` needs.
    const head = frame.getViewerPose(referenceSpace ?? undefined as never) ?? null;
    const headTransform = head?.transform as XrRigidTransform | undefined;

    /** One tracked hand's wrist pose and fingertips, or null if it is not tracked. */
    const readHand = (
      hand: HandState,
      side: 'left' | 'right',
    ): { wrist: RobotWristPose; keypoints: RobotHandKeypoints } | null => {
      if (!handTracking || !referenceSpace || !headTransform) return null;
      const joints = hand?.inputSource?.hand;
      if (!joints) return null;
      const poseOf = (name: string): XRJointPose | null => {
        const space = joints.get(name as never);
        if (!space) return null;
        return frame.getJointPose?.(space, referenceSpace) ?? null;
      };
      const wristPose = poseOf(HAND_JOINT_NAMES.wrist);
      if (!wristPose) return null;
      const wrist = wristToRobotFrame(
        wristPose.transform as XrRigidTransform,
        headTransform,
        robotHeadingRef.current,
      );
      if (!wrist) return null;
      const keypoints = handKeypointsToRobotFrame({
        wrist: wristPose.transform.position,
        thumbTip: poseOf(HAND_JOINT_NAMES.thumbTip)?.transform.position,
        indexProximal: poseOf(HAND_JOINT_NAMES.indexProximal)?.transform.position,
        indexTip: poseOf(HAND_JOINT_NAMES.indexTip)?.transform.position,
        middleProximal: poseOf(HAND_JOINT_NAMES.middleProximal)?.transform.position,
        middleTip: poseOf(HAND_JOINT_NAMES.middleTip)?.transform.position,
      });
      if (!keypoints) return null;
      telemetry[side].tracked = 'hand';
      return { wrist, keypoints };
    };


    /** One controller's wrist pose, behind the same grip clutch as the arms. */
    const readController = (ctrl: ControllerState, side: 'left' | 'right'): RobotWristPose | null => {
      if (!ctrl || !referenceSpace || !headTransform) return null;
      const squeeze = ctrl.gamepad['xr-standard-squeeze'];
      if (!squeeze || (squeeze.button ?? 0) < GRIP_THRESHOLD) return null; // clutch
      const gripSpace = ctrl.inputSource?.gripSpace;
      if (!gripSpace) return null;
      const pose = frame.getPose(gripSpace, referenceSpace);
      if (!pose) return null;
      const wrist = wristToRobotFrame(
        pose.transform as XrRigidTransform,
        headTransform,
        robotHeadingRef.current,
      );
      if (!wrist) return null;
      telemetry[side].tracked = 'controller';
      // The trigger stays the one-axis grasp it has always been — TASK-216
      // keeps it as the fallback for an operator without hand tracking.
      wrist.grip = ctrl.gamepad['xr-standard-trigger']?.button ?? 0;
      return wrist;
    };

    telemetry.left.tracked = null;
    telemetry.right.tracked = null;
    const trackedLeft = readHand(leftHand, 'left');
    const trackedRight = readHand(rightHand, 'right');
    // The MODE decides how the arm is retargeted; a tracked hand is only a
    // different SOURCE for the pose. It used to decide both — `|| trackedLeft
    // !== null` — which meant one hand drifting into view silently moved both
    // arms onto IK while the mode button still read "Orientation", and on a
    // robot the agent has no arm chain for (an H1 advertises no wrist joints)
    // it put both arms on a retargeting the agent answers with one
    // `ik_unsupported` and then nothing. `handTracking` cannot be armed unless
    // the mode is IK — see the Hands button in VRTeleopModal.
    const ikOn = retargetMode === 'ik';
    const wristLeft = ikOn ? (trackedLeft?.wrist ?? readController(left, 'left')) : null;
    const wristRight = ikOn ? (trackedRight?.wrist ?? readController(right, 'right')) : null;

    const leftResult = ikOn ? null : compute(left, 'left');
    const rightResult = ikOn ? null : compute(right, 'right');
    const want: JointTargets = { ...leftResult?.angles, ...rightResult?.angles };

    // Prune → seed → filter, in that order, as one reducer. Passing an empty
    // `want` is not a no-op and must not be skipped: it is what drops a released
    // arm's frozen joints out of the store, which is the only reason Home works
    // while the other arm is still being driven.
    targetsRef.current = advanceTargets({
      targets: targetsRef.current,
      want,
      robotPositions: robotPositionsRef.current,
      dt: delta,
    });

    // ---- haptics + telemetry --------------------------------------------
    const record = (
      ctrl: ControllerState,
      source: HapticSource | undefined,
      side: 'left' | 'right',
      result: RetargetResult | null,
      /**
       * Engagement under IK, which is a different question from `result`: an
       * arm can be driving with no `RetargetResult` at all, because the joint
       * angles are computed on the robot.
       */
      ikEngaged: boolean,
    ): boolean => {
      const squeeze = ctrl?.gamepad['xr-standard-squeeze']?.button ?? 0;
      const engaged = result !== null || ikEngaged;
      if (engaged !== gripHeld.current[side]) {
        pulsePreset(source, engaged ? HAPTICS.clutchEngage : HAPTICS.clutchRelease);
        gripHeld.current[side] = engaged;
      }
      // Only the orientation mapping knows about saturation: under IK the
      // clamping happens on the robot, and the browser is not told. A tap that
      // means "you are asking for something unreachable" is worth having back
      // and is deliberately not faked here from a guess.
      const saturated = (result?.saturated.length ?? 0) > 0;
      // Rate limited inside `pulse()`, so calling this every frame produces a
      // tap roughly every 120 ms for as long as the pose is unreachable —
      // information, rather than the featureless hum an unlimited call gives.
      if (saturated) pulsePreset(source, HAPTICS.saturation);
      // Mutated in place, not replaced. `VrRigTelemetry`'s own docstring says it
      // is a ref precisely to avoid per-frame churn, and `telemetry[side] = {…}`
      // put two fresh objects per frame — ~240/s at 120 Hz — straight back on
      // the mobile GPU's heap, where a GC pause is a dropped frame in the view.
      const hand = telemetry[side];
      hand.squeeze = squeeze;
      hand.saturated = saturated;
      return engaged;
    };
    telemetry.armLeft = record(left, leftSource, 'left', leftResult, wristLeft !== null);
    telemetry.armRight = record(right, rightSource, 'right', rightResult, wristRight !== null);
    telemetry.driving = stickDriving;
    telemetry.vx = vx;
    telemetry.vy = vy;
    telemetry.omega = omega;

    if (!streaming) return;
    if (now - lastSentRef.current < SEND_INTERVAL_S) return;

    if (ikOn) {
      // A side that is absent is a hand that is not driving, and the agent's
      // contract for it is HOLD — it does not fall back to a default pose and
      // it does not fall back to the orientation mapping, which would change
      // retargeting strategy in the middle of a recorded demonstration.
      if (!wristLeft && !wristRight && !trackedLeft && !trackedRight) return;
      lastSentRef.current = now;
      send({ wrists: { left: wristLeft, right: wristRight } });
      if (trackedLeft || trackedRight) {
        send({
          hands: {
            left: trackedLeft?.keypoints ?? null,
            right: trackedRight?.keypoints ?? null,
          },
        });
      }
      return;
    }

    if (Object.keys(want).length === 0) return; // neither arm engaged — hold pose
    lastSentRef.current = now;
    send({ positions: targetsRef.current });
  });

  return null;
}
