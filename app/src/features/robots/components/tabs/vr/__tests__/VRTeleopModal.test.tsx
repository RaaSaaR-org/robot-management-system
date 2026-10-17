/**
 * @file VRTeleopModal.test.tsx
 * @description Tests for the VR teleop operator console: the E-Stop send order,
 *              the in-VR Home lockout, the three WebXR availability states, and
 *              the agent's `{type:'error'}` channel.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import type { Robot } from '../../../../types/robots.types';

// ---------------------------------------------------------------------------
// WHAT IS NOT TESTED HERE, AND WHY
//
// Everything this file leaves alone is three.js or WebXR: `VrTeleopRig`'s frame
// loop, `VrOrigin`'s convergence, the wrist HUD's canvas, and the head-camera
// panel's staleness sampling. None of them can be exercised in jsdom — there is
// no WebGL context, no `XRFrame`, no `getPose`, and no gamepad — so a test of
// them here would be a test of the mocks. The DECISIONS those components make
// live in the pure modules next door (`vrHeading`, `vrSmoothing`, `vrDrive`,
// `vrHud`, `vrCamera`, `vrSession`), which is where they are covered.
// ---------------------------------------------------------------------------

/** The scene is the whole three.js half of this feature — stubbed wholesale. */
const scene = vi.hoisted(() => ({
  send: null as null | ((payload: unknown) => boolean),
  telemetryRef: null as null | { current: Record<string, unknown> },
  onEstop: null as null | (() => void),
  onResetEstop: null as null | (() => void | Promise<void>),
}));
vi.mock('../VrScene', () => ({
  VrScene: (props: {
    send?: (payload: unknown) => boolean;
    telemetryRef?: { current: Record<string, unknown> };
    onEstop?: () => void;
    onResetEstop?: () => void | Promise<void>;
  }) => {
    scene.send = props.send ?? null;
    scene.telemetryRef = props.telemetryRef ?? null;
    scene.onEstop = props.onEstop ?? null;
    scene.onResetEstop = props.onResetEstop ?? null;
    return <div data-testid="vr-scene" />;
  },
}));

/** TASK-398: the mode control polls the agent; answer as a robot in limp. */
vi.mock('../../../../api/baseModeApi', () => ({
  baseModeApi: {
    getBaseMode: vi.fn(async () => ({
      capability: { gate: 'fsm', moveEnabled: false, idsVerified: false, ids: null },
      base: { fsmId: 1, mode: 'limp', ageS: 0.2, error: null },
      inFlight: null,
      estopLatched: false,
      armed: false,
    })),
    setBaseMode: vi.fn(),
  },
}));

/** A minimal XR store: enough to enter/leave a session and end one. */
const sessionEnd = vi.fn(() => Promise.resolve());
let xrListener: ((s: { session: unknown }) => void) | null = null;
let xrSession: { end: () => Promise<void> } | null = null;

vi.mock('@react-three/xr', () => ({
  createXRStore: () => ({
    subscribe: (fn: (s: { session: unknown }) => void) => {
      xrListener = fn;
      return () => { xrListener = null; };
    },
    getState: () => ({ session: xrSession }),
    enterVR: vi.fn(),
  }),
}));

const triggerRobotEStop = vi.fn(() => Promise.resolve({} as never));
const resetRobotEStop = vi.fn(() => Promise.resolve({} as never));
vi.mock('@/features/safety/api/safetyApi', () => ({
  safetyApi: {
    triggerRobotEStop: (...args: unknown[]) => triggerRobotEStop(...(args as [])),
    resetRobotEStop: (...args: unknown[]) => resetRobotEStop(...(args as [])),
  },
}));

import type { VrSessionBridge } from '../vrSessionBridge';
import { ArmNotices, VRTeleopModalBody, meterLink, parseArmFrame, parseBaseFrame, parseHeldFrame } from '../VRTeleopModal';

/**
 * A WebSocket stand-in. `createTeleopLink` refuses to send unless
 * `readyState === 1`, so `open()` sets it before firing the handler — the same
 * order a real socket does.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  deliver(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** Every frame this socket was asked to send, parsed. */
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: 'robot-1',
    name: 'Atlas',
    model: 'G1',
    status: 'online',
    batteryLevel: 80,
    location: { x: 0, y: 0 },
    lastSeen: '2026-06-22T00:00:00.000Z',
    capabilities: [],
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

