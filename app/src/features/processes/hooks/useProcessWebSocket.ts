/**
 * @file useProcessWebSocket.ts
 * @description WebSocket hook for real-time process updates
 * @feature processes
 */

import { useEffect, useRef, useCallback } from 'react';
import { useTasksStore } from '../store/tasksStore';
import type { Process, ProcessStep } from '../types';
import { getWebSocketUrl } from '@/shared/utils/websocket';

// ============================================================================
// TYPES
// ============================================================================

interface ProcessWebSocketEvent {
  type:
    | 'process:created'
    | 'process:updated'
    | 'process:completed'
    | 'process:failed'
    | 'step:started'
    | 'step:completed'
    | 'step:failed'
    | 'step:reassigned'
    | 'connected';
  processInstance?: ProcessInstance;
  processInstanceId?: string;
  stepInstance?: StepInstance;
  error?: string;
  timestamp?: number;
}

// Server-side types (mapped to frontend types)
interface ProcessInstance {
  id: string;
  processName: string;
  description?: string;
  status: string;
  priority: string;
  progress: number;
  currentStepIndex: number;
  steps: StepInstance[];
  assignedRobotIds: string[];
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  createdAt: string;
  createdBy: string;
}

interface StepInstance {
  id: string;
  processInstanceId: string;
  name: string;
  description?: string;
  status: string;
  order: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

interface UseProcessWebSocketOptions {
  /** Process ID to filter events for (optional) */
  processId?: string;
  /** WebSocket server URL */
  url?: string;
  /** Enable auto-reconnect */
  autoReconnect?: boolean;
  /** Reconnect interval in ms */
  reconnectInterval?: number;
  /** Enable/disable the hook */
  enabled?: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Transform server ProcessInstance to frontend Process
 */
function transformProcessInstance(instance: ProcessInstance): Process {
  return {
    id: instance.id,
    name: instance.processName,
    description: instance.description,
    status: instance.status as Process['status'],
    priority: instance.priority as Process['priority'],
    progress: instance.progress,
    currentStepIndex: instance.currentStepIndex,
    steps: instance.steps.map((step) => ({
      id: step.id,
      name: step.name,
      description: step.description,
      status: step.status as ProcessStep['status'],
      order: step.order,
      error: step.error,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
    })),
    robotId: instance.assignedRobotIds?.[0] || '',
    error: instance.errorMessage,
    startedAt: instance.startedAt,
    completedAt: instance.completedAt,
    updatedAt: instance.updatedAt,
    createdAt: instance.createdAt,
    createdBy: instance.createdBy,
  };
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for subscribing to real-time process updates via WebSocket
 *
 * @example
 * ```tsx
 * // Subscribe to all process updates
 * useProcessWebSocket();
 *
 * // Subscribe to updates for a specific process
 * useProcessWebSocket({ processId: 'abc-123' });
 * ```
 */
export function useProcessWebSocket(options: UseProcessWebSocketOptions = {}) {
  const {
    processId,
    url = getWebSocketUrl(),
    autoReconnect = true,
    reconnectInterval = 5000,
    enabled = true,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isConnectedRef = useRef(false);

  // Get store actions
  const updateProcessFromWebSocket = useTasksStore((s) => s.updateProcessFromWebSocket);

  // Handle incoming messages
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data: ProcessWebSocketEvent = JSON.parse(event.data);

        // Skip non-process events
        if (!data.type.startsWith('process:') && !data.type.startsWith('step:')) {
          return;
        }

        // Filter by process ID if specified
        if (processId) {
          const eventProcessId = data.processInstance?.id || data.processInstanceId;
          if (eventProcessId && eventProcessId !== processId) {
            return;
          }
        }

        switch (data.type) {
          case 'process:created':
          case 'process:updated':
          case 'process:completed':
          case 'process:failed':
            if (data.processInstance) {
              console.log(`[ProcessWebSocket] ${data.type}:`, data.processInstance.processName);
              const process = transformProcessInstance(data.processInstance);
              updateProcessFromWebSocket(process);
            }
            break;

          case 'step:started':
          case 'step:completed':
          case 'step:failed':
          case 'step:reassigned':
            // Step events include the updated process instance
            if (data.processInstance) {
              console.log(`[ProcessWebSocket] ${data.type}:`, data.stepInstance?.name);
              const process = transformProcessInstance(data.processInstance);
              updateProcessFromWebSocket(process);
            }
            break;

          default:
            break;
        }
      } catch (error) {
        console.error('[ProcessWebSocket] Failed to parse message:', error);
      }
    },
    [processId, updateProcessFromWebSocket]
  );

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      console.log('[ProcessWebSocket] Connecting to', url);
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('[ProcessWebSocket] Connected');
        isConnectedRef.current = true;
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        console.log('[ProcessWebSocket] Disconnected');
        isConnectedRef.current = false;
        wsRef.current = null;

        // Auto-reconnect
        if (autoReconnect && enabled) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[ProcessWebSocket] Attempting to reconnect...');
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        console.error('[ProcessWebSocket] Error:', error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[ProcessWebSocket] Failed to connect:', error);
    }
  }, [url, handleMessage, autoReconnect, reconnectInterval, enabled]);

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
    if (enabled) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [connect, disconnect, enabled]);

  return {
    isConnected: isConnectedRef.current,
    connect,
    disconnect,
  };
}
