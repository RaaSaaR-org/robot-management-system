/**
 * @file VRTeleopModal.tsx
 * @description The operator console for VR teleop: the reconnecting teleop link,
 *              the E-Stop and its reset path, the link/RTT/stream readouts, the
 *              3D scene, what the controllers do, and how to reach this page from
 *              inside a headset.
 * @feature robots
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createXRStore } from '@react-three/xr';
import * as THREE from 'three';
import { Badge, Button } from '@/shared/components/ui';
import { brandColors } from '@/brand';
import { safetyApi } from '@/features/safety/api/safetyApi';
import { normalizeRobotType, type JointState } from '../../../types/robots.types';
import type { TeleopTabProps } from '../types';
import { buildJointMap, endEffectorMode, type EndEffectorMode, type VrJoint, type VrJointMap } from './vrRetarget';
import { headsetTargets, type HeadsetTarget, type XrAvailability } from './vrAvailability';
import {
  createTeleopLink,
  estopSequence,
  linkState,
  shouldStream,
  ESTOP_REASON,
  LINK_STALE_AFTER_MS,
  type LinkState,
  type LinkStatus,
  type TeleopLink,
} from './vrSession';
import { createLoopHealth, onPositionsSent, onStateReceived, type LoopHealth } from './vrHud';
import { EMULATOR_ACTIVE, XR_EMULATOR } from './vrConstants';
import { getWsBaseUrl } from './vrUrls';
import { VrScene } from './VrScene';
import { createRigTelemetry } from './VrTeleopRig';

/** How often the status row re-reads the link meters, in ms. */
const METER_INTERVAL_MS = 250;

/** `{type:'error'}` as the agent sends it. `code` is sticky for the session. */
interface AgentError {
  code: string;
  message: string;
  at: string;
}

/** `{type:'control'}` — who owns the robot, and who was pushed off it. */
interface ControlFrame {
  owner: string;
  preempted: string | null;
}

/**
 * What the LINK readout should say.
 *
 * `linkState` measures the age of the agent's last `{type:'state'}` echo, and the
 * agent only produces one in answer to a frame we sent. With no arm engaged the
 * rig streams nothing, so a perfectly healthy idle link ages out and would be
 * reported as LOST — the module's own docstring warns about exactly this. While
 * idle the socket being open is the only evidence there is, and it is the right
 * evidence: nothing is being commanded, so there is no control loop to be behind.
 */
function meterLink(
  status: LinkStatus,
  now: number,
  lastStateAt: number | null,
  lastSendAt: number | null,
): LinkState {
  if (status !== 'open') return 'lost';
  if (lastSendAt === null || now - lastSendAt > LINK_STALE_AFTER_MS) return 'live';
  return linkState(now, lastStateAt);
}

/** Does this outbound frame carry a pose? Then it is an RTT probe. */
function isPositionsFrame(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'positions' in payload;
}

const LINK_TONE: Record<LinkState, string> = {
  live: 'bg-green-500',
  stale: 'bg-amber-500',
  lost: 'bg-red-500',
};

/** What the trigger actually does on THIS robot — see `endEffectorMode`. */
const TRIGGER_LABEL: Record<EndEffectorMode, string> = {
  hand: 'Close the hand (all fingers)',
  gripper: 'Close the gripper',
  wrist: 'Wrist curl',
  none: 'Nothing — this robot advertises no end effector',
};

interface ControlRow {
  id: string;
  keys: string;
  label: string;
}

interface ControlGroup {
  id: string;
  title: string;
  rows: ControlRow[];
}

/**
 * The controller mapping, grouped by MODE.
 *
 * It used to be eight undifferentiated rows, two of which were both labelled
 * "Stick" and contradicted each other — which is exactly what the mapping is:
 * the grip is a modal clutch, and the same stick means elbow or walking
 * depending on it. Saying so once, as a heading, is the whole content of the
 * card; listing both rows flat left the operator to infer the mode from a
 * parenthetical.
 */