function renderModal(
  props: Partial<React.ComponentProps<typeof VRTeleopModalBody>> = {},
) {
  return render(
    <VRTeleopModalBody
      robot={makeRobot()}
      availability="ready"
      sessionSupported
      onClose={() => true}
      {...props}
    />,
  );
}

/** The fourteen arm joints the agent needs a chain for, as the agent asks it. */
/** A session the modal only checks for presence (TASK-413). */
const FAKE_SESSION: VrSessionBridge = {
  getState: () => ({
    status: 'recording', phase: 'between', take: null, takeElapsedS: null, kept: 0, discarded: 0,
    frames: 0, fpsActual: null, degraded: false, autoStopInS: null, lastQuickCheck: null, pending: false,
  }),
  actions: {
    start: () => Promise.resolve('ok'),
    stop: () => Promise.resolve('ok'),
    next: () => Promise.resolve('ok'),
    discardLast: () => Promise.resolve('ok'),
  },
};

const G1_ARM_JOINTS = (['left', 'right'] as const).flatMap((side) =>
  ['shoulder_pitch', 'shoulder_roll', 'shoulder_yaw', 'elbow', 'wrist_roll', 'wrist_pitch', 'wrist_yaw']
    .map((j) => ({ name: `${side}_${j}_joint`, min: -2, max: 2 })),
);

/** Bring the link up, the way the agent does: open, then the config frame. */
function openLink(joints: unknown[] = []): FakeSocket {
  const socket = FakeSocket.instances[0];
  act(() => {
    socket.open();
    socket.deliver({ type: 'config', robotType: 'g1', joints, positions: {} });
  });
  return socket;
}

/** Push the XR store into (or out of) a session. */
function setSession(active: boolean): void {
  xrSession = active ? { end: sessionEnd } : null;
  act(() => xrListener?.({ session: xrSession }));
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeSocket.instances = [];
  xrListener = null;
  xrSession = null;
  sessionEnd.mockClear();
  triggerRobotEStop.mockClear();
  resetRobotEStop.mockClear();
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

describe('VRTeleopModalBody — E-Stop', () => {
  it('sends the zero-move frame before the estop frame, and keeps the wearer in VR', async () => {
    renderModal();
    const socket = openLink();
    setSession(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Emergency stop' }));
    });

    // The stop frame is what actually halts a walking robot, and it goes out on
    // the socket that is already open before anything that could block.
    const frames = socket.frames();
    expect(frames[0]).toEqual({ move: { vx: 0, vy: 0, omega: 0 } });
    expect(frames[1]).toHaveProperty('estop');

    // TASK-407 (D3): the stop no longer throws the wearer out. The robot panel
    // in the headset turns red and offers the hold-to-reset; ending the session
    // hid both from the person who pressed the stop.
    expect(sessionEnd).not.toHaveBeenCalled();
    // The fleet alert and audit trail go over REST, in parallel.
    expect(triggerRobotEStop).toHaveBeenCalledWith('robot-1', expect.objectContaining({
      reason: expect.stringContaining('E-Stop'),
    }));
    expect(screen.getByText('E-stop latched')).toBeInTheDocument();
  });

  it('offers a reset that does not require the headset, and clears the latch', async () => {
    renderModal();
    openLink();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Emergency stop' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset E-stop' }));
    });

    expect(resetRobotEStop).toHaveBeenCalledWith('robot-1');
    expect(screen.queryByText('E-stop latched')).not.toBeInTheDocument();
  });
});

describe('VRTeleopModalBody — Home', () => {
  it('is enabled on an open link but disabled while in VR', () => {
    renderModal();
    openLink();

    const home = screen.getByRole('button', { name: 'Home' });
    expect(home).toBeEnabled();

    // Home snaps 43 joints at once. Doing that under a wearer's hands, while
    // they are holding a pose, is the one command that has no business being
    // reachable from a screen they cannot see.
    setSession(true);
    expect(screen.getByRole('button', { name: 'Home' })).toBeDisabled();
  });
});

