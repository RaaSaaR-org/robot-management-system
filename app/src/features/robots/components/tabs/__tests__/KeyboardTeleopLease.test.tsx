/**
 * @file KeyboardTeleopLease.test.tsx
 * @description Keyboard teleop under the control lease (TASK-319): unchanged
 *              with the capability off; with it on, motion keys wait for
 *              `bound`, "Take control" binds the socket, and the E-stop stays
 *              clickable while observing.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

const estopSpy = vi.fn();
vi.mock('@/features/safety', () => ({
  RobotEmergencyStopButton: () => (
    <button type="button" onClick={estopSpy}>
      E-stop
    </button>
  ),
}));

vi.mock('../../../api/controlLeaseApi', () => ({
  controlLeaseApi: {
    getControlLease: vi.fn(),
    acquireControlLease: vi.fn(),
    renewControlLease: vi.fn(),
    releaseControlLease: vi.fn(),
  },
}));

import { controlLeaseApi } from '../../../api/controlLeaseApi';
import { toast } from '@/shared/components/ui';
import { KeyboardTeleopSection } from '../TeleopTab';
import type { TeleopTabProps } from '../types';

const api = vi.mocked(controlLeaseApi);

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  /** Like a real socket, a close ends in `onclose`. That is what clears the
   *  section's heartbeat; without it the interval outlives the test. */
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const robot = { id: 'g1-1', name: 'G1', a2aAgentUrl: 'http://agent:41243' } as TeleopTabProps['robot'];

function capability(enabled: boolean) {
  api.getControlLease.mockResolvedValue({
    capability: { version: 1, enabled, ttlMs: 5000, renewEveryMs: 1000 },
    holder: null,
  });
}

/**
 * The section's own agent socket. Picked by URL, never by "the last socket
 * made": with the capability on, the hook also opens an observer socket on
 * `/api/a2a/ws`, and that effect can run after the Connect click on a busy
 * machine (TASK-377) — then the last socket is the observer, not this one.
 */
function teleopSockets(): FakeSocket[] {
  return FakeSocket.instances.filter((s) => /\/teleop\/ws$|\/ws\/keyboard-teleop$/.test(s.url));
}

const joint = (name: string, drivable?: boolean) => ({
  name, limitLower: -1, limitUpper: 1, defaultPosition: 0, ...(drivable === undefined ? {} : { drivable }),
});

async function connect(
  joints: unknown[] = [{ name: 'left_elbow_joint', limitLower: -1, limitUpper: 1, defaultPosition: 0 }],
): Promise<FakeSocket> {
  const before = teleopSockets().length;
  fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));
  const opened = teleopSockets();
  expect(opened).toHaveLength(before + 1);
  const ws = opened[opened.length - 1];
  act(() => {
    ws.open();
    ws.receive({
      type: 'config',
      robotType: 'g1',
      joints,
      positions: {},
    });
  });
  return ws;
}

const moves = (ws: FakeSocket) => ws.sent.filter((m) => (m as { joint?: string }).joint);

