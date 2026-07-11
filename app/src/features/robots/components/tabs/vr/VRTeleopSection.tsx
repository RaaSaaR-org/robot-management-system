/**
 * @file VRTeleopSection.tsx
 * @description Meta Quest (WebXR) teleoperation. The Teleop tab hosts only a
 *              compact launcher card; the full experience (3D preview, controller
 *              mapping, "Enter VR") lives in a full-screen modal so it stays out
 *              of the way until intentionally opened. Open this page in the Quest
 *              browser, launch the modal, press "Enter VR", and the controllers
 *              drive the robot's simulated arm joints in real time. Controller
 *              poses are retargeted to absolute joint angles (see `vrRetarget.ts`)
 *              and streamed to the robot agent over the same `/ws/keyboard-teleop`
 *              WebSocket using the batch `{positions}` message. Hold the grip
 *              (squeeze) on a controller to move that arm; release to freeze it.
 * @feature robots
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Center } from '@react-three/drei';
import { createXRStore, XR, useXRInputSourceState } from '@react-three/xr';
import * as THREE from 'three';
import { Card, Button, Modal } from '@/shared/components/ui';
import { brandColors } from '@/brand';
import { RobotModel } from '../../visualization/RobotModel';
import { normalizeRobotType, type JointState } from '../../../types/robots.types';
import type { TeleopTabProps } from '../types';
import {
  buildJointMap,
  retargetArm,
  type VrJoint,
  type VrJointMap,
} from './vrRetarget';

// ============================================================================
// HELPERS
// ============================================================================

function getAgentBaseUrl(robot: TeleopTabProps['robot']): string {
  if (robot.a2aAgentUrl) return robot.a2aAgentUrl.replace(/\/$/, '');
  return 'http://localhost:41245';
}

function getWsBaseUrl(robot: TeleopTabProps['robot']): string {
  return getAgentBaseUrl(robot).replace(/^http/, 'ws');
}

/** How often (seconds) controller poses are streamed to the agent (~20 Hz). */
const SEND_INTERVAL_S = 0.05;
/** Per-frame smoothing factor toward the target pose (0..1; higher = snappier). */
const SMOOTHING = 0.25;
/** Grip (squeeze) threshold above which an arm is "engaged". */
const GRIP_THRESHOLD = 0.5;
/**
 * WebXR device emulation. Off by default — when enabled the emulator overlays
 * large controller/ray gizmos, fake hands, and a device panel across the whole
 * page, which looks broken in a normal browser. In a dev build you can opt in
 * per-tab by adding `?xremu` to the URL to test the rig without a headset; a real
 * Meta Quest always uses native WebXR regardless of this setting.
 */
