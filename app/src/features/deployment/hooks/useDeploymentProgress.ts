/**
 * @file useDeploymentProgress.ts
 * @description React hook for WebSocket subscription to deployment events
 * @feature deployment
 */

import { useCallback, useEffect, useRef } from 'react';
import { useDeploymentStore } from '../store';
import type { DeploymentEvent } from '../types';
import { getWebSocketUrl } from '@/shared/utils/websocket';

export interface UseDeploymentProgressOptions {
  url?: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  onEvent?: (event: DeploymentEvent) => void;
}

export interface UseDeploymentProgressReturn {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

/**
 * Hook for subscribing to deployment WebSocket events
 */
export function useDeploymentProgress(
  options: UseDeploymentProgressOptions = {}
): UseDeploymentProgressReturn {
  const {
    url = getWebSocketUrl(),
    autoReconnect = true,
    reconnectInterval = 5000,
    onEvent,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectedRef = useRef(false);
  // Set while we close the socket ourselves (unmount/disconnect): the ensuing
  // onclose/onerror are expected — no error log, no auto-reconnect. Prevents
  // StrictMode's mount→unmount→mount from logging an error pair per visit and
  // from leaking a post-unmount reconnect socket.
  const intentionalCloseRef = useRef(false);

  // Store onEvent in a ref to avoid re-creating callbacks
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Get store methods directly without causing re-renders
  const getStoreState = useDeploymentStore.getState;

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        // Check if it's a deployment event
        if (data.type && data.type.startsWith('deployment:')) {
          const deploymentEvent = data as DeploymentEvent;

          // Update store using getState to avoid re-render dependencies
          const { handleDeploymentEvent, updateDeploymentMetrics } = getStoreState();
          handleDeploymentEvent(deploymentEvent);

          // Update metrics if present
          if (deploymentEvent.metrics && deploymentEvent.deploymentId) {
            updateDeploymentMetrics(deploymentEvent.deploymentId, deploymentEvent.metrics);
          }

          // Call custom handler if provided
          if (onEventRef.current) {
            onEventRef.current(deploymentEvent);
          }
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    },
    [getStoreState]
  );

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
      const ws = new WebSocket(url);

      ws.onopen = () => {
        isConnectedRef.current = true;
        console.debug('Deployment WebSocket connected');
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        isConnectedRef.current = false;
        if (intentionalCloseRef.current || wsRef.current !== ws) {
          return; // deliberately closed or superseded — no reconnect, no noise
        }
        console.debug('Deployment WebSocket closed');

        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        if (intentionalCloseRef.current || wsRef.current !== ws) {
          return;
        }
        console.error('Deployment WebSocket error:', error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to connect to deployment WebSocket:', error);
    }
  }, [url, handleMessage, autoReconnect, reconnectInterval]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectedRef.current = false;
  }, []);

  // Auto-connect on mount only
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isConnected: isConnectedRef.current,
    connect,
    disconnect,
  };
}
