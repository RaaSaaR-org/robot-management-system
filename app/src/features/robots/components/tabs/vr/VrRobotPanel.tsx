/**
 * @file VrRobotPanel.tsx
 * @description The robot panel in the headset (TASK-407): mode, arms, dead-man,
 *              grip, hands, lease and link, the head camera (TASK-413), and one
 *              line saying why the arms are not following — the server's
 *              reason when it blocks (D4) — plus Recenter and a hold-to-confirm
 *              Reset E-stop. World-locked beside the head-camera screen, inside
 *              the yaw group, so it follows a recenter. TASK-414: the title
 *              names who watches from a desktop ("WATCHING Ben (desktop)").
 *              TASK-417: the why line leads, 1.5x, with one row of chips for
 *              what is not fine; a desktop request for Stand up or Balance
 *              shows as "DESKTOP ASKS: Balance" with one hold-to-allow button.
 * @feature robots
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { VrPanel, type VrPanelContent } from './VrPanel';
import { VrButton, VR_BUTTON_HEIGHT_M } from './VrButton';
import {
  SEVERITY_COLOR,
  cameraPanelLine,
  composeRobotPanel,
  panelFactsFromTelemetry,
  pickWhyLine,
  whyFromTelemetry,
  type ServerWhy,
} from './vrWhy';
import { useVrCameraStatus } from './vrCameraStatus';
import { vrModeAllowLabel, vrModePromptLine, type VrModePrompt } from './vrModeRequest';
import { useReadinessStore } from '../../../store/readinessStore';
import { READINESS_STALE_MS } from '../../../hooks/useRobotReadiness';
import type { VrRigTelemetry } from './VrTeleopRig';
import { vrUiDebug } from './vrUiRegistry';

/** Panel size, metres: 0.5 x 0.32 overall, text above a row of buttons. */
export const ROBOT_PANEL_WIDTH_M = 0.5;
export const ROBOT_PANEL_HEIGHT_M = 0.32;
const TEXT_HEIGHT_M = 0.244;
/**
 * Distance from the head, and bearing right of the robot's forward. TASK-418:
 * 40°, not 30° — at 30° the panels' top inner corners covered the camera
 * screen's bottom corners, which is exactly where the grippers appear.
 */
const DISTANCE_M = 0.9;
export const SIDE_PANEL_BEARING_RAD = (40 * Math.PI) / 180;
const BEARING_RAD = SIDE_PANEL_BEARING_RAD;
/**
 * Height of the panel's centre in the robot's (centred) model frame. The G1's
 * eyes sit at about +0.43 (`EYE_BELOW_CROWN_M`) and the head-camera screen spans
 * +0.1..+0.7 a little further out; this keeps the panel mostly below the
 * screen's bottom-right corner, looked down at like a desk display.
 */
const CENTRE_Y_M = 0.08;
const EYE_Y_M = 0.43;

/**
 * Where a side panel sits and how it is turned, in the yaw group's frame, at
 * `bearingRad` RIGHT of the robot's forward (negative: left).
 *
 * The model's forward is three +X and its LEFT is -Z (`RobotModel` turns the
 * URDF's +Y-left into -Z), so a bearing to the right is towards +Z. The plane
 * faces back at the head: yawed to point its +Z normal at the origin, then
 * pitched up toward the eyes.
 */
export function sidePanelPlacement(bearingRad: number): { position: [number, number, number]; rotation: THREE.Euler } {
  const x = DISTANCE_M * Math.cos(bearingRad);
  const z = DISTANCE_M * Math.sin(bearingRad);
  const yaw = Math.atan2(-x, -z);
  const pitch = -Math.atan2(EYE_Y_M - CENTRE_Y_M, DISTANCE_M);
  return { position: [x, CENTRE_Y_M, z], rotation: new THREE.Euler(pitch, yaw, 0, 'YXZ') };
}

/** The robot panel: 40° to the right. The session board mirrors it on the left (TASK-413, D3). */
export function robotPanelPlacement(): { position: [number, number, number]; rotation: THREE.Euler } {
  return sidePanelPlacement(BEARING_RAD);
}

const BG = 'rgba(9,11,17,0.86)';
const BG_LATCHED = 'rgba(96,14,14,0.92)';

export interface VrRobotPanelProps {
  /** The robot whose camera status and server readiness the panel reads. */
  robotId: string;
  telemetryRef: { current: VrRigTelemetry };
  onRecenter: () => void;
  /** The modal's `resetEstop` — the same path as the desktop banner's button. */
  onResetEstop?: () => void | Promise<void>;
  /** Who else watches the session (TASK-414), read at the panel's rate; absent without a session. */
  watching?: () => string | null;
  /**
   * TASK-417: the desktop's request on show, or null. Changes only when a
   * request arrives or ends, so it may be a prop; the countdown is read per draw.
   */
  modeRequest?: VrModePrompt | null;
  /** TASK-417: the operator held "allow" — the modal sends the change under its lease. */
  onAllowModeRequest?: () => void;
}