function resolveXrEmulator(): { type: 'metaQuest3'; syntheticEnvironment: false } | false {
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
const XR_EMULATOR = resolveXrEmulator();

/** True when the WebXR emulator is wired up (dev `?xremu` on localhost). */
const EMULATOR_ACTIVE =
  XR_EMULATOR !== false && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

// ============================================================================
// IN-XR RIG — reads controllers each frame and streams joint targets
// ============================================================================

interface VrTeleopRigProps {
  jointMap: VrJointMap;
  send: (payload: unknown) => void;
}

function VrTeleopRig({ jointMap, send }: VrTeleopRigProps) {
  const left = useXRInputSourceState('controller', 'left');
  const right = useXRInputSourceState('controller', 'right');

  // Smoothed targets we actually stream (joints persist/freeze when released).
  const targetsRef = useRef<Record<string, number>>({});
  const lastSentRef = useRef(0);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const euler = useMemo(() => new THREE.Euler(), []);

  // Read the controller orientation straight from the WebXR frame's grip space.
  // We deliberately do NOT use `ctrl.object` (the default controller model): that
  // object only exists when the controller model is rendered, and it relies on a
  // remote asset fetch. The grip-space pose is native to WebXR, always available
  // in-session, and lets us keep the headset view clean (no controller gizmos).
  useFrame((state, _delta, frame) => {
    const referenceSpace = state.gl.xr.getReferenceSpace?.();

    const compute = (
      ctrl: ReturnType<typeof useXRInputSourceState<'controller'>>,
      side: 'left' | 'right',
    ): Record<string, number> | null => {
      if (!ctrl) return null;
      const squeeze = ctrl.gamepad['xr-standard-squeeze'];
      if (!squeeze || (squeeze.button ?? 0) < GRIP_THRESHOLD) return null; // clutch

      const gripSpace = ctrl.inputSource?.gripSpace;
      if (!frame || !referenceSpace || !gripSpace) return null;
      const pose = frame.getPose(gripSpace, referenceSpace);
      if (!pose) return null;

      const o = pose.transform.orientation;
      quat.set(o.x, o.y, o.z, o.w);
      euler.setFromQuaternion(quat, 'YXZ');
      const trigger = ctrl.gamepad['xr-standard-trigger']?.button ?? 0;
      const stick = ctrl.gamepad['xr-standard-thumbstick'];

      return retargetArm(
        side,
        jointMap,
        { pitch: euler.x, yaw: euler.y, roll: euler.z },
        { x: stick?.xAxis ?? 0, y: stick?.yAxis ?? 0 },
        trigger,
      );
    };

    const want = {
      ...compute(left, 'left'),
      ...compute(right, 'right'),
    };
    if (Object.keys(want).length === 0) return; // neither arm engaged — hold pose

    const cur = targetsRef.current;
    for (const [joint, value] of Object.entries(want)) {
      cur[joint] = cur[joint] === undefined ? value : cur[joint] + (value - cur[joint]) * SMOOTHING;
    }

    const t = state.clock.elapsedTime;
    if (t - lastSentRef.current >= SEND_INTERVAL_S) {
      lastSentRef.current = t;
      send({ positions: cur });
    }
  });

  return null;
}

// ============================================================================
// MODAL — full VR teleop experience (connection, preview, Enter VR)
// ============================================================================

const CONTROLS_HELP: Array<{ keys: string; label: string }> = [
  { keys: 'Grip', label: 'Hold to move that arm' },
  { keys: 'Tilt', label: 'Shoulder pitch / yaw' },
  { keys: 'Twist', label: 'Wrist roll' },
  { keys: 'Stick', label: 'Elbow + shoulder roll' },
  { keys: 'Trigger', label: 'Wrist curl' },
];

interface VRTeleopModalProps {
  robot: TeleopTabProps['robot'];
  vrSupported: boolean | null;
  onClose: () => void;
}

/**
 * The modal body is mounted only while the modal is open, so the WebSocket and
 * the (heavy) XR canvas connect on open and tear down on close.
 */
function VRTeleopModalBody({ robot, vrSupported, onClose }: VRTeleopModalProps) {
  const [connected, setConnected] = useState(false);
  const [robotType, setRobotType] = useState('');
  const [joints, setJoints] = useState<VrJoint[]>([]);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [inVr, setInVr] = useState(false);
  const [copied, setCopied] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  // offerSession:false — we drive entry from our own "Enter VR" button instead of
  // the library's auto-injected DOM overlay button. emulate is off by default so a
  // normal browser stays clean (see XR_EMULATOR). We also disable the default
  // controller/hand visuals (3D models, interaction rays, grab/teleport pointers):
  // teleop reads controller input directly, so the rays/gizmos only add clutter to
  // the headset view. Input tracking is unaffected.
  const xrStore = useMemo(
    () =>
      createXRStore({
        offerSession: false,
        emulate: XR_EMULATOR,
        controller: { model: false, rayPointer: false, grabPointer: false, teleportPointer: false },
        hand: { model: false, rayPointer: false, grabPointer: false, touchPointer: false, teleportPointer: false },
      }),
    [],
  );
  const jointMap = useMemo<VrJointMap>(() => buildJointMap(joints), [joints]);

  const canEnterVr = connected && (vrSupported === true || EMULATOR_ACTIVE);

  const connect = useCallback(() => {
    const ws = new WebSocket(`${getWsBaseUrl(robot)}/ws/keyboard-teleop`);
    wsRef.current = ws;
    // Guard every handler on `wsRef.current === ws`: under React StrictMode the
    // effect mounts twice, so a previous (closing) socket's async `onclose` can
    // otherwise fire *after* the live socket is assigned and null out the ref —
    // leaving the UI "connected" while every send() silently no-ops.
    ws.onopen = () => { if (wsRef.current === ws) setConnected(true); };
    ws.onclose = () => { if (wsRef.current === ws) { setConnected(false); wsRef.current = null; } };
    ws.onerror = () => { if (wsRef.current === ws) { setConnected(false); wsRef.current = null; } };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'config') {
          setRobotType(msg.robotType ?? '');
          setJoints(msg.joints ?? []);
          setPositions(msg.positions ?? {});
        } else if (msg.type === 'state' && msg.positions) {
          setPositions(msg.positions);
        }
      } catch { /* ignore parse errors */ }
    };
  }, [robot]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const send = useCallback((payload: unknown) => {
    wsRef.current?.send(JSON.stringify(payload));
  }, []);

  const copyUrl = useCallback(() => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => { /* clipboard unavailable */ });
  }, []);

  // Connect on open; tear down on close (this body unmounts when the modal closes).
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Track XR session enter/exit to update the badge.
  useEffect(() => xrStore.subscribe((s) => setInVr(s.session != null)), [xrStore]);

  // End any active XR session when the modal closes (this body unmounts). Without
  // this, the canvas tears down while the session's frame loop is still running,
  // which makes the dev WebXR emulator throw on every subsequent device frame.
  useEffect(() => {
    return () => {
      void xrStore.getState().session?.end().catch(() => { /* already ending */ });
    };
  }, [xrStore]);

  // Feed the streamed teleop pose (radians) into the 3D model.
  const jointStates = useMemo<JointState[]>(
    () => Object.entries(positions).map(([name, position]) => ({ name, position })),
    [positions],
  );

  // The WS `config` message carries the authoritative robot type; before connect
  // we preview the robot's own embodiment (falling back to the G1).
  const modelType = normalizeRobotType(
    robotType || (robot.metadata?.robotType as string | undefined) || 'g1',
  );
  const cameraPos: [number, number, number] = modelType === 'so101' ? [0.5, 0.4, 0.5] : [1.5, 1.0, 1.5];

  return (
    <div className="space-y-4">
      {/* Status + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
          <span className="text-xs text-theme-secondary">
            {connected
              ? `${(robotType || 'g1').toUpperCase()} · ${joints.length} DOF · ${inVr ? 'in VR' : 'simulation'}`
              : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <Button variant="ghost" size="sm" onClick={() => send({ preset: 'home' })}>Home</Button>
          )}
          <Button variant="primary" size="sm" disabled={!canEnterVr} onClick={() => xrStore.enterVR()}>
            Enter VR
          </Button>
        </div>
      </div>

      {/* Headset-required call-to-action (no native WebXR and emulator off). */}
      {vrSupported === false && !EMULATOR_ACTIVE && (
        <div className="rounded-lg border border-theme-subtle bg-theme-secondary p-3 space-y-2">
          <p className="text-xs text-theme-secondary leading-relaxed">
            <span className="font-medium text-theme-primary">Headset required.</span> Put on your
            Meta Quest, open this page in the headset’s browser, then press{' '}
            <span className="font-medium text-theme-primary">Enter VR</span>. The live preview below
            mirrors the robot pose in the meantime.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-black/20 px-2 py-1 font-mono text-[11px] text-theme-secondary">
              {window.location.href}
            </code>
            <Button variant="ghost" size="sm" onClick={copyUrl}>
              {copied ? 'Copied' : 'Copy URL'}
            </Button>
          </div>
        </div>
      )}
      {EMULATOR_ACTIVE && (
        <p className="text-[11px] text-theme-tertiary">
          Dev mode: the WebXR emulator simulates a Meta Quest in this tab — “Enter VR” works without
          a headset.
        </p>
      )}

      {/* 3D preview */}
      <div className="w-full h-[55vh] min-h-80 rounded-lg overflow-hidden">
        <Canvas
          camera={{ position: cameraPos, fov: 50 }}
          gl={{ antialias: true }}
          style={{ background: 'linear-gradient(180deg, var(--bg-secondary, #1E1F24) 0%, var(--bg-tertiary, #0C1440) 100%)' }}
        >
          <XR store={xrStore}>
            <ambientLight intensity={0.7} color="#ffffff" />
            <directionalLight position={[5, 10, 5]} intensity={2.0} color="#ffffff" />
            <directionalLight position={[-3, 5, -3]} intensity={1.2} color="#ffffff" />
            <pointLight position={[-3, 2, -3]} intensity={1.0} color={brandColors().accent} distance={10} />

            <Center>
              <RobotModel robotType={modelType} jointStates={jointStates} isAnimating={false} />
            </Center>

            <Grid
              args={[10, 10]}
              cellSize={0.5}
              cellColor={brandColors().primary}
              sectionSize={2}
              sectionColor={brandColors().accent}
              fadeDistance={12}
              position={[0, modelType === 'so101' ? -0.05 : -0.75, 0]}
            />

            <OrbitControls enablePan enableZoom enableRotate maxPolarAngle={Math.PI / 2} minDistance={0.5} maxDistance={10} />

            {connected && <VrTeleopRig jointMap={jointMap} send={send} />}
          </XR>
        </Canvas>
      </div>

      {/* Controller mapping */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-theme-tertiary">
          Controller mapping
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {CONTROLS_HELP.map(({ keys, label }) => (
            <div
              key={keys}
              className="flex items-center gap-2.5 rounded-lg border border-theme-subtle bg-theme-secondary px-3 py-2"
            >
              <span className="shrink-0 rounded-md bg-cobalt-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-cobalt-600 dark:text-cobalt-400">
                {keys}
              </span>
              <span className="text-xs text-theme-secondary">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

// ============================================================================
// LAUNCHER — compact card shown in the Teleop tab
// ============================================================================

/** Small headset glyph for the launcher card. */
function HeadsetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3a2 2 0 0 1-2 2h-1.6a2 2 0 0 1-1.6-.8l-.9-1.2a1.5 1.5 0 0 0-1.2-.6h-3.4a1.5 1.5 0 0 0-1.2.6l-.9 1.2a2 2 0 0 1-1.6.8H5a2 2 0 0 1-2-2v-3Z" />
    </svg>
  );
}

export function VRTeleopSection({ robot }: { robot: TeleopTabProps['robot'] }) {
  const [open, setOpen] = useState(false);
  const [vrSupported, setVrSupported] = useState<boolean | null>(null);

  // Detect immersive-VR support (true on the Meta Quest browser) for the hint.
  useEffect(() => {
    let cancelled = false;
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr?.isSessionSupported) {
      setVrSupported(false);
      return;
    }
    xr.isSessionSupported('immersive-vr')
      .then((ok) => { if (!cancelled) setVrSupported(ok); })
      .catch(() => { if (!cancelled) setVrSupported(false); });
    return () => { cancelled = true; };
  }, []);

  const ready = vrSupported === true || EMULATOR_ACTIVE;
  const hint = ready
    ? EMULATOR_ACTIVE
      ? 'Dev emulator available — launch to test without a headset.'
      : 'Headset detected — launch to enter VR.'
    : 'Open this page in a Meta Quest browser to enter VR. Launch to preview the robot.';

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-400">
            <HeadsetIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-theme-primary">VR Teleop</h3>
              <span className="rounded-full bg-theme-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-theme-tertiary">
                Meta Quest
              </span>
            </div>
            <p className="mt-0.5 text-xs text-theme-secondary">{hint}</p>
          </div>
          <Button variant="primary" size="sm" onClick={() => setOpen(true)} className="shrink-0">
            Launch VR
          </Button>
        </div>
      </Card>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="VR Teleop (Meta Quest)" size="full">
        <VRTeleopModalBody robot={robot} vrSupported={vrSupported} onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}
