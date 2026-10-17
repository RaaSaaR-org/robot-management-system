/**
 * @file VrUiRig.tsx
 * @description The in-VR pointer (TASK-407): a ray from each controller whose
 *              grip is FREE, tested against the buttons in `vrUiRegistry`, and
 *              clicked with the trigger's rising edge. Drawn only while it hits
 *              something. Mounted inside the XR origin, because WebXR poses are
 *              relative to the reference space and the origin moves on every
 *              recenter.
 * @feature robots
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import * as THREE from 'three';
import { routeControllerInput } from './vrInput';
import {
  IDLE_PRESS,
  UI_TRIGGER_THRESHOLD,
  pickVrUiHit,
  rayFromPose,
  stepPress,
  vrUiDebug,
  vrUiGate,
  vrUiTargets,
  type VrPressState,
  type VrUiTargetUi,
} from './vrUiRegistry';
import { HAPTICS, pulsePreset, type HapticSource } from './vrHaptics';
import type { VrRigTelemetry } from './VrTeleopRig';

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];

/** Cursor dot radius, metres. */
const CURSOR_RADIUS_M = 0.006;

/**
 * Why a CUSTOM ray and not `@pmndrs/xr`'s `rayPointer` (D1): the library clicks
 * on `select`, which is the TRIGGER — and the trigger is the grasp. Its ray would
 * have pressed a button every time the operator closed the robot's hand, and
 * closed the hand every time they pressed a button. This ray exists only while
 * the grip is free, which is exactly when the trigger is unused.
 *
 * Tracked hands are out of scope: they keep the two-hand pinch E-stop.
 */
