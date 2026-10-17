/**
 * @file useRobotWebSocket.readiness.test.ts
 * @description The app's robot socket feeds `robot:readiness` into the
 *              readiness store and reports whether it is open (TASK-411).
 * @feature robots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readinessFor } from '@/mocks/readinessDemoHandlers';
import { useReadinessStore } from '../../store/readinessStore';
import { useRobotWebSocket } from '../useRobotWebSocket';

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}


beforeEach(() => {
  useReadinessStore.getState().reset();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRobotWebSocket — robot:readiness', () => {
  it('stores the pushed snapshot and tracks the socket state', () => {
    const { unmount } = renderHook(() => useRobotWebSocket({ autoReconnect: false }));
    const ws = FakeSocket.last!;
    act(() => {
      ws.readyState = 1;
      ws.onopen?.();
    });
    expect(useReadinessStore.getState().socketOpen).toBe(true);

    const snap = readinessFor('r9', 'hand_fault');
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'robot:readiness', data: snap, timestamp: 1 }) } as MessageEvent);
    });
    expect(useReadinessStore.getState().byRobot.r9?.readiness.reason.code).toBe('hand_fault');

    unmount();
    expect(useReadinessStore.getState().socketOpen).toBe(false);
  });
});
