/**
 * @file VrRobotPanel.tsx
 * @description The robot panel in the headset (TASK-407): mode, arms, dead-man,
 *              grip, hands, lease and link, and one line saying why the arms are
 *              not following — plus Recenter, Next take and a hold-to-confirm
 *              Reset E-stop. World-locked beside the head-camera screen, inside
 *              the yaw group, so it follows a recenter.
 * @feature robots
 */

import { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { VrPanel, type VrPanelContent } from './VrPanel';
import { VrButton, VR_BUTTON_HEIGHT_M } from './VrButton';
import { composeRobotPanel, panelFactsFromTelemetry, whyFromTelemetry } from './vrWhy';
import type { VrRigTelemetry } from './VrTeleopRig';

/** Panel size, metres: 0.5 x 0.32 overall, text above a row of buttons. */
export const ROBOT_PANEL_WIDTH_M = 0.5;
export const ROBOT_PANEL_HEIGHT_M = 0.32;
const TEXT_HEIGHT_M = 0.244;
/** Distance from the head, and bearing right of the robot's forward. */
const DISTANCE_M = 0.9;
const BEARING_RAD = (30 * Math.PI) / 180;
/**
 * Height of the panel's centre in the robot's (centred) model frame. The G1's
 * eyes sit at about +0.43 (`EYE_BELOW_CROWN_M`) and the head-camera screen spans
 * +0.1..+0.7 a little further out; this keeps the panel below the screen's
 * corner, looked down at like a desk display.
 */
const CENTRE_Y_M = 0;
const EYE_Y_M = 0.43;

/**
 * Where the panel sits and how it is turned, in the yaw group's frame.
 *
 * The model's forward is three +X and its LEFT is -Z (`RobotModel` turns the
 * URDF's +Y-left into -Z), so 30° to the right is towards +Z. The plane faces
 * back at the head: yawed to point its +Z normal at the origin, then pitched up
 * toward the eyes.
 */
export function robotPanelPlacement(): { position: [number, number, number]; rotation: THREE.Euler } {
  const x = DISTANCE_M * Math.cos(BEARING_RAD);
  const z = DISTANCE_M * Math.sin(BEARING_RAD);
  const yaw = Math.atan2(-x, -z);
  const pitch = -Math.atan2(EYE_Y_M - CENTRE_Y_M, DISTANCE_M);
  return { position: [x, CENTRE_Y_M, z], rotation: new THREE.Euler(pitch, yaw, 0, 'YXZ') };
}

const BG = 'rgba(9,11,17,0.86)';
const BG_LATCHED = 'rgba(96,14,14,0.92)';

export interface VrRobotPanelProps {
  telemetryRef: { current: VrRigTelemetry };
  onRecenter: () => void;
  /** Absent outside a data-collection session: no Next take button then. */
  onNextEpisode?: () => boolean | Promise<boolean>;
  /** The modal's `resetEstop` — the same path as the desktop banner's button. */
  onResetEstop?: () => void | Promise<void>;
}

export function VrRobotPanel({ telemetryRef, onRecenter, onNextEpisode, onResetEstop }: VrRobotPanelProps) {
  const placement = useMemo(robotPanelPlacement, []);

  const compose = useCallback((): VrPanelContent => {
    const t = telemetryRef.current;
    const now = Date.now();
    const why = whyFromTelemetry(t, now);
    const lines = composeRobotPanel(panelFactsFromTelemetry(t), why, now);
    return t.estopLatched
      ? { title: 'ROBOT — E-STOP LATCHED', titleColor: 'white', lines, background: BG_LATCHED, highlight: 'salmon' }
      : { title: 'ROBOT', lines, background: BG };
  }, [telemetryRef]);

  const nextTake = useCallback(() => {
    if (onNextEpisode) void Promise.resolve(onNextEpisode()).catch(() => { /* the session says why */ });
  }, [onNextEpisode]);
  const reset = useCallback(() => {
    if (onResetEstop) void Promise.resolve(onResetEstop()).catch(() => { /* the banner says why */ });
  }, [onResetEstop]);
  const latched = useCallback(() => telemetryRef.current.estopLatched, [telemetryRef]);

  const buttonY = -ROBOT_PANEL_HEIGHT_M / 2 + VR_BUTTON_HEIGHT_M / 2 + 0.005;
  const textY = ROBOT_PANEL_HEIGHT_M / 2 - TEXT_HEIGHT_M / 2;

  return (
    <group position={placement.position} rotation={placement.rotation} name="vr-robot-panel">
      <VrPanel
        width={ROBOT_PANEL_WIDTH_M}
        height={TEXT_HEIGHT_M}
        pxWidth={1024}
        pxHeight={500}
        linePx={52}
        position={[0, textY, 0]}
        compose={compose}
      />
      {/* 1 mm in front of the panel plane, so a button is never z-fighting it. */}
      <VrButton id="recenter" label="Recenter" position={[-0.16, buttonY, 0.001]} onClick={onRecenter} />
      {onNextEpisode && (
        <VrButton id="next-take" label="Next take" position={[0, buttonY, 0.001]} onClick={nextTake} />
      )}
      <VrButton
        id="reset-estop"
        label="Reset E-stop"
        holdLabel="Hold…"
        position={[0.16, buttonY, 0.001]}
        holdMs={1000}
        allowWhenEstopped
        tone="danger"
        disabled={!onResetEstop}
        isVisible={latched}
        onClick={reset}
      />
    </group>
  );
}
