/**
 * @file useWebSocket.ts
 * @description Hook for WebSocket connection management with auto-reconnect
 * @feature shared
 * @dependencies shared/types/api.types
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WebSocketStatus, WebSocketMessage, UseWebSocketReturn } from '@/shared/types/api.types';

export interface UseWebSocketOptions<T> {
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Reconnect on disconnect (default: true) */
  reconnect?: boolean;
  /** Maximum reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Reconnection interval in ms (default: 3000) */
  reconnectInterval?: number;
  /** Callback when a message is received */
  onMessage?: (message: WebSocketMessage<T>) => void;
  /** Callback when connection is established */
  onConnect?: () => void;
  /** Callback when connection is closed */
  onDisconnect?: (event: CloseEvent) => void;
  /** Callback when an error occurs */
  onError?: (error: Event) => void;
}

/**
 * A hook for managing WebSocket connections with automatic reconnection,
 * message handling, and connection state tracking.
 *
 * @param url - The WebSocket server URL
 * @param options - Configuration options
 * @returns Object with connection status, last message, and control functions
 *
 * @example
 * ```typescript
 * const { status, lastMessage, send, connect, disconnect } = useWebSocket<RobotTelemetry>(
 *   'wss://api.robomind.io/telemetry',
 *   {
 *     onMessage: (msg) => updateTelemetry(msg.payload),
 *     onConnect: () => console.log('Connected to telemetry'),
 *     reconnect: true,
 *   }
 * );
 *
 * // Send a message
 * send({ type: 'subscribe', payload: { robotId: '123' }, timestamp: new Date().toISOString() });
 * ```
 */
export function useWebSocket<T = unknown>(
  url: string,
  options: UseWebSocketOptions<T> = {}
): UseWebSocketReturn<T> {
  const {
    autoConnect = true,
    reconnect = true,
    maxReconnectAttempts = 5,
    reconnectInterval = 3000,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage<T> | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Clear reconnect timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    clearReconnectTimeout();
    setStatus('connecting');

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (!mountedRef.current) return;
        reconnectAttemptsRef.current = 0;
        setStatus('connected');
        onConnect?.();
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const message = JSON.parse(event.data) as WebSocketMessage<T>;
          setLastMessage(message);
          onMessage?.(message);
        } catch (error) {
          console.warn('Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = (event: CloseEvent) => {
        if (!mountedRef.current) return;
        setStatus('disconnected');
        onDisconnect?.(event);

        // Attempt reconnection if enabled and not a clean close
        if (reconnect && !event.wasClean && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, reconnectInterval);
        }
      };

      ws.onerror = (event: Event) => {
        if (!mountedRef.current) return;
        setStatus('error');
        onError?.(event);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setStatus('error');
    }
  }, [url, reconnect, maxReconnectAttempts, reconnectInterval, onConnect, onDisconnect, onMessage, onError, clearReconnectTimeout]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent reconnection

    if (wsRef.current) {
      setStatus('disconnecting');
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }
  }, [clearReconnectTimeout, maxReconnectAttempts]);

  // Send a message
  const send = useCallback((message: WebSocketMessage<T>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: WebSocket is not connected');
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      clearReconnectTimeout();

      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmount');
        wsRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status,
    lastMessage,
    send,
    connect,
    disconnect,
  };
}
