/**
 * @file useSessionControlLease.test.ts
 * @description The session page's one control lease (TASK-320): no socket with
 *              the capability off; with it on, the page's own agent socket is
 *              the lease's primary, "Take control" binds it, and leaving
 *              releases.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../../robots/api/controlLeaseApi', () => ({
  controlLeaseApi: {
    getControlLease: vi.fn(),
    acquireControlLease: vi.fn(),
    renewControlLease: vi.fn(),
    releaseControlLease: vi.fn(),
  },
}));

import { controlLeaseApi } from '../../../robots/api/controlLeaseApi';
import { useSessionControlLease } from '../useSessionControlLease';
import { FakeSocket, binds } from './fakeSocket';

const api = vi.mocked(controlLeaseApi);
const observer = { factory: () => null };

function capability(enabled: boolean) {
  api.getControlLease.mockResolvedValue({
    capability: { version: 1, enabled, ttlMs: 5000, renewEveryMs: 1000 },
    holder: null,
  });
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.clearAllMocks();
  vi.stubGlobal('WebSocket', FakeSocket);
  api.releaseControlLease.mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSessionControlLease', () => {
  it('opens no socket while the server does not advertise leases', async () => {
    capability(false);
    const { result } = renderHook(() =>
      useSessionControlLease('g1-1', 'http://agent:41243', true, { observerFactory: observer.factory }),
    );
    await waitFor(() => expect(api.getControlLease).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.lease.enabled).toBe(false);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('opens no socket while the session has nothing that drives', async () => {
    capability(true);
    const { result } = renderHook(() =>
      useSessionControlLease('g1-1', 'http://agent:41243', false, { observerFactory: observer.factory }),
    );
    await waitFor(() => expect(result.current.lease.enabled).toBe(true));
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('binds its own agent socket on take-control and releases on leave', async () => {
    capability(true);
    api.acquireControlLease.mockResolvedValue({
      ok: true,
      grant: { leaseId: 'secret', generation: 3, ttlMs: 5000, renewEveryMs: 1000 },
    } as never);
    const { result, unmount } = renderHook(() =>
      useSessionControlLease('g1-1', 'http://agent:41243', true, { observerFactory: observer.factory }),
    );
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const ws = FakeSocket.last();
    expect(ws.url).toBe('ws://agent:41243/ws/keyboard-teleop');
    act(() => ws.open());
    expect(result.current.connected).toBe(true);

    await act(async () => {
      await result.current.lease.acquire();
    });
    expect(binds(ws)).toEqual([{ bind: { leaseId: 'secret', generation: 3 } }]);
    act(() => ws.receive({ type: 'lease', state: 'bound', generation: 3 }));
    expect(result.current.lease.state).toBe('bound');

    unmount();
    expect(api.releaseControlLease).toHaveBeenCalledWith('g1-1', 'secret', 3);
  });
});
