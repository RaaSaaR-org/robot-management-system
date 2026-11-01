/**
 * @file useOperatorPublisher.ts
 * @description The headset tells the desktop assistant what its operator sees
 *              and does (TASK-414, D1): while a session is attached and the
 *              wearer is in VR, it watches the session as `operator` on the app
 *              socket and relays a small `OperatorState` at 5 Hz — link, grip,
 *              the why line, the head and the commanded wrist targets. Read
 *              from the rig's telemetry ref on a timer, never through React
 *              state, so the canvas does not re-render for it. Display only:
 *              the server fans it out and forwards nothing to the robot.
 *
 *              TASK-417: the same operator socket receives the assistant's
 *              mode requests (`onModeRequest`) and sends the headset's answer
 *              (`answerModeRequest`). The change itself goes through the
 *              base-mode route under this headset's lease — never this socket.
 * @feature robots
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  openSessionWatch,
  type ModeRequestIn,
  type ModeRequestOutcome,
  type OperatorPose,
  type OperatorState,
  type SessionWatch,
} from '@/shared/utils/sessionWatch';
import type { VrRigTelemetry } from './VrTeleopRig';
import type { RobotWristPose } from './vrWrist';
import { ARM_REFUSAL_FRESH_MS, pickWhyLine, whyFromTelemetry, type ServerWhy } from './vrWhy';
import { serverWhyOf } from './VrRobotPanel';

/** 5 Hz — the server's relay rate; faster would only be dropped there. */
export const OPERATOR_PUBLISH_MS = 200;

const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** A rig pose as the wire wants it: rounded, without the grip, null when not finite. */
export function wirePose(pose: RobotWristPose | null | undefined): OperatorPose | null {
  if (!pose) return null;
  const all = [...pose.p, ...pose.q];
  if (!all.every(Number.isFinite)) return null;
  return {
    p: [round(pose.p[0], 3), round(pose.p[1], 3), round(pose.p[2], 3)],
    q: [round(pose.q[0], 4), round(pose.q[1], 4), round(pose.q[2], 4), round(pose.q[3], 4)],
  };
}

/**
 * The operator's state from the rig telemetry at `now` (ms, `Date.now()`), with
 * the same why line the robot panel shows — the server's reason when it wins.
 */
export function buildOperatorState(
  t: VrRigTelemetry,
  now: number,
  server: ServerWhy | null,
  inVr: boolean,
): OperatorState {
  const local = whyFromTelemetry(t, now);
  const picked = pickWhyLine(local, server);
  const held = t.armHeld && now - t.armHeld.at <= ARM_REFUSAL_FRESH_MS ? t.armHeld : null;
  return {
    inVr,
    link: t.link,
    rttMs: t.rttMs !== null && Number.isFinite(t.rttMs) ? Math.max(0, Math.round(t.rttMs)) : null,
    clutch: { left: t.clutch.left, right: t.clutch.right },
    grip: { left: round(clamp01(t.left.squeeze), 2), right: round(clamp01(t.right.squeeze), 2) },
    held: held ? { side: held.side, reason: held.reason } : null,
    why: {
      code: picked.from === 'server' && server ? server.code.slice(0, 40) : local.code,
      severity: picked.severity,
      text: picked.text.slice(0, 160),
    },
    head: wirePose(t.head),
    targets: { left: wirePose(t.targets.left), right: wirePose(t.targets.right) },
  };
}

export interface OperatorPublisherOptions {
  /** The attached session; nothing is published without one (the robot page). */
  sessionId: string | null | undefined;
  robotId: string;
  /** The wearer is in an immersive session — the publisher runs only then. */
  inVr: boolean;
  telemetryRef: { current: VrRigTelemetry };
  displayName?: string;
  /** TASK-417: the desktop assistant asks for Stand up or Balance. */
  onModeRequest?: (request: ModeRequestIn) => void;
}

export interface OperatorPublisherReturn {
  /** TASK-417: answer a mode request on the operator socket; false when there is none. */
  answerModeRequest(requestId: string, outcome: ModeRequestOutcome, error?: string): boolean;
}

/**
 * Watch the session as its operator while in VR, and relay the operator's
 * state at 5 Hz. The socket opens with the session (the modal) and only the
 * role follows `inVr`, so entering VR shows on the desktop without waiting
 * for a connect.
 */
export function useOperatorPublisher({
  sessionId, robotId, inVr, telemetryRef, displayName, onModeRequest,
}: OperatorPublisherOptions): OperatorPublisherReturn {
  const watchRef = useRef<SessionWatch | null>(null);
  const inVrRef = useRef(inVr);
  inVrRef.current = inVr;
  const onModeRequestRef = useRef(onModeRequest);
  onModeRequestRef.current = onModeRequest;

  useEffect(() => {
    if (!sessionId || import.meta.env.VITE_DEMO_MODE === 'true') return undefined;
    const publish = () => {
      if (!inVrRef.current) return;
      const now = Date.now();
      watch.sendOperator(buildOperatorState(telemetryRef.current, now, serverWhyOf(robotId, now), true));
    };
    const watch = openSessionWatch({
      sessionId,
      role: inVrRef.current ? 'operator' : null,
      displayName,
      // The first state goes out with the acknowledgement, not a tick later.
      onWatched: publish,
      onModeRequest: (request) => onModeRequestRef.current?.(request),
    });
    watchRef.current = watch;
    const timer = setInterval(publish, OPERATOR_PUBLISH_MS);
    return () => {
      clearInterval(timer);
      watch.close();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [sessionId, robotId, telemetryRef, displayName]);

  useEffect(() => {
    watchRef.current?.setRole(inVr ? 'operator' : null);
  }, [inVr]);

  const answerModeRequest = useCallback(
    (requestId: string, outcome: ModeRequestOutcome, error?: string): boolean =>
      watchRef.current?.answerModeRequest(requestId, outcome, error) ?? false,
    [],
  );
  return { answerModeRequest };
}
