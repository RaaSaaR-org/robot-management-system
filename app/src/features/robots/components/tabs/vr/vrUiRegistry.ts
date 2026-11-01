/**
 * @file vrUiRegistry.ts
 * @description The in-VR UI toolkit's shared state (TASK-407): the set of
 *              pressable meshes, the ray hit selection, the trigger press /
 *              hold-to-confirm reducer, and a DEV-only debug snapshot for the
 *              Playwright spec. No React and no WebXR — three.js only for the
 *              raycast, so all of it is testable in vitest with a fake pose.
 * @feature robots
 */

import * as THREE from 'three';

/** A button's visual state, written by the ray rig and read by the button. */
export interface VrUiTargetUi {
  hovered: boolean;
  pressed: boolean;
  /** Hold-to-confirm progress, 0..1. */
  progress: number;
}

/**
 * One pressable thing in the scene.
 *
 * Plain mutable data: the button writes its props into it on each render and
 * the rig reads it on each XR frame, so neither needs a React context — the
 * rig lives in a different subtree (inside the XR origin) from the panels.
 */
export interface VrUiTarget {
  id: string;
  /** The mesh the ray is tested against. Null until it mounts. */
  object: THREE.Object3D | null;
  disabled: boolean;
  /** Stays live while the E-stop is latched (only Reset E-stop). */
  allowWhenEstopped: boolean;
  /** Present: the trigger must be HELD this long, in ms, before `onClick`. */
  holdMs?: number;
  onClick: () => void;
  ui: VrUiTargetUi;
}

const registry = new Set<VrUiTarget>();

/** Add a target; returns the function that removes it. */
export function registerVrUiTarget(target: VrUiTarget): () => void {
  registry.add(target);
  return () => {
    registry.delete(target);
  };
}

/** Every registered target, in registration order. */
export function vrUiTargets(): VrUiTarget[] {
  return [...registry];
}

/** Drop every target. Tests only. */
export function resetVrUiRegistry(): void {
  registry.clear();
  vrUiGate.estopLatched = false;
  vrUiDebug.clicks.length = 0;
  vrUiDebug.panel = [];
  vrUiDebug.panelTitle = '';
  vrUiDebug.board = [];
  vrUiDebug.strip = '';
  vrUiDebug.wristCameras = [];
  vrUiDebug.rays.left = { ...EMPTY_RAY };
  vrUiDebug.rays.right = { ...EMPTY_RAY };
}

/**
 * What the buttons need to know about the robot to draw themselves, written by
 * the ray rig every frame. Module-level for the same reason as the registry.
 */
export const vrUiGate = { estopLatched: false };