function controlGroups(trigger: EndEffectorMode): ControlGroup[] {
  return [
    {
      id: 'arm',
      title: 'Arm — while the grip is held',
      rows: [
        { id: 'grip', keys: 'Grip', label: 'Hold to take that arm; release and it stops being commanded' },
        { id: 'tilt', keys: 'Tilt', label: 'Shoulder pitch and yaw, 1:1 with your hand' },
        { id: 'twist', keys: 'Twist', label: 'Wrist roll' },
        { id: 'stick-arm', keys: 'Stick', label: 'Elbow (up/down) and shoulder roll (left/right)' },
        { id: 'trigger', keys: 'Trigger', label: TRIGGER_LABEL[trigger] },
      ],
    },
    {
      id: 'drive',
      title: 'Drive — while the grip is free',
      rows: [
        { id: 'stick-drive', keys: 'Stick', label: 'Walk and strafe; either hand drives' },
        { id: 'turn', keys: 'Turn', label: 'Turn your body — the robot turns to follow you' },
        { id: 'no-snap', keys: 'Why', label: 'Turning is never on a stick: stick yaw is what makes people ill' },
      ],
    },
    {
      id: 'safety',
      title: 'Safety and view',
      rows: [
        { id: 'estop', keys: 'B / Y', label: 'E-STOP — either hand, either button' },
        { id: 'recenter', keys: 'A / X', label: 'Recenter the view inside the robot’s head' },
      ],
    },
  ];
}

export interface VRTeleopModalProps {
  robot: TeleopTabProps['robot'];
  /** Why WebXR is or is not usable on this origin — see `resolveXrAvailability`. */
  availability: XrAvailability;
  /** `isSessionSupported('immersive-vr')`; null while it is still pending. */
  sessionSupported: boolean | null;
  onClose: () => void;
}

/**
 * The modal body is mounted only while the modal is open, so the link and the
 * (heavy) XR canvas connect on open and tear down on close.
 */
