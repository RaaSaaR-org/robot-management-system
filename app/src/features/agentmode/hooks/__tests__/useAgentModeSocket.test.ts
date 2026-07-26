/**
 * @file useAgentModeSocket.test.ts
 * @description Tests for the Agent Mode socket hook — a superseded socket's
 *   late close event (robot switch, StrictMode remount) must not clobber the
 *   live socket's ref: the live socket would then leak past cleanup and keep
 *   applying events. The global WebSocket is replaced with a controllable
 *   fake, same idiom as the shared useWebSocket tests.
 * @feature agentmode
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { useAgentModeSocket } from '../useAgentModeSocket';
import { useAgentModeStore } from '../../store/agentmodeStore';

/** Controllable fake WebSocket; records instances so tests can drive events. */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  closeCalls = 0;

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // --- Test drivers -------------------------------------------------------
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  fireClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ wasClean: false, code: 1006, reason: '' } as CloseEvent);
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
  useAgentModeStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAgentModeSocket', () => {
  it('opens one socket per robot and closes the old one on a robot switch', () => {
    const { rerender } = renderHook(({ id }: { id: string | null }) => useAgentModeSocket(id), {
      initialProps: { id: 'robot-a' as string | null },
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    rerender({ id: 'robot-b' });

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[0].closeCalls).toBeGreaterThan(0);
  });

  it('a superseded socket closing late does not orphan the live socket', () => {
    const { rerender, unmount } = renderHook(
      ({ id }: { id: string | null }) => useAgentModeSocket(id),
      { initialProps: { id: 'robot-a' as string | null } }
    );
    const stale = FakeWebSocket.instances[0];

    rerender({ id: 'robot-b' });
    const live = FakeWebSocket.instances[1];
    act(() => {
      live.fireOpen();
    });

    // The old socket's close event is delivered async — only after the new
    // socket already took over the ref.
    act(() => {
      stale.fireClose();
    });

    unmount();

    // Cleanup must still find and close the live socket …
    expect(live.closeCalls).toBeGreaterThan(0);
    // … and the stale close must not have scheduled a reconnect.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('survives a StrictMode remount without leaking the second socket', () => {
    const { unmount } = renderHook(() => useAgentModeSocket('robot-a'), {
      wrapper: StrictMode,
    });

    // StrictMode mounts, cleans up and remounts: two sockets, first closed.
    expect(FakeWebSocket.instances).toHaveLength(2);
    const [stale, live] = FakeWebSocket.instances;
    expect(stale.closeCalls).toBeGreaterThan(0);

    act(() => {
      stale.fireClose();
    });

    unmount();

    expect(live.closeCalls).toBeGreaterThan(0);
  });

  it('an unclean close of the live socket still schedules a reconnect', () => {
    renderHook(() => useAgentModeSocket('robot-a'));
    act(() => {
      FakeWebSocket.instances[0].fireOpen();
    });

    act(() => {
      FakeWebSocket.instances[0].fireClose();
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