describe('VRTeleopModalBody — WebXR availability', () => {
  it('tells the operator a headset is ready', () => {
    renderModal({ availability: 'ready', sessionSupported: true });
    expect(screen.getByText(/Headset detected/)).toBeInTheDocument();
    expect(screen.queryByText(/USB \(adb reverse\)/)).not.toBeInTheDocument();
  });

  it('distinguishes an insecure origin from a browser without WebXR', () => {
    const insecure = renderModal({ availability: 'insecure-origin', sessionSupported: false });
    expect(screen.getByText(/not on a secure origin/)).toBeInTheDocument();
    // ...and offers the USB route, which fixes the secure-context problem AND
    // the camera proxy in one step.
    expect(screen.getByText('USB (adb reverse)')).toBeInTheDocument();
    expect(screen.getByText(/^adb reverse tcp:/)).toBeInTheDocument();
    insecure.unmount();

    renderModal({ availability: 'unsupported', sessionSupported: false });
    expect(screen.getByText(/no WebXR/)).toBeInTheDocument();
    expect(screen.queryByText(/not on a secure origin/)).not.toBeInTheDocument();
  });
});

describe('VRTeleopModalBody — agent messages', () => {
  it('surfaces an {type:"error"} frame with the agent’s own wording', () => {
    renderModal();
    const socket = openLink();

    act(() => {
      socket.deliver({
        type: 'error',
        code: 'loco_disabled',
        message: 'Locomotion is disabled on this robot',
        at: '2026-08-22T00:00:00.000Z',
      });
    });

    const list = screen.getByTestId('vr-agent-errors');
    expect(within(list).getByText('loco_disabled')).toBeInTheDocument();
    // Rendered, not parsed: the sidecar's text is the only description of the
    // refusal that exists.
    expect(within(list).getByText('Locomotion is disabled on this robot')).toBeInTheDocument();
  });

  it('follows the robot into a latched E-Stop raised by somebody else', () => {
    renderModal();
    const socket = openLink();

    act(() => socket.deliver({ type: 'estop', active: true, reason: 'Fleet console stop' }));

    expect(screen.getByText('E-stop latched')).toBeInTheDocument();
    expect(screen.getByText('Fleet console stop')).toBeInTheDocument();
  });

  it('follows the robot back OUT of a latch it did not reset itself', () => {
    // The agent states the latch on connect and on both edges, so `active`
    // has to be read rather than assumed. A console that took every
    // `{type:'estop'}` as "latched" could watch a robot stop but never watch it
    // recover: it would have needed a reconnect to believe a reset that had
    // already happened — including one it performed itself.
    renderModal();
    const socket = openLink();

    act(() => socket.deliver({ type: 'estop', active: true, reason: 'Fleet console stop' }));
    expect(screen.getByText('E-stop latched')).toBeInTheDocument();

    act(() => socket.deliver({ type: 'estop', active: false, reason: null }));

    expect(screen.queryByText('E-stop latched')).not.toBeInTheDocument();
    expect(screen.getByTestId('vr-stream')).toHaveTextContent('Stream armed');
  });

  it('clears the estop_latched refusal from the amber list when the latch releases', () => {
    renderModal();
    const socket = openLink();

    act(() => socket.deliver({
      type: 'error',
      code: 'estop_latched',
      message: 'an emergency stop is latched — reset it before driving',
      at: '2026-08-22T00:00:00.000Z',
    }));
    expect(screen.getByText('E-stop latched')).toBeInTheDocument();

    act(() => socket.deliver({ type: 'estop', active: false, reason: null }));

    expect(screen.queryByTestId('vr-agent-errors')).not.toBeInTheDocument();
  });

  it('treats an estop_latched refusal as the latch, not as an amber note', () => {
    // A refusal is the only signal when the client is mid-stream: the pushed
    // `{type:'estop'}` covers the edges, this covers the frame in between. That
    // used to land in the amber list
    // and stop there: the latch flag stayed false, `shouldStream` kept saying
    // yes, the rig went on streaming poses at 20 Hz into an agent that was
    // discarding them, and the wearer's HUD read LINK LIVE while the arm had
    // stopped following their hand.
    renderModal();
    const socket = openLink();

    act(() => socket.deliver({
      type: 'error',
      code: 'estop_latched',
      message: 'an emergency stop is latched — reset it before driving',
      at: '2026-08-22T00:00:00.000Z',
    }));

    expect(screen.getByText('E-stop latched')).toBeInTheDocument();
    expect(screen.getByTestId('vr-stream')).toHaveTextContent('Stream held (E-stop)');
    // And the reset is reachable without the headset, as for any other latch.
    expect(screen.getByRole('button', { name: 'Reset E-stop' })).toBeInTheDocument();
  });
});