export function VrUiRig({ telemetryRef }: { telemetryRef: { current: VrRigTelemetry } }) {
  const left = useXRInputSourceState('controller', 'left');
  const right = useXRInputSourceState('controller', 'right');
  /** Identity group inside the XR origin: its world matrix is the reference space's. */
  const anchor = useRef<THREE.Group>(null);
  const press = useRef<Record<Side, VrPressState>>({ left: IDLE_PRESS, right: IDLE_PRESS });
  const hoverId = useRef<Record<Side, string | null>>({ left: null, right: null });

  const visuals = useMemo(() => {
    const make = () => {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 'lightskyblue', transparent: true, opacity: 0.8, toneMapped: false }),
      );
      line.visible = false;
      line.frustumCulled = false;
      const cursor = new THREE.Mesh(
        new THREE.SphereGeometry(CURSOR_RADIUS_M, 12, 8),
        new THREE.MeshBasicMaterial({ color: 'white', toneMapped: false }),
      );
      cursor.visible = false;
      return { line, cursor };
    };
    return { left: make(), right: make() };
  }, []);
  useEffect(() => () => {
    for (const side of SIDES) {
      const { line, cursor } = visuals[side];
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      cursor.geometry.dispose();
      (cursor.material as THREE.Material).dispose();
    }
  }, [visuals]);

  // DEV only: what the ray did, for the Playwright live spec.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const w = window as unknown as { __neodemVrUi?: typeof vrUiDebug };
    vrUiDebug.targets = () => {
      const a = anchor.current;
      return vrUiTargets().map((t) => {
        if (!t.object || !a) return { id: t.id, live: false, center: null };
        const c = t.object.getWorldPosition(new THREE.Vector3());
        a.worldToLocal(c);
        return {
          id: t.id,
          live: !t.disabled && t.object.visible,
          center: [c.x, c.y, c.z] as [number, number, number],
        };
      });
    };
    w.__neodemVrUi = vrUiDebug;
    return () => {
      if (w.__neodemVrUi === vrUiDebug) delete w.__neodemVrUi;
    };
  }, []);

  const ray = useMemo(() => new THREE.Ray(), []);
  const localDir = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);

  useFrame((state, _delta, frame) => {
    const t = telemetryRef.current;
    const estopLatched = t.estopLatched;
    vrUiGate.estopLatched = estopLatched;
    const targets = vrUiTargets();
    const ui = new Map<string, VrUiTargetUi>();
    const referenceSpace = state.gl.xr.getReferenceSpace?.() ?? null;
    const a = anchor.current;
    if (a) a.updateWorldMatrix(true, false);
    const now = performance.now();

    for (const side of SIDES) {
      const ctrl = side === 'left' ? left : right;
      const { line, cursor } = visuals[side];
      const hide = (active: boolean, origin: [number, number, number] | null = null): void => {
        line.visible = false;
        cursor.visible = false;
        hoverId.current[side] = null;
        vrUiDebug.rays[side] = { visible: false, active, hitId: null, origin };
      };
      if (!frame || !ctrl || !referenceSpace || !a) {
        press.current[side] = IDLE_PRESS;
        hide(false);
        continue;
      }
      const squeeze = ctrl.gamepad['xr-standard-squeeze']?.button ?? 0;
      const trigger = ctrl.gamepad['xr-standard-trigger']?.button ?? 0;
      const input = routeControllerInput({ squeeze, trigger });
      if (input.clutched) {
        // The grip is held: the trigger is the robot's grasp. No ray, no hits,
        // and no click — and a trigger still down when the grip opens is not
        // an edge (`stepPress` remembers it).
        press.current[side] = stepPress(
          press.current[side],
          { hitId: null, trigger: null, now },
          trigger >= UI_TRIGGER_THRESHOLD,
        ).state;
        hide(false);
        continue;
      }
      const pose = frame.getPose(ctrl.inputSource.targetRaySpace, referenceSpace);
      if (!pose) {
        press.current[side] = IDLE_PRESS;
        hide(false);
        continue;
      }
      const p = pose.transform.position;
      const origin: [number, number, number] = [p.x, p.y, p.z];
      rayFromPose(pose.transform, a.matrixWorld, ray);
      const hit = pickVrUiHit(ray, targets, { estopLatched });
      const step = stepPress(press.current[side], {
        hitId: hit?.target.id ?? null,
        holdMs: hit?.target.holdMs,
        trigger: input.uiTrigger,
        now,
      });
      press.current[side] = step.state;

      const source: HapticSource | undefined = ctrl.inputSource;
      const hitId = hit?.target.id ?? null;
      if (hitId && hitId !== hoverId.current[side]) pulsePreset(source, HAPTICS.uiHover);
      hoverId.current[side] = hitId;

      if (hit) {
        const entry = ui.get(hit.target.id) ?? { hovered: false, pressed: false, progress: 0 };
        entry.hovered = true;
        ui.set(hit.target.id, entry);
      }
      if (step.pressedId) {
        const entry = ui.get(step.pressedId) ?? { hovered: false, pressed: false, progress: 0 };
        entry.pressed = true;
        entry.progress = Math.max(entry.progress, step.progress);
        ui.set(step.pressedId, entry);
      }
      if (step.clickId) {
        const clicked = targets.find((x) => x.id === step.clickId);
        if (clicked) {
          vrUiDebug.clicks.push({ id: clicked.id, at: Date.now() });
          pulsePreset(source, HAPTICS.uiClick);
          clicked.onClick();
        }
      }

      if (!hit) {
        hide(true, origin);
        continue;
      }
      // Drawn in the anchor's (= reference space's) frame: from the controller
      // to where the ray meets the button.
      const o = pose.transform.orientation;
      quat.set(o.x, o.y, o.z, o.w);
      localDir.set(0, 0, -1).applyQuaternion(quat);
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      positions.setXYZ(0, p.x, p.y, p.z);
      positions.setXYZ(1, p.x + localDir.x * hit.distance, p.y + localDir.y * hit.distance, p.z + localDir.z * hit.distance);
      positions.needsUpdate = true;
      cursor.position.set(positions.getX(1), positions.getY(1), positions.getZ(1));
      line.visible = true;
      cursor.visible = true;
      vrUiDebug.rays[side] = { visible: true, active: true, hitId, origin };
    }

    for (const target of targets) {
      const next = ui.get(target.id);
      target.ui.hovered = next?.hovered ?? false;
      target.ui.pressed = next?.pressed ?? false;
      target.ui.progress = next?.progress ?? 0;
    }
  });

  return (
    <group ref={anchor}>
      <primitive object={visuals.left.line} />
      <primitive object={visuals.left.cursor} />
      <primitive object={visuals.right.line} />
      <primitive object={visuals.right.cursor} />
    </group>
  );
}