export function VRTeleopModalBody({ robot, availability, sessionSupported, onClose }: VRTeleopModalProps) {
  const [status, setStatus] = useState<LinkStatus>('closed');
  const [robotType, setRobotType] = useState('');
  const [joints, setJoints] = useState<VrJoint[]>([]);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [inVr, setInVr] = useState(false);
  const [estopLatched, setEstopLatched] = useState(false);
  const [estopNote, setEstopNote] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [agentErrors, setAgentErrors] = useState<AgentError[]>([]);
  const [control, setControl] = useState<ControlFrame | null>(null);
  const [meters, setMeters] = useState<{ link: LinkState; msSinceState: number | null; rttMs: number | null }>({
    link: 'lost',
    msSinceState: null,
    rttMs: null,
  });
  const [copied, setCopied] = useState<string | null>(null);
  /** Bumped to put the viewpoint back in the robot's head. */
  const [recenterKey, setRecenterKey] = useState(0);
  const recenter = useCallback(() => setRecenterKey((n) => n + 1), []);
  /** Wraps the posed model so its bounding box can be measured for the viewpoint. */
  const modelRef = useRef<THREE.Group>(null);
  /** Turns the robot to face the wearer's heading on recenter — see `VrOrigin`. */
  const yawRef = useRef<THREE.Group>(null);
  /** The wearer's bearing and the robot's commanded bearing — see `VrTeleopRig`. */
  const headingRef = useRef(0);
  const robotHeadingRef = useRef(0);

  const linkRef = useRef<TeleopLink | null>(null);
  const healthRef = useRef<LoopHealth>(createLoopHealth());
  const lastStateAtRef = useRef<number | null>(null);
  const lastSendAtRef = useRef<number | null>(null);
  /** Read by the rig every frame; see `shouldStream`. */
  const canStreamRef = useRef(false);
  const telemetryRef = useRef(createRigTelemetry());
  const robotPositionsRef = useRef<Readonly<Record<string, number>>>({});

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
  /** Ask the left arm, then the right: a one-armed robot names its gripper on one side only. */
  const trigger = useMemo<EndEffectorMode>(() => {
    const left = endEffectorMode('left', jointMap);
    return left === 'none' ? endEffectorMode('right', jointMap) : left;
  }, [jointMap]);

  const canEnterVr = status === 'open' && (sessionSupported === true || EMULATOR_ACTIVE);

  const send = useCallback((payload: unknown): boolean => {
    const ok = linkRef.current?.send(payload) ?? false;
    if (!ok) return false;
    const now = Date.now();
    lastSendAtRef.current = now;
    // Only a pose frame is a round-trip probe: the agent answers those with a
    // `{type:'state'}` in the same handler, which is what makes the measurement
    // a real round trip and not an estimate.
    if (isPositionsFrame(payload)) healthRef.current = onPositionsSent(healthRef.current, now);
    return true;
  }, []);

  // Stable for the life of the link: it only touches setters and refs, and a new
  // identity here would tear the socket down and reconnect it.
  const handleMessage = useCallback((msg: unknown, at: number) => {
    if (typeof msg !== 'object' || msg === null) return;
    const frame = msg as Record<string, unknown>;
    switch (frame.type) {
      case 'config':
        setRobotType(typeof frame.robotType === 'string' ? frame.robotType : '');
        setJoints(Array.isArray(frame.joints) ? (frame.joints as VrJoint[]) : []);
        setPositions((frame.positions as Record<string, number>) ?? {});
        break;
      case 'state':
        if (frame.positions) setPositions(frame.positions as Record<string, number>);
        lastStateAtRef.current = at;
        healthRef.current = onStateReceived(healthRef.current, at);
        break;
      case 'control':
        setControl({
          owner: typeof frame.owner === 'string' ? frame.owner : 'teleop',
          preempted: typeof frame.preempted === 'string' ? frame.preempted : null,
        });
        break;
      case 'estop': {
        // The agent's own view of the latch — possibly because somebody else
        // stopped the robot. The console has to follow the robot, not the other
        // way round, so this frame is authoritative in BOTH directions.
        //
        // `active` is read rather than assumed: the agent now sends this frame
        // on connect and on both edges of the latch, not only in reply to an
        // `{estop}` this console asked for. Treating every one of them as
        // "latched" would have meant a console that could see a robot stop but
        // never see it recover — it would have needed a reconnect to believe
        // the reset it had just performed itself.
        const active = frame.active !== false;
        setEstopLatched(active);
        if (active) {
          canStreamRef.current = false;
          telemetryRef.current.estopLatched = true;
          setEstopNote(typeof frame.reason === 'string' ? frame.reason : ESTOP_REASON);
        } else {
          telemetryRef.current.estopLatched = false;
          setEstopNote(null);
          setAgentErrors((prev) => prev.filter((e) => e.code !== 'estop_latched'));
        }
        break;
      }
      case 'error': {
        const code = typeof frame.code === 'string' ? frame.code : 'unknown';
        const entry: AgentError = {
          code,
          message: typeof frame.message === 'string' ? frame.message : code,
          at: typeof frame.at === 'string' ? frame.at : new Date().toISOString(),
        };
        // `estop_latched` is not an amber note, it is the latch. The agent sends
        // `{type:'estop'}` only to the socket that ASKED for one, so an E-Stop
        // raised by anything else — the fleet console, the safety monitor, a
        // second teleop client — reached this console solely as this error code.
        // The latch flag therefore stayed false: `shouldStream` kept returning
        // true, the rig went on streaming poses at 20 Hz into an agent that was
        // discarding them, the desktop banner never rendered, and inside the
        // headset `composeHud` showed LINK LIVE / MODE ARM-LR while the arm had
        // silently stopped following the wearer's hand. `resetEstop` already
        // filters this code out of `agentErrors`, so the path was anticipated
        // and simply never wired to the flag.
        if (code === 'estop_latched') {
          canStreamRef.current = false;
          telemetryRef.current.estopLatched = true;
          setEstopLatched(true);
          setEstopNote(entry.message);
        }
        // Keyed by code, newest wins. The agent latches most codes for the life
        // of the socket, so a repeat normally means a reconnect — but it
        // deliberately re-arms `estop_latched` every time the latch clears, so
        // that one does recur. Either way, replacing beats accumulating: a flaky
        // link would otherwise build a wall of the same sentence.
        setAgentErrors((prev) => [...prev.filter((e) => e.code !== code), entry]);
        break;
      }
      default:
        break;
    }
  }, []);

  // Connect on open; tear down on close (this body unmounts when the modal closes).
  useEffect(() => {
    const link = createTeleopLink({
      url: `${getWsBaseUrl(robot)}/ws/keyboard-teleop`,
      onMessage: handleMessage,
      onStatus: setStatus,
    });
    linkRef.current = link;
    link.connect();
    return () => {
      link.dispose();
      linkRef.current = null;
    };
  }, [robot, handleMessage]);

  // The status row's numbers, on a timer rather than on message arrival: the
  // agent answers at 20 Hz and re-rendering this modal — canvas included — 20
  // times a second to move a millisecond readout is not a trade worth making.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const last = lastStateAtRef.current;
      setMeters({
        link: meterLink(status, now, last, lastSendAtRef.current),
        msSinceState: last === null ? null : now - last,
        rttMs: healthRef.current.rttMs,
      });
    }, METER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status]);

  // Mirror the React-side facts into the refs the render loop reads. Refs, not
  // props, because the rig reads them 72-120 times a second.
  useEffect(() => {
    canStreamRef.current = shouldStream({ estopLatched, status });
  }, [estopLatched, status]);
  // Forget any outstanding RTT probe the moment the link is not open.
  // `createTeleopLink` reconnects internally, so the modal's connect effect does
  // not re-run and `healthRef` — built once at mount — survived the outage. A
  // `{positions}` frame that was in flight when the socket died left
  // `pendingSentAt` pinned (`onPositionsSent` deliberately refuses to overwrite
  // one), so the first `{type:'state'}` after the reconnect was measured against
  // it: an 8 s outage reported an 8 s round trip, which at RTT_EMA_ALPHA = 0.2
  // dragged the smoothed reading to ~1.6 s and took ~13 samples to decay. The
  // HUD showed a red RTT for about a second on a link that had just recovered.
  useEffect(() => {
    if (status === 'open') return;
    healthRef.current = { ...healthRef.current, pendingSentAt: null };
  }, [status]);
  useEffect(() => {
    robotPositionsRef.current = positions;
  }, [positions]);
  useEffect(() => {
    const t = telemetryRef.current;
    t.estopLatched = estopLatched;
    t.link = meters.link;
    t.msSinceState = meters.msSinceState;
    t.rttMs = meters.rttMs;
  }, [estopLatched, meters]);

  /**
   * Raise the E-Stop. One implementation for both entry points — the B/Y buttons
   * inside the headset and the STOP button here — because a stop sequence that
   * exists twice is a stop sequence with two behaviours.
   */
  const raiseEstop = useCallback(async () => {
    // Set the gate BEFORE anything async. The rig reads this ref on its next
    // frame, which can happen before React has committed the state update below;
    // going through state alone would leave up to a frame of pose stream heading
    // for a robot that is being told to stop.
    canStreamRef.current = false;
    telemetryRef.current.estopLatched = true;
    setEstopLatched(true);
    setEstopNote(ESTOP_REASON);
    // `estopSequence` types its `send` as void-returning, so it can only report
    // 'failed' for a send that THREW — and `TeleopLink.send` never throws, it
    // returns false on a closed socket. Without capturing that boolean the note
    // would claim the stop frame went out over a socket that was not there.
    let socketOk = true;
    const result = await estopSequence(
      (payload) => { if (!send(payload)) socketOk = false; },
      () => safetyApi.triggerRobotEStop(robot.id, { reason: ESTOP_REASON, triggeredBy: 'vr-teleop' }),
    );
    const socket = result.socket === 'sent' && socketOk ? 'sent' : 'failed';
    setEstopNote(`${ESTOP_REASON} — socket ${socket}, fleet alert ${result.rest}.`);
  }, [robot.id, send]);

  /**
   * STOP also ENDS THE SESSION.
   *
   * A wearer whose robot has just stopped and whose scene keeps rendering
   * normally has no way to find out why: the desktop banner explaining it is on a
   * screen they cannot see. Taking the headset off is the only way to read it, so
   * the stop does that for them.
   *
   * BOTH ENTRY POINTS COME HERE — the desktop STOP button and B/Y in the
   * headset. B/Y used to call `raiseEstop` directly, skipping the session end,
   * which is the half that exists FOR the wearer: it left them inside a live
   * session while the wrist HUD told them to clear the stop from the fleet
   * console — an instruction they cannot follow, because `resetEstop` has no
   * controller binding, the Reset button lives only in the DOM banner, and the
   * agent's latch is one-way over the socket. The only way out was to take the
   * headset off, which is exactly the state this function was written to avoid.
   */
  const onStopButton = useCallback(() => {
    void raiseEstop();
    void xrStore.getState().session?.end().catch(() => { /* already ending */ });
  }, [raiseEstop, xrStore]);

  /**
   * Clear the latch.
   *
   * The agent's latch is deliberately ONE-WAY — nothing it receives on the teleop
   * socket clears it — so without a path that does not involve the headset, one
   * press of B leaves the robot stopped until somebody restarts the agent. The
   * server's reset forwards to the agent's own
   * `/api/v1/robots/:id/safety/estop/reset`, which is the endpoint that owns the
   * latch, so this clears the robot as well as this console.
   */
  const resetEstop = useCallback(async () => {
    setResetting(true);
    try {
      await safetyApi.resetRobotEStop(robot.id);
      setEstopLatched(false);
      setEstopNote(null);
      telemetryRef.current.estopLatched = false;
      setAgentErrors((prev) => prev.filter((e) => e.code !== 'estop_latched'));
    } catch (error) {
      setEstopNote(
        `Reset failed: ${error instanceof Error ? error.message : 'unknown error'} — the robot is still stopped.`,
      );
    } finally {
      setResetting(false);
    }
  }, [robot.id]);

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(id);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => { /* clipboard unavailable */ });
  }, []);

  // Track XR session enter/exit to update the badge, and put the viewpoint in
  // the robot's head the moment a session begins — the wearer should be looking
  // out of the robot from the first frame, not hunting for a button.
  //
  // The edge is detected against a REF, outside the state updater. It used to
  // live inside `setInVr((was) => …)`, calling `recenter()` and writing three
  // refs from there: React treats updaters as pure and double-invokes them under
  // StrictMode, so entering a session advanced `recenterKey` by two. Both
  // `VrTeleopRig`'s heading-reset effect and `VrOrigin`'s burst are keyed on that
  // number, which made the extra bump a real second recenter rather than a
  // harmless increment.
  const inVrRef = useRef(false);
  useEffect(
    () =>
      xrStore.subscribe((s) => {
        const active = s.session != null;
        const was = inVrRef.current;
        if (active === was) return;
        inVrRef.current = active;
        if (active) recenter();
        // Leaving VR puts the robot back the way it faces on the desktop
        // preview — the recenter turned it to wherever the wearer was facing,
        // which means nothing once the headset is off.
        if (!active) {
          if (yawRef.current) yawRef.current.rotation.y = 0;
          headingRef.current = 0;
          robotHeadingRef.current = 0;
        }
        setInVr(active);
      }),
    [xrStore, recenter],
  );

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

  const targets = useMemo(() => headsetTargets(window.location), []);
  // The key chips take the brand primary rather than a hard-coded cobalt class,
  // so a white-labelled deployment does not end up with one stray blue in an
  // otherwise re-themed dialog. `26` is 15% alpha on the same hex.
  const keyTint = useMemo(() => brandColors().primary, []);

  return (
    // Scrolls on its own. `Modal` caps size="full" at max-h-[calc(100vh-2rem)]
    // but sets no overflow, so anything past that height was simply cut off —
    // the mapping grid and the Close button below a 55vh canvas were unreachable
    // on a laptop. 9rem is the modal's own 2rem inset plus its header (~3.5rem)
    // and this body's 2rem of vertical padding, with a little to spare.
    <div className="max-h-[calc(100vh-9rem)] overflow-y-auto space-y-4">
      {/* Status + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${LINK_TONE[meters.link]}`} />
            <span className="text-xs font-medium text-theme-primary">
              {status === 'open' ? `LINK ${meters.link.toUpperCase()}` : `SOCKET ${status.toUpperCase()}`}
            </span>
          </span>
          <span className="text-xs text-theme-secondary">
            {status === 'open'
              ? `${(robotType || 'g1').toUpperCase()} · ${joints.length} DOF · ${inVr ? 'in VR' : 'simulation'}`
              : 'Reconnecting…'}
          </span>
          <span className="text-xs text-theme-tertiary" data-testid="vr-rtt">
            RTT {meters.rttMs === null ? '--' : `${Math.round(meters.rttMs)}ms`}
          </span>
          <span className="text-xs text-theme-tertiary" data-testid="vr-stream">
            {estopLatched ? 'Stream held (E-Stop)' : shouldStream({ estopLatched, status }) ? 'Stream armed' : 'Stream idle'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={status !== 'open' || inVr}
            title={inVr ? 'Disabled in VR: Home snaps every joint at once, under the wearer’s hands' : undefined}
            onClick={() => send({ preset: 'home' })}
          >
            Home
          </Button>
          {inVr && (
            <Button variant="ghost" size="sm" onClick={recenter}>Recenter</Button>
          )}
          <Button variant="primary" size="sm" disabled={!canEnterVr} onClick={() => xrStore.enterVR()}>
            Enter VR
          </Button>
          {/* `destructive`, and always enabled: a stop the operator has to first
              get a link for is not a stop. `estopSequence` writes to the socket
              if there is one and raises the fleet alert over REST either way. */}
          <Button variant="destructive" size="sm" onClick={onStopButton}>STOP</Button>
        </div>
      </div>

      {/* E-Stop banner. Latched is a state the operator has to be able to leave
          without putting the headset back on — see `resetEstop`. */}
      {estopLatched && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3" role="alert">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">E-STOP LATCHED</p>
              <p className="mt-0.5 text-xs text-theme-secondary">{estopNote ?? ESTOP_REASON}</p>
            </div>
            <Button variant="outline" size="sm" disabled={resetting} onClick={() => void resetEstop()}>
              {resetting ? 'Resetting…' : 'Reset E-Stop'}
            </Button>
          </div>
        </div>
      )}

      {/* Whatever the agent refused, in its own words. `code` is sticky for the
          session, so this is a list of what has gone wrong, not a log. */}
      {agentErrors.length > 0 && (
        <ul className="space-y-1" data-testid="vr-agent-errors">
          {agentErrors.map((e) => (
            <li
              key={e.code}
              title={e.at}
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
            >
              <Badge variant="warning" size="sm">{e.code}</Badge>
              <span className="text-xs text-theme-secondary">{e.message}</span>
            </li>
          ))}
        </ul>
      )}

      {control?.preempted && (
        <p className="text-[11px] text-theme-tertiary">
          Teleop took control from <span className="font-medium text-theme-secondary">{control.preempted}</span>.
        </p>
      )}

      <XrAvailabilityBlock
        availability={availability}
        sessionSupported={sessionSupported}
        targets={targets}
        copied={copied}
        onCopy={copy}
      />

      {/* 3D preview */}
      <div className="h-[55vh] min-h-80 w-full overflow-hidden rounded-lg">
        <VrScene
          store={xrStore}
          robotId={robot.id}
          modelType={modelType}
          jointStates={jointStates}
          modelRef={modelRef}
          yawRef={yawRef}
          headingRef={headingRef}
          robotHeadingRef={robotHeadingRef}
          robotPositionsRef={robotPositionsRef}
          canStreamRef={canStreamRef}
          telemetryRef={telemetryRef}
          recenterKey={recenterKey}
          inVr={inVr}
          jointMap={jointMap}
          send={send}
          onRecenter={recenter}
          onEstop={onStopButton}
        />
      </div>

      {/* Controller mapping */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {controlGroups(trigger).map((group) => (
          <div key={group.id} className="rounded-lg border border-theme-subtle bg-theme-secondary p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-theme-tertiary">
              {group.title}
            </p>
            <ul className="space-y-1.5">
              {group.rows.map((row) => (
                <li key={row.id} className="flex items-start gap-2.5">
                  <span
                    className="mt-px shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold"
                    style={{ backgroundColor: `${keyTint}26`, color: keyTint }}
                  >
                    {row.keys}
                  </span>
                  <span className="text-xs leading-relaxed text-theme-secondary">{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

/**
 * The three ways WebXR can be unavailable, told apart.
 *
 * The old card collapsed them into one "Headset required" message that told the
 * operator to open the page in a headset — useless advice on an insecure origin,
 * because the headset fails there in exactly the same way and for a reason the
 * operator cannot see. That is also the case they actually hit: a LAN dev server
 * on plain http hides `navigator.xr` from the Quest browser too.
 */
function XrAvailabilityBlock({
  availability,
  sessionSupported,
  targets,
  copied,
  onCopy,
}: {
  availability: XrAvailability;
  sessionSupported: boolean | null;
  targets: HeadsetTarget[];
  copied: string | null;
  onCopy: (id: string, text: string) => void;
}) {
  if (EMULATOR_ACTIVE) {
    return (
      <p className="text-[11px] text-theme-tertiary">
        Dev mode: the WebXR emulator simulates a Meta Quest in this tab — “Enter VR” works without a headset.
      </p>
    );
  }

  if (availability === 'ready') {
    if (sessionSupported === false) {
      return (
        <p className="text-xs text-theme-secondary">
          <span className="font-medium text-theme-primary">WebXR is available, but no VR device is connected.</span>{' '}
          The preview below mirrors the robot pose; connect a headset to this browser to enter VR.
        </p>
      );
    }
    return (
      <p className="text-xs text-theme-secondary">
        {sessionSupported === null
          ? 'Checking for an immersive-VR device…'
          : 'Headset detected — press Enter VR.'}
      </p>
    );
  }

  const headline =
    availability === 'insecure-origin'
      ? 'This page is not on a secure origin, so no browser will expose WebXR here — including the headset’s.'
      : 'This browser has no WebXR. Open the page inside the headset instead.';

  return (
    <div className="space-y-2 rounded-lg border border-theme-subtle bg-theme-secondary p-3">
      <p className="text-xs leading-relaxed text-theme-secondary">
        <span className="font-medium text-theme-primary">Headset required.</span> {headline} The live
        preview below mirrors the robot pose in the meantime.
      </p>
      {targets.map((target) => (
        <div key={target.id} className="space-y-1 rounded-md border border-theme-subtle p-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-primary">
              {target.label}
            </span>
            {target.insecure && <Badge variant="warning" size="sm">no WebXR</Badge>}
          </div>
          {target.command && (
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-black/20 px-2 py-1 font-mono text-[11px] text-theme-secondary">
                {target.command}
              </code>
              <Button variant="ghost" size="sm" onClick={() => onCopy(`${target.id}-cmd`, target.command ?? '')}>
                {copied === `${target.id}-cmd` ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-black/20 px-2 py-1 font-mono text-[11px] text-theme-secondary">
              {target.url}
            </code>
            <Button variant="ghost" size="sm" onClick={() => onCopy(target.id, target.url)}>
              {copied === target.id ? 'Copied' : 'Copy URL'}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-theme-tertiary">{target.note}</p>
        </div>
      ))}
    </div>
  );
}