/** Whether this object and every ancestor is visible. */
function visibleInTree(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

/** Whether a target may be hit at all right now. */
export function targetIsLive(target: VrUiTarget, estopLatched: boolean): boolean {
  if (!target.object || target.disabled) return false;
  if (estopLatched && !target.allowWhenEstopped) return false;
  return visibleInTree(target.object);
}

export interface VrUiHit {
  target: VrUiTarget;
  distance: number;
  point: THREE.Vector3;
}

/** A pose as WebXR gives it: position and orientation quaternion. */
export interface VrPoseLike {
  position: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
}

const scratchQuat = new THREE.Quaternion();

/**
 * The ray a `targetRaySpace` pose points along, in the space `toWorld` maps to.
 *
 * WebXR defines the target ray as the pose's -Z axis. `toWorld` is the XR
 * origin's world matrix: the pose is relative to the reference space, and the
 * origin is moved on every recenter, so without it the ray would point at
 * where the panels were before the operator was put in the robot's head.
 */
export function rayFromPose(pose: VrPoseLike, toWorld?: THREE.Matrix4, out = new THREE.Ray()): THREE.Ray {
  const { position: p, orientation: o } = pose;
  out.origin.set(p.x, p.y, p.z);
  scratchQuat.set(o.x, o.y, o.z, o.w);
  out.direction.set(0, 0, -1).applyQuaternion(scratchQuat);
  if (toWorld) {
    out.origin.applyMatrix4(toWorld);
    out.direction.transformDirection(toWorld);
  }
  return out;
}

const raycaster = new THREE.Raycaster();

/**
 * The nearest live target the ray hits, or null.
 *
 * Disabled, hidden and (while latched) every target but Reset E-stop are not
 * tested at all, so a dead button in front of a live one cannot swallow the
 * click meant for the one behind it — and nothing but Reset can be pressed
 * while the robot is stopped.
 */
export function pickVrUiHit(
  ray: THREE.Ray,
  targets: readonly VrUiTarget[],
  options: { estopLatched: boolean; maxDistance?: number },
): VrUiHit | null {
  raycaster.ray.copy(ray);
  raycaster.near = 0;
  raycaster.far = options.maxDistance ?? 10;
  let best: VrUiHit | null = null;
  for (const target of targets) {
    if (!targetIsLive(target, options.estopLatched)) continue;
    const hits = raycaster.intersectObject(target.object!, false);
    const hit = hits[0];
    if (hit && (!best || hit.distance < best.distance)) {
      best = { target, distance: hit.distance, point: hit.point.clone() };
    }
  }
  return best;
}

// ---- the press ------------------------------------------------------------

/** Per-controller press state. */
export interface VrPressState {
  /** The target a press began on, or null. */
  targetId: string | null;
  /** When that press began, ms. */
  since: number;
  /** This press already clicked — a hold fires once, never repeats. */
  fired: boolean;
  /** The trigger was down last frame — for the rising edge. */
  triggerWasDown: boolean;
}

export const IDLE_PRESS: VrPressState = { targetId: null, since: 0, fired: false, triggerWasDown: false };

/** Trigger travel that counts as pressed. */
export const UI_TRIGGER_THRESHOLD = 0.5;

export interface VrPressInput {
  /** The target under the ray this frame, or null. */
  hitId: string | null;
  /** That target's hold-to-confirm time; absent = click on the edge. */
  holdMs?: number;
  /** `uiTrigger` from `routeControllerInput`; null while the grip is held. */
  trigger: number | null;
  now: number;
}

export interface VrPressStep {
  state: VrPressState;
  /** The target to click this frame, or null. */
  clickId: string | null;
  /** The pressed target and its hold progress, 0..1. */
  pressedId: string | null;
  progress: number;
}

/**
 * One frame of one controller's trigger against the UI.
 *
 * - A click is the RISING edge of the trigger with a target under the ray. A
 *   trigger already held when the ray arrives on a button does nothing, and so
 *   does one held while the grip is let go — neither is a decision to press.
 * - `holdMs`: the press must stay on the same target for that long. The fill
 *   bar is `progress`; it fires once, at 1, and never repeats for that press.
 * - Moving off the target cancels the press. Moving back does not resume it:
 *   that would need a new edge.
 * - A null trigger (grip held) is idle, but REMEMBERS whether it was down, so
 *   letting go of the grip with the trigger squeezed is not a rising edge.
 */
export function stepPress(prev: VrPressState, input: VrPressInput, rawTriggerDown = false): VrPressStep {
  const idle = (down: boolean): VrPressStep => ({
    state: { ...IDLE_PRESS, triggerWasDown: down },
    clickId: null,
    pressedId: null,
    progress: 0,
  });
  if (input.trigger === null) return idle(rawTriggerDown);
  const down = input.trigger >= UI_TRIGGER_THRESHOLD;
  if (!down) return idle(false);

  const rising = !prev.triggerWasDown;
  if (rising) {
    if (!input.hitId) return idle(true);
    const hold = input.holdMs ?? 0;
    if (hold <= 0) {
      return {
        state: { targetId: input.hitId, since: input.now, fired: true, triggerWasDown: true },
        clickId: input.hitId,
        pressedId: input.hitId,
        progress: 1,
      };
    }
    return {
      state: { targetId: input.hitId, since: input.now, fired: false, triggerWasDown: true },
      clickId: null,
      pressedId: input.hitId,
      progress: 0,
    };
  }

  // Held, no edge. Only a press that began on THIS target continues.
  if (!prev.targetId || prev.targetId !== input.hitId) return idle(true);
  if (prev.fired) {
    return { state: prev, clickId: null, pressedId: prev.targetId, progress: 1 };
  }
  const hold = input.holdMs ?? 0;
  const progress = hold <= 0 ? 1 : Math.min(1, Math.max(0, (input.now - prev.since) / hold));
  if (progress >= 1) {
    return { state: { ...prev, fired: true }, clickId: prev.targetId, pressedId: prev.targetId, progress: 1 };
  }
  return { state: prev, clickId: null, pressedId: prev.targetId, progress };
}

// ---- DEV debug snapshot ---------------------------------------------------

export interface VrUiRayDebug {
  /** The ray is drawn (grip free, controller tracked, something under it). */
  visible: boolean;
  /** The ray is live at all (grip free and controller tracked). */
  active: boolean;
  hitId: string | null;
  /** Ray origin in REFERENCE-space coordinates (where IWER places controllers). */
  origin: [number, number, number] | null;
  /** Ray direction in the same coordinates. */
  direction: [number, number, number] | null;
}

const EMPTY_RAY: VrUiRayDebug = { visible: false, active: false, hitId: null, origin: null, direction: null };

/**
 * What the ray rig did, for the Playwright spec (`window.__neodemVrUi`, DEV only).
 * `targets` is filled in by the rig, which knows the XR origin's transform.
 */
export const vrUiDebug: {
  clicks: Array<{ id: string; at: number }>;
  rays: { left: VrUiRayDebug; right: VrUiRayDebug };
  targets: () => Array<{ id: string; live: boolean; center: [number, number, number] | null }>;
  /** The robot panel's lines as last drawn — the canvas is not readable from a test. */
  panel: string[];
  /** The robot panel's title as last drawn (TASK-414: who is watching). */
  panelTitle: string;
  /** The session board's lines as last drawn (TASK-413); empty without a session. */
  board: string[];
  /** The camera screen's strip as last drawn (TASK-418); '' when it shows none. */
  strip: string;
  /** The wrist cameras with a panel mounted (TASK-443); empty without wrist cameras. */
  wristCameras: string[];
} = {
  clicks: [],
  rays: { left: { ...EMPTY_RAY }, right: { ...EMPTY_RAY } },
  targets: () => [],
  panel: [],
  panelTitle: '',
  board: [],
  strip: '',
  wristCameras: [],
};