describe('KeyboardTeleopSection with the control lease', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    Object.values(api).forEach((fn) => fn.mockReset());
    api.releaseControlLease.mockResolvedValue({ released: true });
    // A renew that fires on a slow run must get an answer, not `undefined.then`.
    api.renewControlLease.mockResolvedValue({
      ok: true,
      generation: 3,
      expiresAt: 'x',
      ttlMs: 5000,
      renewEveryMs: 1000,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('drives as before when the capability is off', async () => {
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect();
    expect(screen.queryByTestId('control-lease-bar')).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(moves(ws)).toEqual([{ joint: 'left_elbow_joint', direction: 1 }]);
    expect(ws.sent.some((m) => (m as { bind?: unknown }).bind)).toBe(false);
  });

  it('reports its clutch: closed before the frame that drives, opened after the one that stops (TASK-393)', async () => {
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect();
    const frames = () => ws.sent.filter((m) => {
      const f = m as { joint?: string; clutch?: unknown };
      return f.joint !== undefined || f.clutch !== undefined;
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    // Auto-repeat is not a second edge.
    fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(frames().map((m) => {
      const f = m as { hb?: number; clutch?: boolean; direction?: number };
      return f.hb !== undefined ? `clutch:${f.clutch}` : `dir:${f.direction}`;
    })).toEqual(['clutch:true', 'dir:1', 'dir:0', 'clutch:false']);
  });

  // TASK-421: on the real G1 the first listed joint is a leg, which the arm
  // path never commands — a key press there armed the arms with nothing to send.
  it('starts on the first drivable joint and steps over the ones that are not driven', async () => {
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect([
      joint('left_hip_pitch_joint', false),
      joint('left_elbow_joint', true),
      joint('waist_yaw_joint', false),
      joint('left_wrist_roll_joint', true),
    ]);
    const lastJoint = () => (moves(ws)[moves(ws).length - 1] as { joint: string }).joint;
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(lastJoint()).toBe('left_elbow_joint');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(lastJoint()).toBe('left_wrist_roll_joint');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(lastJoint()).toBe('left_elbow_joint');
    expect(moves(ws).some((m) => /hip|waist/.test((m as { joint: string }).joint))).toBe(false);
    expect(screen.getAllByText(/not driven/)).toHaveLength(2);
  });

  // Review of TASK-421: the readiness panel opens this socket on "Take
  // control" while the sidecar is read-only; "Switch to arm control" comes
  // after, so the config said every joint was drivable.
  it('follows a drivable update that arrives after the config', async () => {
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect([
      joint('left_hip_pitch_joint', true),
      joint('waist_yaw_joint', true),
      joint('left_elbow_joint', true),
      joint('left_wrist_roll_joint', true),
    ]);
    const lastJoint = () => (moves(ws)[moves(ws).length - 1] as { joint: string }).joint;
    expect(screen.queryAllByText(/not driven/)).toHaveLength(0);
    act(() => {
      ws.receive({
        type: 'drivable',
        joints: { left_hip_pitch_joint: false, waist_yaw_joint: false, left_elbow_joint: true, left_wrist_roll_joint: true },
      });
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(lastJoint()).toBe('left_elbow_joint');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(lastJoint()).toBe('left_elbow_joint');
    expect(screen.getAllByText(/not driven/)).toHaveLength(2);
    // A selection that is still drivable stays where the operator put it.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    act(() => {
      ws.receive({ type: 'drivable', joints: { left_hip_pitch_joint: false, waist_yaw_joint: false } });
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(lastJoint()).toBe('left_wrist_roll_joint');
    expect(moves(ws).some((m) => /hip|waist/.test((m as { joint: string }).joint))).toBe(false);
  });

  // Review of TASK-421 (round 2): the key-up stopped whatever joint was
  // selected at key-up, so moving the selection mid-hold left the held joint
  // moving on the agent — and the next press moved it as well.
  it('a key-up stops the joint the press started, even after the selection moved', async () => {
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect([joint('left_elbow_joint', true), joint('left_wrist_roll_joint', true)]);
    const before = moves(ws).length;
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(moves(ws).slice(before)).toEqual([
      { joint: 'left_elbow_joint', direction: 1 },
      { joint: 'left_elbow_joint', direction: 0 },
    ]);
    // The next press drives the newly selected joint, and only that one.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(moves(ws).slice(before + 2)).toEqual([
      { joint: 'left_wrist_roll_joint', direction: 1 },
      { joint: 'left_wrist_roll_joint', direction: 0 },
    ]);
  });

  it('a blur after a drivable update moved the selection stops the joint that was held', async () => {
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect([joint('left_hip_pitch_joint', true), joint('left_elbow_joint', true)]);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => {
      ws.receive({ type: 'drivable', joints: { left_hip_pitch_joint: false, left_elbow_joint: true } });
    });
    const before = ws.sent.length;
    fireEvent.blur(window);
    expect(ws.sent.slice(before)).toEqual([
      { joint: 'left_hip_pitch_joint', direction: 0 },
      expect.objectContaining({ clutch: false }),
    ]);
  });

  it('a second move key on another joint lets go of the first', async () => {
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect([joint('left_elbow_joint', true), joint('left_wrist_roll_joint', true)]);
    const before = moves(ws).length;
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: '-' });
    expect(moves(ws).slice(before)).toEqual([
      { joint: 'left_elbow_joint', direction: 1 },
      { joint: 'left_elbow_joint', direction: 0 },
      { joint: 'left_wrist_roll_joint', direction: -1 },
    ]);
  });

  it('lets go of a held key when the window loses focus (no keyup ever comes)', async () => {
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const before = ws.sent.length;
    fireEvent.blur(window);
    expect(ws.sent.slice(before)).toEqual([
      { joint: 'left_elbow_joint', direction: 0 },
      expect.objectContaining({ clutch: false }),
    ]);
    // A second blur with nothing held sends nothing.
    const after = ws.sent.length;
    fireEvent.blur(window);
    expect(ws.sent.length).toBe(after);
  });

  it('says why a key moved nothing, once per reason', async () => {
    const shown = vi.spyOn(toast, 'error');
    capability(false);
    render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    const ws = await connect();
    act(() => {
      ws.receive({ type: 'error', code: 'joint_not_drivable', message: 'left_hip_pitch_joint is not driven' });
      ws.receive({ type: 'error', code: 'joint_not_drivable', message: 'left_hip_pitch_joint is not driven' });
    });
    expect(shown).toHaveBeenCalledTimes(1);
    expect(shown.mock.calls[0][1]).toMatchObject({ description: 'left_hip_pitch_joint is not driven' });
  });

  it('ignores motion keys until bound, then drives', async () => {
    capability(true);
    api.acquireControlLease.mockResolvedValue({
      ok: true,
      grant: { leaseId: 'L', generation: 3, sessionId: 's', ttlMs: 5000, renewEveryMs: 1000, expiresAt: 'x' },
    });
    render(<KeyboardTeleopSection robot={robot} />);
    await screen.findByTestId('control-lease-bar');
    const ws = await connect();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(moves(ws)).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /take control/i }));
    await waitFor(() => expect(ws.sent).toContainEqual({ bind: { leaseId: 'L', generation: 3 } }));
    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 3 }));
    await screen.findByText('You have control');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(moves(ws)).toEqual([{ joint: 'left_elbow_joint', direction: 1 }]);
  });

  it('names the holder on a conflict', async () => {
    capability(true);
    api.acquireControlLease.mockResolvedValue({
      ok: false,
      code: 'lease_held',
      status: 409,
      holder: { userId: 'u2', displayName: 'Ada' },
    });
    render(<KeyboardTeleopSection robot={robot} />);
    await screen.findByTestId('control-lease-bar');
    await connect();
    fireEvent.click(screen.getByRole('button', { name: /take control/i }));
    const notice = await screen.findByTestId('control-lease-notice-conflict');
    expect(notice.textContent).toContain('Ada');
    expect(screen.getByTestId('control-lease-holder').textContent).toContain('Controlled by Ada');
  });

  it('keeps the E-stop clickable while observing', async () => {
    capability(true);
    render(<KeyboardTeleopSection robot={robot} />);
    await screen.findByTestId('control-lease-bar');
    const estop = screen.getByRole('button', { name: 'E-stop' });
    expect(estop).not.toBeDisabled();
    fireEvent.click(estop);
    expect(estopSpy).toHaveBeenCalledTimes(1);
  });

  // TASK-436: a heartbeat that outlived its test fired after the jsdom
  // teardown, where Node 20 has no `WebSocket`, and failed the CI App job.
  it('stops its heartbeat when the section unmounts', async () => {
    capability(false);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<KeyboardTeleopSection robot={robot} />);
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalledWith('g1-1'));
    await connect();
    const call = setIntervalSpy.mock.calls.findIndex(([, ms]) => ms === 100);
    expect(call).toBeGreaterThanOrEqual(0);
    const heartbeat = setIntervalSpy.mock.results[call].value;
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeat);
  });
});
