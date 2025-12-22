/**
 * @file useRobotWebSocket.ts
 * @description WebSocket hook for real-time robot updates
 * @feature robots
 */

import { useEffect, useRef, useCallback } from 'react';
import { useRobotsStore } from '../store/robotsStore';
import type { Robot } from '../types/robots.types';

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
    | 'task_event';
  robotId?: string;
  robot?: Robot;
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
    url = 'ws://localhost:3001/api/a2a/ws',
    autoReconnect = true,
    reconnectInterval = 5000,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectedRef = useRef(false);

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

          case 'robot_telemetry':
            // Telemetry updates come with robotId and telemetry data
            // For now, we just log them
            if (data.robotId) {
              console.log('[RobotWebSocket] Telemetry update:', data.robotId);
            }
            break;

          case 'connected':
            console.log('[RobotWebSocket] Connected to server');
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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

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
        wsRef.current = null;

        // Auto-reconnect
        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[RobotWebSocket] Attempting to reconnect...');
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        console.error('[RobotWebSocket] Error:', error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[RobotWebSocket] Failed to connect:', error);
    }
  }, [url, handleMessage, autoReconnect, reconnectInterval]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
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
