/**
 * @file useTelemetryStream.ts
 * @description Hook for real-time robot telemetry via WebSocket with polling fallback
 * @feature robots
 * @dependencies @/shared/hooks/useWebSocket, @/features/robots/types, @/features/robots/api
 * @stateAccess useRobotsStore (write)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useWebSocket, type UseWebSocketOptions } from '@/shared/hooks/useWebSocket';
import type { WebSocketStatus, WebSocketMessage } from '@/shared/types/api.types';
import type { RobotTelemetry } from '../types/robots.types';
import { useRobotsStore } from '../store/robotsStore';
import { robotsApi } from '../api/robotsApi';

// ============================================================================
// TYPES
// ============================================================================

export interface UseTelemetryStreamOptions {
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Update interval in ms for polling mode (default: 5000) */
  updateInterval?: number;
  /** Callback when telemetry is received */
  onTelemetry?: (telemetry: RobotTelemetry) => void;
  /** Callback on connection status change */
  onStatusChange?: (status: WebSocketStatus) => void;
}

export interface UseTelemetryStreamReturn {
  /** Current telemetry data */
  telemetry: RobotTelemetry | null;
  /** Connection status */
  status: WebSocketStatus;
  /** Whether connected (via WebSocket or polling) */
  isConnected: boolean;
  /** Whether using polling mode (vs WebSocket) */
  isPolling: boolean;
  /** Last update timestamp */
  lastUpdate: Date | null;
  /** Connect to telemetry stream */
  connect: () => void;
  /** Disconnect from telemetry stream */
  disconnect: () => void;
}

// ============================================================================
// TELEMETRY FETCHER
// ============================================================================

/**
 * Fetches telemetry data from the server API.
 */
async function fetchTelemetry(robotId: string): Promise<RobotTelemetry> {
  return robotsApi.getTelemetry(robotId);
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for streaming real-time telemetry data from a robot.
 * In development mode, simulates WebSocket with periodic mock data updates.
 *
 * @param robotId - The robot ID to stream telemetry for
 * @param options - Configuration options
 * @returns Telemetry data, connection status, and control functions
 *
 * @example
 * ```tsx
 * function RobotTelemetryDisplay({ robotId }: { robotId: string }) {
 *   const { telemetry, status, isConnected, lastUpdate } = useTelemetryStream(robotId);
 *
 *   if (!isConnected) {
 *     return <div>Connecting to telemetry...</div>;
 *   }
 *
 *   return (
 *     <div>
 *       <BatteryGauge level={telemetry?.batteryLevel ?? 0} />
 *       <SensorGrid sensors={telemetry?.sensors ?? {}} />
 *       <span>Last update: {lastUpdate?.toLocaleTimeString()}</span>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTelemetryStream(
  robotId: string,
  options: UseTelemetryStreamOptions = {}
): UseTelemetryStreamReturn {
  const {
    autoConnect = true,
    updateInterval = 5000,
    onTelemetry,
    onStatusChange,
  } = options;

  const [telemetry, setTelemetry] = useState<RobotTelemetry | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [devStatus, setDevStatus] = useState<WebSocketStatus>('disconnected');
  const [isDevConnected, setIsDevConnected] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const updateTelemetry = useRobotsStore((state) => state.updateTelemetry);

  // Check if we're in development mode
  const isDev = import.meta.env.DEV;

  // WebSocket URL for production
  const wsUrl = `wss://api.robomind.io/telemetry/${robotId}`;

  // Handle incoming telemetry (both real and simulated)
  const handleTelemetry = useCallback(
    (data: RobotTelemetry) => {
      if (!mountedRef.current) return;

      setTelemetry(data);
      setLastUpdate(new Date());
      updateTelemetry(robotId, data);
      onTelemetry?.(data);
    },
    [robotId, updateTelemetry, onTelemetry]
  );

  // Production WebSocket configuration
  const wsOptions: UseWebSocketOptions<RobotTelemetry> = useMemo(
    () => ({
      autoConnect: !isDev && autoConnect,
      reconnect: true,
      maxReconnectAttempts: 10,
      reconnectInterval: 5000,
      onMessage: (message: WebSocketMessage<RobotTelemetry>) => {
        if (message.payload) {
          handleTelemetry(message.payload);
        }
      },
      onConnect: () => {
        onStatusChange?.('connected');
      },
      onDisconnect: () => {
        onStatusChange?.('disconnected');
      },
      onError: () => {
        onStatusChange?.('error');
      },
    }),
    [isDev, autoConnect, handleTelemetry, onStatusChange]
  );

  // Production WebSocket connection
  const ws = useWebSocket<RobotTelemetry>(wsUrl, wsOptions);

  // Polling mode: fetch telemetry from server periodically
  const startPolling = useCallback(async () => {
    if (!isDev) return;

    setDevStatus('connecting');
    onStatusChange?.('connecting');

    // Short delay to show connecting state
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (!mountedRef.current) return;

    setDevStatus('connected');
    setIsDevConnected(true);
    onStatusChange?.('connected');

    // Fetch initial telemetry
    try {
      const initialTelemetry = await fetchTelemetry(robotId);
      handleTelemetry(initialTelemetry);
    } catch (error) {
      console.error('Failed to fetch initial telemetry:', error);
    }

    // Start periodic updates
    intervalRef.current = setInterval(async () => {
      if (!mountedRef.current) return;
      try {
        const newTelemetry = await fetchTelemetry(robotId);
        handleTelemetry(newTelemetry);
      } catch (error) {
        console.error('Failed to fetch telemetry:', error);
      }
    }, updateInterval);
  }, [isDev, robotId, handleTelemetry, updateInterval, onStatusChange]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsDevConnected(false);
    setDevStatus('disconnected');
    onStatusChange?.('disconnected');
  }, [onStatusChange]);

  // Connect function
  const connect = useCallback(() => {
    if (isDev) {
      startPolling();
    } else {
      ws.connect();
    }
  }, [isDev, startPolling, ws]);

  // Disconnect function
  const disconnect = useCallback(() => {
    if (isDev) {
      stopPolling();
    } else {
      ws.disconnect();
    }
  }, [isDev, stopPolling, ws]);

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;

    if (autoConnect) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      if (isDev) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };
  }, [robotId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine current status and connection state
  const status = isDev ? devStatus : ws.status;
  const isConnected = isDev ? isDevConnected : ws.status === 'connected';

  return useMemo(
    () => ({
      telemetry,
      status,
      isConnected,
      isPolling: isDev,
      lastUpdate,
      connect,
      disconnect,
    }),
    [telemetry, status, isConnected, isDev, lastUpdate, connect, disconnect]
  );
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Hook to get just the telemetry connection status.
 */
export function useTelemetryStatus(robotId: string): {
  status: WebSocketStatus;
  isConnected: boolean;
} {
  const { status, isConnected } = useTelemetryStream(robotId, {
    autoConnect: true,
  });

  return { status, isConnected };
}
