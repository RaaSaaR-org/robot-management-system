/**
 * @file useWebSocket.test.ts
 * @description Tests for the useWebSocket hook — connection lifecycle, message
 *   handling, status transitions, cleanup, and auto-reconnect with backoff.
 *   The global WebSocket is replaced with a controllable fake so we can drive
 *   open/message/close/error events deterministically, and reconnect timers are
 *   driven via fake timers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../useWebSocket';
import type { WebSocketMessage } from '@/shared/types/api.types';

/**
 * Controllable fake WebSocket. Records instances so tests can fire lifecycle
 * events manually. Mirrors the readyState constants the hook relies on.
 */
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  // --- Test drivers -------------------------------------------------------
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  fireMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  fireRawMessage(raw: string) {
    this.onmessage?.({ data: raw } as MessageEvent);
  }

  fireClose(opts: { wasClean?: boolean; code?: number } = {}) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({
      wasClean: opts.wasClean ?? false,
      code: opts.code ?? 1006,
      reason: '',
    } as CloseEvent);
  }

  fireError() {
    this.onerror?.(new Event('error'));
  }
}

/** Most-recently created socket. */
function latest(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

function msg(type: string, payload: unknown): WebSocketMessage<unknown> {
  return { type, payload, timestamp: '2026-06-22T00:00:00.000Z' };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useWebSocket', () => {
  describe('initial state', () => {
    it('starts in connecting state and creates a socket when autoConnect is on', () => {
      const { result } = renderHook(() => useWebSocket('wss://x/test'));

      expect(result.current.status).toBe('connecting');
      expect(result.current.lastMessage).toBeNull();
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(latest().url).toBe('wss://x/test');
    });

    it('stays disconnected and creates no socket when autoConnect is false', () => {
      const { result } = renderHook(() =>
        useWebSocket('wss://x/test', { autoConnect: false })
      );

      expect(result.current.status).toBe('disconnected');
      expect(FakeWebSocket.instances).toHaveLength(0);
    });
  });

  describe('success path', () => {
    it('transitions to connected and invokes onConnect when the socket opens', () => {
      const onConnect = vi.fn();
      const { result } = renderHook(() =>
        useWebSocket('wss://x/test', { onConnect })
      );

      expect(result.current.status).toBe('connecting');

      act(() => {
        latest().fireOpen();
      });

      expect(result.current.status).toBe('connected');
      expect(onConnect).toHaveBeenCalledTimes(1);
    });

    it('parses incoming messages, exposes lastMessage and calls onMessage', () => {
      const onMessage = vi.fn();
      const { result } = renderHook(() =>
        useWebSocket('wss://x/test', { onMessage })
      );

      act(() => {
        latest().fireOpen();
      });

      const payload = msg('telemetry', { battery: 80 });
      act(() => {
        latest().fireMessage(payload);
      });

      expect(result.current.lastMessage).toEqual(payload);
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith(payload);
    });

    it('sends serialized messages over an open socket', () => {
      renderHook(() => useWebSocket('wss://x/test'));
      const { result } = renderHook(() => useWebSocket('wss://x/test'));

      act(() => {
        latest().fireOpen();
      });

      const outbound = msg('subscribe', { robotId: '123' });
      act(() => {
        result.current.send(outbound);
      });

      expect(latest().sent).toEqual([JSON.stringify(outbound)]);
    });

    it('does not send and warns when the socket is not open', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = renderHook(() =>
        useWebSocket('wss://x/test', { autoConnect: false })
      );

      act(() => {
        result.current.send(msg('noop', {}));
      });

      expect(warn).toHaveBeenCalled();
      expect(FakeWebSocket.instances).toHaveLength(0);
    });
  });

  describe('error path', () => {
    it('transitions to error state and invokes onError', () => {
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useWebSocket('wss://x/test', { onError })
      );

      act(() => {
        latest().fireError();
      });

      expect(result.current.status).toBe('error');
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('ignores malformed JSON without throwing or updating lastMessage', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onMessage = vi.fn();
      const { result } = renderHook(() =>
        useWebSocket('wss://x/test', { onMessage })
      );

      act(() => {
        latest().fireOpen();
        latest().fireRawMessage('{not valid json');
      });

      expect(result.current.lastMessage).toBeNull();
      expect(onMessage).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    it('sets error status when the WebSocket constructor throws', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal(
        'WebSocket',
        class {
          static OPEN = 1;
          static CONNECTING = 0;
          constructor() {
            throw new Error('boom');
          }
        } as unknown as typeof WebSocket
      );

      const { result } = renderHook(() => useWebSocket('wss://x/test'));

      expect(result.current.status).toBe('error');
      expect(error).toHaveBeenCalled();
    });
  });

  describe('loading / status transitions', () => {
    it('walks connecting -> connected -> disconnected on close', () => {
      const onDisconnect = vi.fn();
      const { result } = renderHook(() =>
        useWebSocket('wss://x/test', { reconnect: false, onDisconnect })
      );

      expect(result.current.status).toBe('connecting');

      act(() => {
        latest().fireOpen();
      });
      expect(result.current.status).toBe('connected');

      act(() => {
        latest().fireClose({ wasClean: true });
      });
      expect(result.current.status).toBe('disconnected');
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });

    it('settles to disconnected after an explicit disconnect() call', () => {
      const { result } = renderHook(() => useWebSocket('wss://x/test'));

      act(() => {
        latest().fireOpen();
      });
      expect(result.current.status).toBe('connected');

      act(() => {
        result.current.disconnect();
      });
      expect(result.current.status).toBe('disconnected');
      expect(latest().closeCalls.length).toBeGreaterThan(0);
    });
  });

  describe('reconnect behavior', () => {
    it('reconnects after backoff on an unclean close', () => {
      renderHook(() =>
        useWebSocket('wss://x/test', { reconnectInterval: 1000 })
      );

      act(() => {
        latest().fireOpen();
        latest().fireClose({ wasClean: false });
      });

      // First backoff = 1000 * 2^0 = 1000ms. Nothing yet before it elapses.
      expect(FakeWebSocket.instances).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('does NOT reconnect on a clean close', () => {
      renderHook(() =>
        useWebSocket('wss://x/test', { reconnectInterval: 1000 })
      );

      act(() => {
        latest().fireOpen();
        latest().fireClose({ wasClean: true });
      });

      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('does NOT reconnect when reconnect is disabled', () => {
      renderHook(() =>
        useWebSocket('wss://x/test', {
          reconnect: false,
          reconnectInterval: 1000,
        })
      );

      act(() => {
        latest().fireOpen();
        latest().fireClose({ wasClean: false });
      });

      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('stops reconnecting after maxReconnectAttempts is exhausted', () => {
      renderHook(() =>
        useWebSocket('wss://x/test', {
          reconnectInterval: 1000,
          maxReconnectAttempts: 2,
        })
      );

      // Initial socket
      expect(FakeWebSocket.instances).toHaveLength(1);

      // Attempt 1: backoff 1000ms -> socket #2
      act(() => {
        latest().fireClose({ wasClean: false });
        vi.advanceTimersByTime(1000);
      });
      expect(FakeWebSocket.instances).toHaveLength(2);

      // Attempt 2: backoff 2000ms -> socket #3
      act(() => {
        latest().fireClose({ wasClean: false });
        vi.advanceTimersByTime(2000);
      });
      expect(FakeWebSocket.instances).toHaveLength(3);

      // Third close: attempts now equal max -> no further reconnect
      act(() => {
        latest().fireClose({ wasClean: false });
        vi.advanceTimersByTime(60000);
      });
      expect(FakeWebSocket.instances).toHaveLength(3);
    });

    it('disconnect() prevents any pending reconnect', () => {
      const { result } = renderHook(() =>
        useWebSocket('wss://x/test', { reconnectInterval: 1000 })
      );

      act(() => {
        latest().fireOpen();
        latest().fireClose({ wasClean: false });
      });
      // A reconnect timer is now pending; disconnect should cancel it.
      act(() => {
        result.current.disconnect();
        vi.advanceTimersByTime(10000);
      });

      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });

  describe('cleanup on unmount', () => {
    it('closes the socket on unmount', () => {
      const { unmount } = renderHook(() => useWebSocket('wss://x/test'));
      const socket = latest();

      act(() => {
        socket.fireOpen();
      });

      unmount();

      expect(socket.closeCalls.length).toBeGreaterThan(0);
    });

    it('cancels a pending reconnect timer on unmount', () => {
      const { unmount } = renderHook(() =>
        useWebSocket('wss://x/test', { reconnectInterval: 1000 })
      );

      act(() => {
        latest().fireClose({ wasClean: false });
      });
      unmount();

      act(() => {
        vi.advanceTimersByTime(10000);
      });
      // No new socket created after unmount.
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('does not update state from a message after unmount', () => {
      const onMessage = vi.fn();
      const { unmount } = renderHook(() =>
        useWebSocket('wss://x/test', { onMessage })
      );
      const socket = latest();

      act(() => {
        socket.fireOpen();
      });
      unmount();

      // closeExisting nulls the handlers, but even a stray message must not
      // invoke the user callback after unmount.
      act(() => {
        socket.onmessage?.({ data: JSON.stringify(msg('x', {})) } as MessageEvent);
      });
      expect(onMessage).not.toHaveBeenCalled();
    });
  });
});
