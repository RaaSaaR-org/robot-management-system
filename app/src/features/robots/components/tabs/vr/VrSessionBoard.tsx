/**
 * @file VrSessionBoard.tsx
 * @description The session board in the headset (TASK-413): the take, its
 *              timer and frame rate, kept / discarded, and the quick check
 *              after each stop — plus Start / Stop (one slot), Next and a
 *              hold-to-confirm Discard last. World-locked 30° LEFT of the
 *              robot's forward, mirroring the robot panel on the right (D3),
 *              inside the yaw group so it follows a recenter. Reads the session
 *              through `VrSessionBridge.getState()` from its frame loop, never
 *              through props (D2).
 * @feature robots
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { VrPanel, type VrPanelContent } from './VrPanel';
import { VrButton, VR_BUTTON_HEIGHT_M } from './VrButton';
import { sidePanelPlacement } from './VrRobotPanel';
import { vrUiDebug } from './vrUiRegistry';
import type { VrRigTelemetry } from './VrTeleopRig';
import {
  boardButtons,
  composeSessionBoard,
  type VrQuickCheckView,
  type VrSessionBridge,
  type VrSessionView,
} from './vrSessionBridge';

/** Board size, metres: 0.5 x 0.34 overall, text above a row of buttons. */
export const SESSION_BOARD_WIDTH_M = 0.5;
export const SESSION_BOARD_HEIGHT_M = 0.34;
const TEXT_HEIGHT_M = 0.264;
/** 30° LEFT of the robot's forward: the robot panel's bearing, mirrored. */
const BEARING_RAD = (-30 * Math.PI) / 180;

const BG = 'rgba(9,11,17,0.86)';
const BG_LATCHED = 'rgba(60,20,20,0.9)';

export interface VrSessionBoardProps {
  vrSession: VrSessionBridge;
  telemetryRef: { current: VrRigTelemetry };
}

const sameQuickCheck = (a: VrQuickCheckView | null, b: VrQuickCheckView | null): boolean =>
  a === b || (!!a && !!b && a.takeNumber === b.takeNumber && a.frames === b.frames && a.durationS === b.durationS);

export function VrSessionBoard({ vrSession, telemetryRef }: VrSessionBoardProps) {
  const placement = useMemo(() => sidePanelPlacement(BEARING_RAD), []);
  /** The view as last read — every button reads it rather than calling the getter again. */
  const viewRef = useRef<VrSessionView>(vrSession.getState());
  /**
   * The quick check on the board, and when it first arrived (it shows for 6 s).
   * One already there when the board mounts is old news: `since` null, never shown.
   */
  const quickCheck = useRef<{ check: VrQuickCheckView | null; since: number | null }>({
    check: viewRef.current.lastQuickCheck,
    since: null,
  });

  const read = useCallback((): VrSessionView => {
    const view = vrSession.getState();
    viewRef.current = view;
    return view;
  }, [vrSession]);

  const compose = useCallback((): VrPanelContent => {
    const view = read();
    const now = Date.now();
    const qc = quickCheck.current;
    if (!sameQuickCheck(qc.check, view.lastQuickCheck)) {
      quickCheck.current = { check: view.lastQuickCheck, since: view.lastQuickCheck ? now : null };
    }
    const lines = composeSessionBoard(view, now, quickCheck.current.since);
    if (import.meta.env.DEV) vrUiDebug.board = lines.map((l) => l.text);
    const latched = telemetryRef.current.estopLatched;
    return latched
      ? { title: 'SESSION — locked while the E-stop is latched', titleColor: 'salmon', lines, background: BG_LATCHED }
      : { title: 'SESSION', lines, background: BG };
  }, [read, telemetryRef]);

  useEffect(() => () => {
    if (import.meta.env.DEV) vrUiDebug.board = [];
  }, []);

  const buttons = useCallback(() => boardButtons(viewRef.current), []);
  const disabled = useCallback(() => !buttons().enabled, [buttons]);
  const act = useCallback((action: keyof VrSessionBridge['actions']) => () => {
    void vrSession.actions[action]().catch(() => { /* the store says why */ });
  }, [vrSession]);

  const buttonY = -SESSION_BOARD_HEIGHT_M / 2 + VR_BUTTON_HEIGHT_M / 2 + 0.005;
  const textY = SESSION_BOARD_HEIGHT_M / 2 - TEXT_HEIGHT_M / 2;

  return (
    <group position={placement.position} rotation={placement.rotation} name="vr-session-board">
      <VrPanel
        width={SESSION_BOARD_WIDTH_M}
        height={TEXT_HEIGHT_M}
        pxWidth={1024}
        pxHeight={540}
        linePx={60}
        position={[0, textY, 0]}
        compose={compose}
      />
      {/* Start and Stop share one slot (D3): exactly one is visible, and a
          hidden button is never hit by the ray. 1 mm in front of the plane. */}
      <VrButton
        id="session-start"
        label="Start"
        position={[-0.16, buttonY, 0.001]}
        isVisible={() => buttons().start}
        isDisabled={disabled}
        onClick={act('start')}
      />
      <VrButton
        id="session-stop"
        label="Stop"
        position={[-0.16, buttonY, 0.001]}
        tone="danger"
        isVisible={() => buttons().stop}
        isDisabled={disabled}
        onClick={act('stop')}
      />
      <VrButton
        id="session-next"
        label="Next"
        position={[0, buttonY, 0.001]}
        isVisible={() => buttons().next}
        isDisabled={disabled}
        onClick={act('next')}
      />
      <VrButton
        id="session-discard"
        label="Discard last"
        holdLabel="Hold…"
        position={[0.16, buttonY, 0.001]}
        holdMs={1000}
        isVisible={() => buttons().discard}
        isDisabled={disabled}
        onClick={act('discardLast')}
      />
    </group>
  );
}
