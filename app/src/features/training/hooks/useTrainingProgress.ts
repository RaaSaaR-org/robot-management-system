/**
 * @file useTrainingProgress.ts
 * @description React hook for real-time training progress via WebSocket
 * @feature training
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useTrainingStore } from '../store';
import type { TrainingJobEvent, JobProgress } from '../types';
import { getWebSocketUrl } from '@/shared/utils/websocket';

export interface UseTrainingProgressReturn {
  isConnected: boolean;
  reconnect: () => void;
}

/**
 * Hook for subscribing to real-time training progress updates via WebSocket
 *
 * @example
 * ```tsx
 * function TrainingPage() {
 *   const { isConnected } = useTrainingProgress();
 *
 *   return (
 *     <div>
 *       <span>WebSocket: {isConnected ? 'Connected' : 'Disconnected'}</span>
 *       <TrainingJobList />
 *     </div>
 *   );
 * }
 * ```
 */
export function useTrainingProgress(): UseTrainingProgressReturn {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const handleEvent = useTrainingStore((state) => state.handleTrainingEvent);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log('[TrainingProgress] WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Check if this is a training event
          if (data.type?.startsWith('training:job:')) {
            handleEvent(data as TrainingJobEvent);
          }
        } catch (error) {
          console.error('[TrainingProgress] Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log('[TrainingProgress] WebSocket disconnected');

        // Auto-reconnect after 5 seconds
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 5000);
      };

      ws.onerror = (error) => {
        console.error('[TrainingProgress] WebSocket error:', error);
      };
    } catch (error) {
      console.error('[TrainingProgress] Failed to create WebSocket:', error);
    }
  }, [handleEvent]);

  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { isConnected, reconnect };
}

/**
 * Hook for subscribing to progress updates for a specific job
 */
export function useJobProgress(jobId: string): JobProgress | null {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const activeJobProgress = useTrainingStore((state) => state.activeJobProgress);
  const activeJob = useTrainingStore((state) => state.activeJob);

  // Get progress from store if this is the active job
  useEffect(() => {
    if (activeJob?.id === jobId && activeJobProgress) {
      setProgress(activeJobProgress);
    }
  }, [activeJob, activeJobProgress, jobId]);

  return progress;
}