describe('VRTeleopModalBody — controller mapping card', () => {
  // The BINDING itself is in `VrTeleopRig`'s frame loop and is not tested here
  // for the reason at the top of this file; what the card PROMISES is DOM, and
  // this is the only place that can tell whether the promise matches the props.
  it('says nothing about episodes when the host has none to advance', () => {
    // The robot detail page opens this same modal with no session behind it. A
    // card that lists a control the session does not have is a lie the operator
    // only finds out about by pressing it and watching nothing happen.
    renderModal();
    expect(screen.queryByText('L-Stick')).not.toBeInTheDocument();
    expect(screen.queryByText('R-Stick')).not.toBeInTheDocument();
    expect(screen.getByText('Safety and view')).toBeInTheDocument();
  });

  it('lists the stick take controls when the session supplies one (TASK-413, D1)', () => {
    renderModal({ vrSession: FAKE_SESSION });
    expect(screen.getByText('L-Stick')).toBeInTheDocument();
    expect(screen.getByText('Click to start a take, click again to stop it')).toBeInTheDocument();
    expect(screen.getByText('R-Stick')).toBeInTheDocument();
    expect(screen.getByText('Click to end this take and start the next')).toBeInTheDocument();
    // Discard is a hold, never a click: an accidental click must not destroy a take.
    expect(screen.getByText('R-Stick hold')).toBeInTheDocument();
    // The heading moves with the rows.
    expect(screen.getByText('Safety, view and recording')).toBeInTheDocument();
    expect(screen.queryByText('Safety and view')).not.toBeInTheDocument();
  });

  it('leaves both face-button bindings exactly where they were', () => {
    // Both are bound on BOTH hands on purpose. The stick clicks exist precisely
    // so that adding recording controls did not have to buy a face button back.
    renderModal({ vrSession: FAKE_SESSION });
    expect(screen.getByText('B / Y')).toBeInTheDocument();
    expect(screen.getByText('E-STOP — either hand, either button')).toBeInTheDocument();
    expect(screen.getByText('A / X')).toBeInTheDocument();
  });
});

describe('VRTeleopModalBody — the retargeting mode and hand tracking', () => {
  it('refuses hand tracking on a robot the agent has no arm chain for', () => {
    // A tracked hand supplies a WRIST POSE, and only the IK path knows what to
    // do with one. Before this, `ikOn` in the rig was
    // `retargetMode === 'ik' || trackedLeft !== null || …`, so one hand drifting
    // into view put BOTH arms onto a retargeting the agent cannot perform — an
    // H1 advertises no wrist joints — while the mode button still read
    // "Orientation" and the mapping card still described the stick as the
    // elbow. The agent answers one `ik_unsupported`, `sendError` dedupes by
    // code, and both arms then stop with nothing in the headset saying why.
    renderModal();
    openLink([{ name: 'left_shoulder_pitch_joint', min: -2, max: 2 }]);
    expect(screen.getByTestId('vr-retarget-mode')).toBeDisabled();
    expect(screen.getByTestId('vr-hand-tracking')).toBeDisabled();
    expect(screen.getByTestId('vr-retarget-mode')).toHaveTextContent('Orientation');
  });

  it('arming hands switches the mode VISIBLY, and leaving IK disarms them', () => {
    // The mode the operator can see has to be the mode that is running. Hand
    // tracking implies IK, so the Hands button says so by moving the button
    // next to it rather than by changing the retargeting behind its label.
    renderModal();
    openLink(G1_ARM_JOINTS);
    const mode = screen.getByTestId('vr-retarget-mode');
    const hands = screen.getByTestId('vr-hand-tracking');
    expect(mode).toBeEnabled();
    expect(hands).toBeEnabled();
    const unarmed = hands.className;

    // Off IK first, so arming Hands has something to move.
    act(() => { fireEvent.click(mode); });
    expect(mode).toHaveTextContent('Orientation');

    act(() => { fireEvent.click(hands); });
    expect(mode).toHaveTextContent('IK');
    // Lit — the button paints `primary` while armed and `ghost` otherwise, so a
    // changed class is the operator seeing it is on.
    expect(hands.className).not.toBe(unarmed);

    // And back: leaving IK takes hand tracking with it, rather than leaving a
    // button lit that now does nothing.
    act(() => { fireEvent.click(mode); });
    expect(mode).toHaveTextContent('Orientation');
    expect(hands.className).toBe(unarmed);
  });
});

