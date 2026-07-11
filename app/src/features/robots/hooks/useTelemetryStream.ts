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

// After this many consecutive failures: status → 'error', polling slows down.
const FAILURE_BACKOFF_THRESHOLD = 3;
// Slowed polling interval while in the error state.
const FAILURE_BACKOFF_INTERVAL = 30_000;

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

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Per-connect generation token: any await inside startPolling re-checks this
  // so a stale connect (unmounted or robot switched mid-flight) can never
  // install a timer that polls the old robotId.
  const generationRef = useRef(0);
  // Consecutive fetch failures — drives error status + slowed polling.
  const failureStreakRef = useRef(0);

  const updateTelemetry = useRobotsStore((state) => state.updateTelemetry);

  // Check if we're in development or demo mode (both use HTTP polling instead of WebSocket)
  const isDev = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';

  // WebSocket URL for production
  const wsUrl = `wss://api.neodem.io/telemetry/${robotId}`;

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

  // Polling mode: fetch telemetry from server periodically.
  // Uses a recursive setTimeout loop guarded by a generation token so a stale
  // connect can never leave an orphaned timer behind, and so the delay can
  // stretch to FAILURE_BACKOFF_INTERVAL after repeated failures.
  const startPolling = useCallback(async () => {
    if (!isDev) return;

    // Invalidate any in-flight startPolling / poll loop, then take ownership.
    const gen = ++generationRef.current;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    failureStreakRef.current = 0;

    setDevStatus('connecting');
    onStatusChange?.('connecting');

    // Short delay to show connecting state
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (gen !== generationRef.current || !mountedRef.current) return;

    setDevStatus('connected');
    setIsDevConnected(true);
    onStatusChange?.('connected');

    const poll = async () => {
      try {
        const newTelemetry = await fetchTelemetry(robotId);
        if (gen !== generationRef.current || !mountedRef.current) return;
        if (failureStreakRef.current >= FAILURE_BACKOFF_THRESHOLD) {
          // Recovered from an error streak — restore live status + fast polling.
          setDevStatus('connected');
          setIsDevConnected(true);
          onStatusChange?.('connected');
        }
        failureStreakRef.current = 0;
        handleTelemetry(newTelemetry);
      } catch (error) {
        if (gen !== generationRef.current || !mountedRef.current) return;
        failureStreakRef.current += 1;
        if (failureStreakRef.current === 1) {
          // Log once per failure streak instead of every tick.
          console.error(`Telemetry fetch failed for robot ${robotId} (further failures muted until recovery):`, error);
        }
        if (failureStreakRef.current === FAILURE_BACKOFF_THRESHOLD) {
          setDevStatus('error');
          setIsDevConnected(false);
          onStatusChange?.('error');
        }
      }

      if (gen !== generationRef.current || !mountedRef.current) return;
      const delay =
        failureStreakRef.current >= FAILURE_BACKOFF_THRESHOLD
          ? FAILURE_BACKOFF_INTERVAL
          : updateInterval;
      timerRef.current = setTimeout(poll, delay);
    };

    await poll();
  }, [isDev, robotId, handleTelemetry, updateInterval, onStatusChange]);

  const stopPolling = useCallback(() => {
    // Invalidate any in-flight startPolling so it can't install a timer later.
    generationRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
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

    // Reset telemetry when the robot changes so a switch never shows the prior
    // robot's data (consumers treat `telemetry !== null` as the liveness signal).
    setTelemetry(null);
    setLastUpdate(null);

    if (autoConnect) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      if (isDev) {
        // Invalidate any in-flight startPolling (it re-checks the generation
        // after every await) and drop the pending timer.
        generationRef.current += 1;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
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
