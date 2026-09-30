/**
 * @file VRTeleopLease.test.tsx
 * @description VR teleop under the control lease (TASK-319): entering VR needs
 *              `bound`, leaving the session releases, the stop stays enabled
 *              while observing, and with the capability off nothing changes.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import type { Robot } from '../../../../types/robots.types';

vi.mock('../VrScene', () => ({
  VrScene: () => <div data-testid="vr-scene" />,
}));

const sessionEnd = vi.fn(() => Promise.resolve());
let xrListener: ((s: { session: unknown }) => void) | null = null;
let xrSession: { end: () => Promise<void> } | null = null;

vi.mock('@react-three/xr', () => ({
  createXRStore: () => ({
    subscribe: (fn: (s: { session: unknown }) => void) => {
      xrListener = fn;
      return () => {
        xrListener = null;
      };
    },
    getState: () => ({ session: xrSession }),
    enterVR: vi.fn(),
  }),
}));

vi.mock('@/features/safety/api/safetyApi', () => ({
  safetyApi: {
    triggerRobotEStop: vi.fn(() => Promise.resolve({})),
    resetRobotEStop: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock('../../../../api/controlLeaseApi', () => ({
  controlLeaseApi: {
    getControlLease: vi.fn(),
    acquireControlLease: vi.fn(),
    renewControlLease: vi.fn(),
    releaseControlLease: vi.fn(),
  },
}));

import { controlLeaseApi } from '../../../../api/controlLeaseApi';
import { VRTeleopModalBody } from '../VRTeleopModal';

const api = vi.mocked(controlLeaseApi);

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
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const robot: Robot = {
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
};

/** The teleop socket — the observer socket on /api/a2a/ws is a separate instance. */
const teleopSocket = (): FakeSocket =>
  FakeSocket.instances.find((s) => s.url.endsWith('/ws/keyboard-teleop'))!;

async function renderAndOpen(enabled: boolean): Promise<FakeSocket> {
  api.getControlLease.mockResolvedValue({
    capability: { version: 1, enabled, ttlMs: 5000, renewEveryMs: 1000 },
    holder: null,
  });
  render(
    <VRTeleopModalBody robot={robot} availability="ready" sessionSupported onClose={() => true} />,
  );
  await waitFor(() => expect(api.getControlLease).toHaveBeenCalled());
  const socket = teleopSocket();
  act(() => {
    socket.open();
    socket.deliver({ type: 'config', robotType: 'g1', joints: [], positions: {} });
  });
  return socket;
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  FakeSocket.instances = [];
  xrListener = null;
  xrSession = null;
  sessionEnd.mockClear();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.releaseControlLease.mockResolvedValue({ released: true });
  api.acquireControlLease.mockResolvedValue({
    ok: true,
    grant: { leaseId: 'L', generation: 4, sessionId: 's', ttlMs: 5000, renewEveryMs: 1000, expiresAt: 'x' },
  });
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe('VRTeleopModalBody — control lease', () => {
  it('behaves as before when the capability is off', async () => {
    await renderAndOpen(false);
    expect(screen.queryByTestId('control-lease-bar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enter VR' })).toBeEnabled();
  });

  it('enters VR only once the lease is bound, and releases when the session ends', async () => {
    const socket = await renderAndOpen(true);
    await screen.findByTestId('control-lease-bar');
    expect(screen.getByRole('button', { name: 'Enter VR' })).toBeDisabled();
    // The stop is never gated on the lease.
    expect(screen.getByRole('button', { name: 'Emergency stop' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /take control/i }));
    await waitFor(() => expect(socket.frames()).toContainEqual({ bind: { leaseId: 'L', generation: 4 } }));
    act(() => socket.deliver({ type: 'lease', state: 'bound', generation: 4 }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enter VR' })).toBeEnabled());

    xrSession = { end: sessionEnd };
    act(() => xrListener?.({ session: xrSession }));
    xrSession = null;
    act(() => xrListener?.({ session: null }));

    expect(api.releaseControlLease).toHaveBeenCalledTimes(1);
    expect(api.releaseControlLease).toHaveBeenCalledWith('robot-1', 'L', 4);
    expect(screen.getByRole('button', { name: 'Enter VR' })).toBeDisabled();
  });

  it('releases and ends the session when the agent revokes the lease', async () => {
    const socket = await renderAndOpen(true);
    await screen.findByTestId('control-lease-bar');
    fireEvent.click(screen.getByRole('button', { name: /take control/i }));
    await waitFor(() => expect(socket.frames()).toContainEqual({ bind: { leaseId: 'L', generation: 4 } }));
    act(() => socket.deliver({ type: 'lease', state: 'bound', generation: 4 }));
    xrSession = { end: sessionEnd };
    act(() => xrListener?.({ session: xrSession }));

    act(() => socket.deliver({ type: 'lease', state: 'revoked', generation: 4 }));

    expect(sessionEnd).toHaveBeenCalled();
    expect(socket.frames()).toContainEqual({ move: { vx: 0, vy: 0, omega: 0 } });
    expect(api.releaseControlLease).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('control-lease-notice-lost')).toBeInTheDocument();
  });
});