/** The panel title: `ROBOT`, or `ROBOT · WATCHING Ben (desktop)` while someone watches. */
export function robotPanelTitle(watching: string | null | undefined): string {
  return watching ? `ROBOT · WATCHING ${watching}` : 'ROBOT';
}

/** How often the server's readiness reason is read into the panel. */
const READINESS_READ_MS = 1_000;

/**
 * The server's reason for this robot, or null when there is none or it is
 * stale. Read from the readiness store, which the launcher card's readiness
 * panel (`VRTeleopSection`) keeps fresh for as long as this modal is open.
 */
export function serverWhyOf(robotId: string, now: number): ServerWhy | null {
  const entry = useReadinessStore.getState().byRobot[robotId];
  if (!entry || now - entry.receivedAt > READINESS_STALE_MS) return null;
  const reason = entry.readiness.reason;
  return reason ? { code: reason.code, severity: reason.severity, text: reason.text, source: reason.source } : null;
}

export function VrRobotPanel({
  robotId, telemetryRef, onRecenter, onResetEstop, watching, modeRequest = null, onAllowModeRequest,
}: VrRobotPanelProps) {
  const placement = useMemo(robotPanelPlacement, []);
  const modeRequestRef = useRef<VrModePrompt | null>(modeRequest);
  modeRequestRef.current = modeRequest;

  // TASK-413: the server's reason, read once a second into a ref — never a
  // subscription, which would re-render inside the canvas.
  const serverWhy = useRef<ServerWhy | null>(null);
  useEffect(() => {
    const read = () => { serverWhy.current = serverWhyOf(robotId, Date.now()); };
    read();
    const timer = setInterval(read, READINESS_READ_MS);
    return () => clearInterval(timer);
  }, [robotId]);

  const compose = useCallback((): VrPanelContent => {
    const t = telemetryRef.current;
    const now = Date.now();
    const local = whyFromTelemetry(t, now);
    const picked = pickWhyLine(local, serverWhy.current);
    const lines = composeRobotPanel(panelFactsFromTelemetry(t), local, now);
    // TASK-417 (D3): the why line is FIRST; a desktop request goes right under
    // it, then the chips; the camera only when it is not live.
    lines[0] = { ...lines[0], text: picked.text, color: SEVERITY_COLOR[picked.severity] };
    const prompt = modeRequestRef.current;
    if (prompt && !t.estopLatched) lines.splice(1, 0, vrModePromptLine(prompt, now));
    const camera = cameraPanelLine(useVrCameraStatus.getState(), robotId);
    if (camera && !camera.text.startsWith('CAMERA live')) lines.push(camera);
    const title = t.estopLatched ? 'ROBOT — E-STOP LATCHED' : robotPanelTitle(watching?.());
    if (import.meta.env.DEV) {
      vrUiDebug.panel = lines.map((l) => l.text);
      vrUiDebug.panelTitle = title;
    }
    return t.estopLatched
      ? { title, titleColor: 'white', lines, background: BG_LATCHED, highlight: 'salmon' }
      : { title, lines, background: BG };
  }, [telemetryRef, robotId, watching]);

  const reset = useCallback(() => {
    if (onResetEstop) void Promise.resolve(onResetEstop()).catch(() => { /* the banner says why */ });
  }, [onResetEstop]);
  const latched = useCallback(() => telemetryRef.current.estopLatched, [telemetryRef]);
  // Never while latched: the prompt is withdrawn then, and Reset owns the slot.
  const asking = useCallback(
    () => modeRequestRef.current !== null && !telemetryRef.current.estopLatched,
    [telemetryRef],
  );
  const allow = useCallback(() => onAllowModeRequest?.(), [onAllowModeRequest]);

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
      {/* 1 mm in front of the panel plane, so a button is never z-fighting it.
          Next take moved to the session board (TASK-413, D3). */}
      <VrButton id="recenter" label="Recenter" position={[-0.16, buttonY, 0.001]} onClick={onRecenter} />
      <VrButton
        id="reset-estop"
        label="Hold 1 s to reset"
        holdLabel="Hold…"
        position={[0.16, buttonY, 0.001]}
        holdMs={1000}
        allowWhenEstopped
        tone="danger"
        disabled={!onResetEstop}
        isVisible={latched}
        onClick={reset}
      />
      {/* TASK-417: the desktop asked; a one-second hold allows it. Shares the
          Reset slot, which is empty whenever a request may show. */}
      <VrButton
        id="allow-mode"
        label={modeRequest ? vrModeAllowLabel(modeRequest.mode) : 'Hold to allow'}
        holdLabel="Hold…"
        position={[0.16, buttonY, 0.001]}
        holdMs={1000}
        disabled={!onAllowModeRequest || !modeRequest}
        isVisible={asking}
        onClick={allow}
      />
    </group>
  );
}
