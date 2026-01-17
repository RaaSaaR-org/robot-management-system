/**
 * @file useDeploymentProgress.ts
 * @description React hook for WebSocket subscription to deployment events
 * @feature deployment
 */

import { useCallback, useEffect, useRef } from 'react';
import { useDeploymentStore } from '../store';
import type { DeploymentEvent } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001/api/a2a/ws';

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
    url = WS_URL,
    autoReconnect = true,
    reconnectInterval = 5000,
    onEvent,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectedRef = useRef(false);

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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        isConnectedRef.current = true;
        console.debug('Deployment WebSocket connected');
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        isConnectedRef.current = false;
        console.debug('Deployment WebSocket closed');

        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
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
