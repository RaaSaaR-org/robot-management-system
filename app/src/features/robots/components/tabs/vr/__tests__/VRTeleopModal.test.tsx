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
vi.mock('../VrScene', () => ({
  VrScene: () => <div data-testid="vr-scene" />,
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

import { VRTeleopModalBody } from '../VRTeleopModal';

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
      onClose={() => {}}
      {...props}
    />,
  );
}

/** Bring the link up, the way the agent does: open, then the config frame. */
function openLink(): FakeSocket {
  const socket = FakeSocket.instances[0];
  act(() => {
    socket.open();
    socket.deliver({ type: 'config', robotType: 'g1', joints: [], positions: {} });
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
  it('sends the zero-move frame before the estop frame, then ends the XR session', async () => {
    renderModal();
    const socket = openLink();
    setSession(true);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'STOP' }));
    });

    // The stop frame is what actually halts a walking robot, and it goes out on
    // the socket that is already open before anything that could block.
    const frames = socket.frames();
    expect(frames[0]).toEqual({ move: { vx: 0, vy: 0, omega: 0 } });
    expect(frames[1]).toHaveProperty('estop');

    // The wearer must be told why the robot stopped, and the banner explaining
    // it is on a screen they cannot see while the headset is on.
    expect(sessionEnd).toHaveBeenCalled();
    // The fleet alert and audit trail go over REST, in parallel.
    expect(triggerRobotEStop).toHaveBeenCalledWith('robot-1', expect.objectContaining({
      reason: expect.stringContaining('E-Stop'),
    }));
    expect(screen.getByText('E-STOP LATCHED')).toBeInTheDocument();
  });

  it('offers a reset that does not require the headset, and clears the latch', async () => {
    renderModal();
    openLink();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'STOP' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset E-Stop' }));
    });

    expect(resetRobotEStop).toHaveBeenCalledWith('robot-1');
    expect(screen.queryByText('E-STOP LATCHED')).not.toBeInTheDocument();
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

    expect(screen.getByText('E-STOP LATCHED')).toBeInTheDocument();
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
    expect(screen.getByText('E-STOP LATCHED')).toBeInTheDocument();

    act(() => socket.deliver({ type: 'estop', active: false, reason: null }));

    expect(screen.queryByText('E-STOP LATCHED')).not.toBeInTheDocument();
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
    expect(screen.getByText('E-STOP LATCHED')).toBeInTheDocument();

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

    expect(screen.getByText('E-STOP LATCHED')).toBeInTheDocument();
    expect(screen.getByTestId('vr-stream')).toHaveTextContent('Stream held (E-Stop)');
    // And the reset is reachable without the headset, as for any other latch.
    expect(screen.getByRole('button', { name: 'Reset E-Stop' })).toBeInTheDocument();
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
    expect(screen.getByText('Safety and view')).toBeInTheDocument();
  });

  it('lists the L-Stick episode control when the session supplies one', () => {
    renderModal({ onNextEpisode: () => {} });
    expect(screen.getByText('L-Stick')).toBeInTheDocument();
    expect(
      screen.getByText('Click to end this episode and start the next'),
    ).toBeInTheDocument();
    // The heading moves with the rows.
    expect(screen.getByText('Safety, view and recording')).toBeInTheDocument();
    expect(screen.queryByText('Safety and view')).not.toBeInTheDocument();
  });

  it('leaves both face-button bindings exactly where they were', () => {
    // Both are bound on BOTH hands on purpose. The stick click exists precisely
    // so that adding a recording control did not have to buy a face button back.
    renderModal({ onNextEpisode: () => {} });
    expect(screen.getByText('B / Y')).toBeInTheDocument();
    expect(screen.getByText('E-STOP — either hand, either button')).toBeInTheDocument();
    expect(screen.getByText('A / X')).toBeInTheDocument();
  });
});