describe('VRTeleopModalBody — a damped base', () => {
  /**
   * WHY THIS BANNER IS NOT THE E-STOP BANNER. An E-Stop damps the base
   * (StopMove, then `SetFsmId(1)`), and clearing the latch deliberately does not
   * undo that — standing a collapsed humanoid up is an explicit operator act.
   * So "latched" and "damped" are two facts with different lifetimes, and the
   * second outlives the first: reset the stop and the arms come back while the
   * legs stay dead. Nothing said so, because `SetVelocity` answers RPC_OK in a
   * damped FSM and the base just does not integrate it.
   */
  it('renders the agent’s damped frame, and clears it when the agent says so', () => {
    renderModal();
    const socket = openLink();

    expect(screen.queryByTestId('vr-base-damped')).not.toBeInTheDocument();

    act(() => { socket.deliver({ type: 'base', damped: true, fsmId: 1 }); });
    expect(screen.getByTestId('vr-base-damped')).toHaveTextContent('Base damped');

    act(() => { socket.deliver({ type: 'base', damped: false, fsmId: 500 }); });
    expect(screen.queryByTestId('vr-base-damped')).not.toBeInTheDocument();
  });

  it('stands the base over the SOCKET, which is the caller that holds control', () => {
    // Not a REST call: the only other route to this FSM is Agent Mode's
    // `posture stand`, and Agent Mode refuses everything while
    // `controlOwnerLock` is held by teleop — which it is, for as long as this
    // console is connected. The operator at the controls was the one caller who
    // could not ask.
    renderModal();
    const socket = openLink();
    act(() => { socket.deliver({ type: 'base', damped: true, fsmId: 1 }); });

    act(() => { fireEvent.click(screen.getByTestId('vr-stand-base')); });

    expect(socket.frames().filter((f) => f.posture === 'stand')).toHaveLength(1);
    // No REST fallback smuggled in beside it.
    expect(resetRobotEStop).not.toHaveBeenCalled();
  });

  it('refuses to stand while the latch is up — the damp IS the stop working', () => {
    renderModal();
    const socket = openLink();
    act(() => {
      socket.deliver({ type: 'estop', active: true, reason: 'operator' });
      socket.deliver({ type: 'base', damped: true, fsmId: 1 });
    });

    const stand = screen.getByTestId('vr-stand-base');
    expect(stand).toBeDisabled();
    act(() => { fireEvent.click(stand); });
    expect(socket.frames().some((f) => f.posture === 'stand')).toBe(false);
  });

  it('says the link is down rather than pretending the command went out', () => {
    // `send()` returns false with no socket. A button that spins and then goes
    // quiet is how an operator concludes the robot is standing when it is not.
    renderModal();
    const socket = openLink();
    act(() => { socket.deliver({ type: 'base', damped: true, fsmId: 1 }); });
    act(() => { socket.close(); });

    act(() => { fireEvent.click(screen.getByTestId('vr-stand-base')); });

    expect(screen.getByTestId('vr-base-damped')).toHaveTextContent('link is down');
  });
});

