/**
 * @file useRobotWebSocket.ts
 * @description WebSocket hook for real-time robot updates
 * @feature robots
 */

import { useEffect, useRef, useCallback } from 'react';
import { useRobotsStore } from '../store/robotsStore';
import { useSafetyStore } from '@/features/safety';
import type { Robot, RobotTelemetry } from '../types/robots.types';
import type { EStopEvent } from '@/features/safety/types/safety.types';
import { getWebSocketUrl } from '@/shared/utils/websocket';

// ============================================================================
// TYPES
// ============================================================================

interface RobotWebSocketEvent {
  type:
    | 'robot_registered'
    | 'robot_unregistered'
    | 'robot_status_changed'
    | 'robot_telemetry'
    | 'connected'
    | 'task_event'
    | 'safety:estop';
  robotId?: string;
  robot?: Robot;
  /** Full telemetry frame on `robot_telemetry` events (TASK-184) */
  telemetry?: RobotTelemetry;
  /** Alternate envelope key some emitters use for the telemetry frame */
  payload?: RobotTelemetry;
  event?: EStopEvent;
  timestamp?: string;
}

interface UseRobotWebSocketOptions {
  /** WebSocket server URL */
  url?: string;
  /** Enable auto-reconnect */
  autoReconnect?: boolean;
  /** Reconnect interval in ms */
  reconnectInterval?: number;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for subscribing to real-time robot updates via WebSocket
 *
 * @example
 * ```tsx
 * function RobotsProvider({ children }) {
 *   useRobotWebSocket();
 *   return <>{children}</>;
 * }
 * ```
 */
export function useRobotWebSocket(options: UseRobotWebSocketOptions = {}) {
  const {
    url = getWebSocketUrl(),
    autoReconnect = true,
    reconnectInterval = 5000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectedRef = useRef(false);
  // Set when we close the socket ourselves (cleanup/unmount). A socket closed
  // mid-handshake fires an error event — that's expected, not worth logging.
  const intentionalCloseRef = useRef(false);

  // Get store actions
  const addRobot = useRobotsStore((s) => s.addRobot);
  const removeRobot = useRobotsStore((s) => s.removeRobot);
  const updateRobot = useRobotsStore((s) => s.updateRobot);
  const updateTelemetry = useRobotsStore((s) => s.updateTelemetry);

  // Handle incoming messages
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data: RobotWebSocketEvent = JSON.parse(event.data);

        switch (data.type) {
          case 'robot_registered':
            if (data.robot) {
              console.log('[RobotWebSocket] Robot registered:', data.robot.name);
              addRobot(data.robot);
            }
            break;

          case 'robot_unregistered':
            if (data.robotId) {
              console.log('[RobotWebSocket] Robot unregistered:', data.robotId);
              removeRobot(data.robotId);
            }
            break;

          case 'robot_status_changed':
            if (data.robot) {
              console.log('[RobotWebSocket] Robot status changed:', data.robot.name, data.robot.status);
              updateRobot(data.robot);
            }
            break;

          case 'robot_telemetry': {
            // Full telemetry frame broadcast by the server (TASK-184). Cache it
            // in the store — useTelemetryStream picks it up as its live source.
            const frame = data.telemetry ?? data.payload;
            const robotId = data.robotId ?? frame?.robotId;
            if (frame && robotId) {
              updateTelemetry(robotId, frame);
            }
            break;
          }

          case 'connected':
            console.log('[RobotWebSocket] Connected to server');
            break;

          case 'safety:estop':
            if (data.event) {
              console.log('[RobotWebSocket] E-stop event:', data.event.scope, data.event.reason);
              useSafetyStore.getState().addEvent(data.event);
            }
            break;

          default:
            // Ignore other event types (like task_event)
            break;
        }
      } catch (error) {
        console.error('[RobotWebSocket] Failed to parse message:', error);
      }
    },
    [addRobot, removeRobot, updateRobot, updateTelemetry]
  );

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') {
      console.info('[Demo] WebSocket disabled in demo mode');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    intentionalCloseRef.current = false;

    try {
      console.log('[RobotWebSocket] Connecting to', url);
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[RobotWebSocket] Connected');
        isConnectedRef.current = true;
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        console.log('[RobotWebSocket] Disconnected');
        isConnectedRef.current = false;

        // A superseded socket (a newer connect() already replaced wsRef) must
        // not clear the live ref out from under the current connection.
        const superseded = wsRef.current !== ws;
        if (!superseded) {
          wsRef.current = null;
        }

        // Don't reconnect on an intentional close (unmount/disconnect) or a
        // superseded socket — otherwise disconnect() spawns a zombie reconnect
        // loop that keeps reopening the connection after teardown.
        if (autoReconnect && !intentionalCloseRef.current && !superseded) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[RobotWebSocket] Attempting to reconnect...');
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        // A deliberately closed socket (cleanup/unmount or superseded
        // connection) fires an error event — don't log noise for it.
        if (intentionalCloseRef.current || wsRef.current !== ws) return;
        console.error('[RobotWebSocket] Error:', error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[RobotWebSocket] Failed to connect:', error);
    }
  }, [url, handleMessage, autoReconnect, reconnectInterval]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectedRef.current = false;
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected: isConnectedRef.current,
    connect,
    disconnect,
  };
}
