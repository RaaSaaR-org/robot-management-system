/**
 * @file useA2AStream.ts
 * @description Hook for WebSocket streaming of A2A events
 * @feature a2a
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useA2AStore } from '../store';
import type { A2ATaskEvent } from '../types';
import { getWebSocketUrl } from '@/shared/utils/websocket';

interface UseA2AStreamOptions {
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
  /** Callback when connected */
  onConnect?: () => void;
  /** Callback when disconnected */
  onDisconnect?: () => void;
  /** Callback when task event received */
  onTaskEvent?: (event: A2ATaskEvent) => void;
}

interface UseA2AStreamReturn {
  /** Whether connected to WebSocket */
  isConnected: boolean;
  /** Connection error */
  error: string | null;
  /** Connect to WebSocket */
  connect: () => void;
  /** Disconnect from WebSocket */
  disconnect: () => void;
}

/**
 * Hook for WebSocket streaming of A2A events
 */
export function useA2AStream(options: UseA2AStreamOptions = {}): UseA2AStreamReturn {
  const {
    autoConnect = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
    onConnect,
    onDisconnect,
    onTaskEvent,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setWsConnected, handleTaskEvent, fetchMessages } = useA2AStore();

  // Debounce fetchMessages to prevent rapid-fire requests from WebSocket events
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFetchRef = useRef<string | null>(null);

  const debouncedFetchMessages = useCallback((contextId: string) => {
    pendingFetchRef.current = contextId;
    if (fetchDebounceRef.current) {
      clearTimeout(fetchDebounceRef.current);
    }
    fetchDebounceRef.current = setTimeout(() => {
      if (pendingFetchRef.current && mountedRef.current) {
        fetchMessages(pendingFetchRef.current).catch(console.error);
        pendingFetchRef.current = null;
      }
      fetchDebounceRef.current = null;
    }, 500);
  }, [fetchMessages]);

  const connect = useCallback(() => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') {
      console.info('[Demo] WebSocket disabled in demo mode');
      return;
    }

    // Don't reconnect if already connected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    setError(null);

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        console.log('A2A WebSocket connected');
        setIsConnected(true);
        setWsConnected(true);
        reconnectAttemptsRef.current = 0;
        onConnect?.();
      };

      ws.onmessage = (event) => {
        // Skip processing if component unmounted
        if (!mountedRef.current) return;

        try {
          const data = JSON.parse(event.data);

          if (data.type === 'task_event' && data.event) {
            const taskEvent = data.event as A2ATaskEvent;
            handleTaskEvent(taskEvent);
            onTaskEvent?.(taskEvent);

            // Refresh messages for the affected conversation (debounced to prevent rapid requests)
            if (taskEvent.contextId && mountedRef.current) {
              debouncedFetchMessages(taskEvent.contextId);
            }
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.log('A2A WebSocket disconnected');
        wsRef.current = null;
        if (!mountedRef.current) return;

        setIsConnected(false);
        setWsConnected(false);
        onDisconnect?.();

        // Attempt reconnection with exponential backoff
        if (mountedRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const backoffDelay = Math.min(
            reconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1),
            60000
          );
          console.log(
            `Attempting reconnection ${reconnectAttemptsRef.current}/${maxReconnectAttempts} in ${backoffDelay}ms...`
          );
          reconnectTimeoutRef.current = setTimeout(connect, backoffDelay);
        } else if (mountedRef.current) {
          setError('Max reconnection attempts reached');
        }
      };

      ws.onerror = (event) => {
        console.error('A2A WebSocket error:', event);
        if (mountedRef.current) {
          setError('WebSocket connection error');
        }
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [
    onConnect,
    onDisconnect,
    onTaskEvent,
    handleTaskEvent,
    setWsConnected,
    debouncedFetchMessages,
    maxReconnectAttempts,
    reconnectDelay,
  ]);

  const disconnect = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Reset reconnect attempts to prevent auto-reconnection
    reconnectAttemptsRef.current = maxReconnectAttempts;

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setWsConnected(false);
  }, [maxReconnectAttempts, setWsConnected]);

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      connect();
    }

    return () => {
      // Mark as unmounted first to prevent state updates
      mountedRef.current = false;

      // Clean up on unmount
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current);
        fetchDebounceRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [autoConnect, connect]);

  return {
    isConnected,
    error,
    connect,
    disconnect,
  };
}

/**
 * Hook to send heartbeat/ping to keep connection alive
 */
export function useA2AHeartbeat(interval: number = 30000) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, interval);

    return () => clearInterval(heartbeatInterval);
  }, [interval]);
}