// TASK-393: the real robot's arm write path, as the agent reports it.
describe('VRTeleopModalBody — the real G1 arm path', () => {
  it('connects through the server, not to the agent, by default', () => {
    renderModal();
    expect(FakeSocket.instances[0].url).toMatch(/\/api\/robots\/[^/]+\/teleop\/ws$/);
  });

  it('shows nothing about arming on a sidecar that needs none', () => {
    renderModal();
    const socket = openLink();
    act(() => socket.deliver({ type: 'arm', writeMode: null, armed: false, arming: false, armWeight: 0 }));
    expect(screen.queryByTestId('vr-arm-status')).toBeNull();
    expect(screen.queryByTestId('vr-arm-notices')).toBeNull();
  });

  it('shows the arms ramping in, then armed', () => {
    renderModal();
    const socket = openLink();
    act(() => socket.deliver({ type: 'arm', writeMode: 'arm_sdk', armed: true, arming: false, armWeight: 0.4 }));
    expect(screen.getByTestId('vr-arm-status')).toHaveTextContent('Arming 40%');
    act(() => socket.deliver({ type: 'arm', writeMode: 'arm_sdk', armed: true, arming: false, armWeight: 1 }));
    expect(screen.getByTestId('vr-arm-status')).toHaveTextContent('Arms armed');
  });

  it('warns — and does not block — when a Dex3 hand is missing', () => {
    renderModal();
    const socket = openLink(G1_ARM_JOINTS);
    act(() => socket.deliver({
      type: 'arm', writeMode: 'arm_sdk', armed: false, arming: false, armWeight: 0,
      hands: { left: true, right: false }, teleopMode: 'arms+left_hand',
    }));
    const notices = screen.getByTestId('vr-arm-notices');
    expect(notices).toHaveTextContent('right Dex3 hand reports no state');
    expect(screen.getByRole('button', { name: 'Enter VR' })).toBeEnabled();
  });

  it('says plainly when the sidecar is read-only', () => {
    renderModal();
    const socket = openLink();
    act(() => socket.deliver({ type: 'arm', writeMode: 'read_only', armed: false, arming: false, armWeight: 0 }));
    expect(screen.getByTestId('vr-arm-notices')).toHaveTextContent('G1_WRITE_MODE=arm_sdk');
  });

  it('takes heartbeat_lost back out when the agent says the heartbeat is live again', () => {
    renderModal();
    const socket = openLink();
    act(() => socket.deliver({ type: 'error', code: 'heartbeat_lost', message: 'no heartbeat', at: 'now' }));
    expect(screen.getByTestId('vr-agent-errors')).toHaveTextContent('heartbeat_lost');
    act(() => socket.deliver({ type: 'heartbeat', state: 'live' }));
    expect(screen.queryByTestId('vr-agent-errors')).toBeNull();
  });

  it('offers a reset when only the sidecar is still E-stopped', async () => {
    renderModal();
    const socket = openLink();
    act(() => socket.deliver({ type: 'arm', writeMode: 'arm_sdk', armed: false, arming: false, armWeight: 0, estopLatched: true }));
    const notices = screen.getByTestId('vr-arm-notices');
    expect(notices).toHaveTextContent('still E-stopped');
    await act(async () => { fireEvent.click(within(notices).getByRole('button', { name: 'Reset E-stop' })); });
    expect(resetRobotEStop).toHaveBeenCalledTimes(1);
  });

  it('says to release the grip while the agent waits for a fresh squeeze', () => {
    renderModal();
    const socket = openLink();
    act(() => socket.deliver({
      type: 'arm', writeMode: 'arm_sdk', armed: false, arming: false, armWeight: 0,
      engage: 'need_release', clutch: { left: true, right: false },
    }));
    expect(screen.getByTestId('vr-arm-status')).toHaveTextContent('Release grip to re-arm');
    act(() => socket.deliver({
      type: 'arm', writeMode: 'arm_sdk', armed: false, arming: false, armWeight: 0,
      engage: 'need_press', clutch: { left: false, right: false },
    }));
    expect(screen.getByTestId('vr-arm-status')).toHaveTextContent('Arms off');
  });
});

describe('parseArmFrame — the re-engage latch', () => {
  it('reads engage and clutch, and drops what it does not know', () => {
    const base = { type: 'arm', writeMode: 'arm_sdk' };
    expect(parseArmFrame({ ...base, engage: 'ready', clutch: { left: true, right: true } }))
      .toMatchObject({ engage: 'ready', clutch: { left: true, right: true } });
    expect(parseArmFrame({ ...base, engage: 'armed!', clutch: { left: 1 } }))
      .toMatchObject({ engage: null, clutch: null });
  });
});

describe('ArmNotices — hand tracking on the real robot', () => {
  const ARM = parseArmFrame({ type: 'arm', writeMode: 'arm_sdk', armed: false, arming: false, armWeight: 0 })!;

  it('tells the operator to use the controllers', () => {
    render(<ArmNotices arm={ARM} handTracking />);
    expect(screen.getByTestId('vr-arm-notices')).toHaveTextContent('Use controllers to drive the real robot');
  });

  it('says nothing about it on the sim', () => {
    const sim = parseArmFrame({ type: 'arm', writeMode: null })!;
    render(<ArmNotices arm={sim} handTracking />);
    expect(screen.queryByTestId('vr-arm-notices')).toBeNull();
  });
});

describe('VRTeleopModalBody — robot mode without the remote (TASK-398)', () => {
  it('shows the mode control instead of the damped panel when the sidecar controls the mode', () => {
    renderModal();
    const socket = openLink();
    act(() => {
      socket.deliver({
        type: 'base', damped: true, fsmId: 1, mode: 'limp', measured: true, moveEnabled: false, modeControl: 'fsm',
      });
    });
    expect(screen.getByTestId('vr-robot-mode')).toBeInTheDocument();
    expect(screen.queryByTestId('vr-base-damped')).not.toBeInTheDocument();
    expect(screen.queryByTestId('vr-stand-base')).not.toBeInTheDocument();
  });

  it('keeps the older damped panel on a robot without mode control', () => {
    renderModal();
    const socket = openLink();
    act(() => { socket.deliver({ type: 'base', damped: true, fsmId: 1 }); });
    expect(screen.queryByTestId('vr-robot-mode')).not.toBeInTheDocument();
    expect(screen.getByTestId('vr-base-damped')).toBeInTheDocument();
  });

  it('parses the base frame defensively', () => {
    expect(parseBaseFrame({ type: 'base', damped: true })).toEqual({
      damped: true, mode: 'unknown', measured: false, moveEnabled: true, modeControl: 'off',
    });
    expect(parseBaseFrame({ type: 'base', mode: 'balance', measured: true, moveEnabled: false, modeControl: 'fsm' }))
      .toMatchObject({ mode: 'balance', moveEnabled: false, modeControl: 'fsm' });
    expect(parseBaseFrame({ type: 'base', mode: 'flying', modeControl: 'yes' }))
      .toMatchObject({ mode: 'unknown', modeControl: 'off' });
  });
});

describe('VRTeleopModalBody — the link meter and {move} frames (TASK-398)', () => {
  it('stays live across 5 s of head-turn moves the agent never echoes', () => {
    vi.useFakeTimers();
    try {
      renderModal();
      const socket = openLink();
      act(() => { socket.deliver({ type: 'state', positions: {} }); });
      expect(scene.send).not.toBeNull();
      for (let i = 0; i < 50; i++) {
        act(() => {
          scene.send!({ move: { vx: 0, vy: 0, omega: 0.3 } });
          vi.advanceTimersByTime(100);
        });
      }
      expect(socket.frames().filter((f) => 'move' in f).length).toBe(50);
      expect(screen.getByText('Link live')).toBeInTheDocument();
      expect(screen.queryByText('Link lost')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still notices a pose frame that goes unanswered', () => {
    vi.useFakeTimers();
    try {
      renderModal();
      const socket = openLink();
      act(() => { socket.deliver({ type: 'state', positions: {} }); });
      // Pose frames ARE answered, so a stream of them with no reply is a link
      // that stopped answering — the meter must still say so.
      for (let i = 0; i < 50; i++) {
        act(() => {
          scene.send!({ positions: { left_elbow_joint: 0.1 } });
          vi.advanceTimersByTime(100);
        });
      }
      expect(screen.queryByText('Link live')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('VRTeleopModalBody — a refused arm is not a lost link (TASK-407)', () => {
  const WRISTS = { wrists: { left: null, right: { p: [0.2, -0.2, -0.3], q: [0, 0, 0, 1], grip: 0 } } };

  it('stays live while the agent answers every pose frame with held, and records why', () => {
    vi.useFakeTimers();
    try {
      renderModal();
      const socket = openLink();
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        act(() => {
          scene.send!(WRISTS);
          socket.deliver({ type: 'state', held: true, side: 'right', reason: 'arm_gate' });
          vi.advanceTimersByTime(100);
        });
        // From the first meter tick on (it starts at the fail-safe 'lost').
        if (i >= 3) seen.add(String(scene.telemetryRef!.current.link));
      }
      expect(screen.getByText('Link live')).toBeInTheDocument();
      expect(screen.queryByText('Link stale')).not.toBeInTheDocument();
      expect(screen.queryByText('Link lost')).not.toBeInTheDocument();
      // The rig buzzes linkLost on the edge into 'lost'; it never got there.
      expect([...seen]).toEqual(['live']);
      expect(scene.telemetryRef!.current.armHeld).toMatchObject({ side: 'right', reason: 'arm_gate' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts ANY agent frame as transport evidence, not only state', () => {
    vi.useFakeTimers();
    try {
      renderModal();
      const socket = openLink();
      for (let i = 0; i < 30; i++) {
        act(() => {
          scene.send!(WRISTS);
          socket.deliver({ type: 'base', damped: false, mode: 'balance', measured: true, modeControl: 'fsm' });
          vi.advanceTimersByTime(100);
        });
      }
      expect(scene.telemetryRef!.current.link).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a state answer that moved an arm clears the held reason and the refusal', () => {
    renderModal();
    const socket = openLink();
    act(() => {
      socket.deliver({ type: 'error', code: 'arm_reengage_required', message: 'release the grip' });
      socket.deliver({ type: 'state', held: true, side: 'left', reason: 'not_armed' });
    });
    expect(scene.telemetryRef!.current.armRefusal).toMatchObject({ code: 'arm_reengage_required' });
    expect(scene.telemetryRef!.current.armHeld).toMatchObject({ reason: 'not_armed' });
    act(() => { socket.deliver({ type: 'state', positions: { left_elbow_joint: 0.1 } }); });
    expect(scene.telemetryRef!.current.armHeld).toBeNull();
    expect(scene.telemetryRef!.current.armRefusal).toBeNull();
  });

  it('meterLink: transport only — open and answering, or idle', () => {
    expect(meterLink('closed', 1000, 999, 999)).toBe('lost');
    expect(meterLink('open', 10_000, null, null)).toBe('live');
    expect(meterLink('open', 10_000, 9_900, 9_950)).toBe('live');
    expect(meterLink('open', 10_000, 7_000, 9_950)).toBe('lost');
  });

  it('parses held frames defensively', () => {
    expect(parseHeldFrame({ type: 'state', held: true, side: 'left', reason: 'ik_held' }))
      .toEqual({ side: 'left', reason: 'ik_held' });
    expect(parseHeldFrame({ type: 'state', held: true, side: 'up', reason: 'bogus' }))
      .toEqual({ side: 'both', reason: 'arm_gate' });
    expect(parseHeldFrame({ type: 'state', positions: {} })).toBeNull();
  });
});

describe('VRTeleopModalBody — the E-stop keeps the wearer in VR (TASK-407)', () => {
  it('B/Y (the rig\'s onEstop) latches and stops the stream without ending the session', async () => {
    renderModal();
    const socket = openLink();
    setSession(true);
    await act(async () => { scene.onEstop!(); });
    expect(socket.frames()[0]).toEqual({ move: { vx: 0, vy: 0, omega: 0 } });
    expect(socket.frames()[1]).toHaveProperty('estop');
    expect(sessionEnd).not.toHaveBeenCalled();
    expect(scene.telemetryRef!.current.estopLatched).toBe(true);
    expect(screen.getByText('E-stop latched')).toBeInTheDocument();
  });

  it('the robot panel\'s reset goes through the same reset as the desktop banner', async () => {
    renderModal();
    openLink();
    await act(async () => { scene.onEstop!(); });
    await act(async () => { await scene.onResetEstop!(); });
    expect(resetRobotEStop).toHaveBeenCalledWith('robot-1');
    expect(scene.telemetryRef!.current.estopLatched).toBe(false);
    expect(screen.queryByText('E-stop latched')).not.toBeInTheDocument();
  });
});

describe('parseArmFrame — TASK-405 fields for the robot panel', () => {
  it('reads dead-man, the disarm reason and hand health, and drops what it does not know', () => {
    const health = { present: true, ageS: 0.02, error: [0, 512], motorFaults: [{ motor: 1, joint: 'thumb_1', code: '0x200', bits: ['x'] }], powerV: 24 };
    const arm = parseArmFrame({
      type: 'arm', writeMode: 'arm_sdk', deadman: 'hold', lastDisarmReason: 'left_balance',
      handHealth: { left: health, right: { ...health, motorFaults: 'nope' } },
    });
    expect(arm?.deadman).toBe('hold');
    expect(arm?.lastDisarmReason).toBe('left_balance');
    expect(arm?.handHealth?.left.motorFaults[0]).toMatchObject({ joint: 'thumb_1', code: '0x200' });
    expect(arm?.handHealth?.right.motorFaults).toEqual([]);
    const old = parseArmFrame({ type: 'arm', writeMode: 'arm_sdk', deadman: 'maybe' });
    expect(old?.deadman).toBeNull();
    expect(old?.handHealth).toBeNull();
  });
});
