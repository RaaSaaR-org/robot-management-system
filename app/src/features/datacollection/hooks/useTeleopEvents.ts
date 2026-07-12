/**
 * @file useTeleopEvents.ts
 * @description Subscribes to teleop:* events on the app WebSocket
 *              (ws://…/api/a2a/ws) and feeds them into the data collection
 *              store — live frame counts, quality feedback, episode progress,
 *              and completion/export updates. Mirrors useTrainingProgress.
 * @feature datacollection
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { getWebSocketUrl } from '@/shared/utils/websocket';
import { useDataCollectionStore } from '../store/datacollectionStore';
import type { TeleopWsEvent } from '../types/datacollection.types';

export interface UseTeleopEventsReturn {
  isConnected: boolean;
  reconnect: () => void;
}

/**
 * Hook for subscribing to real-time teleoperation session events.
 * Auto-reconnects after 5 seconds when the connection drops. Consumers should
 * fall back to REST polling while `isConnected` is false.
 */
export function useTeleopEvents(): UseTeleopEventsReturn {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  // Distinguishes our own close() (unmount / reconnect swap) from a genuine
  // connection drop, so StrictMode double-mounting stays quiet.
  const intentionalCloseRef = useRef(false);
  const handleEvent = useDataCollectionStore((state) => state.handleTeleopEvent);

  const connect = useCallback(() => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') {
      return; // WebSocket disabled in demo mode
    }

    if (wsRef.current) {
      intentionalCloseRef.current = true;
      wsRef.current.close();
    }
    intentionalCloseRef.current = false;

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (typeof data.type === 'string' && data.type.startsWith('teleop:')) {
            handleEvent(data as TeleopWsEvent);
          }
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (intentionalCloseRef.current || wsRef.current !== ws) {
          return; // deliberately closed or superseded
        }
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 5000);
      };

      ws.onerror = () => {
        /* onclose fires next and handles reconnect */
      };
    } catch {
      /* WebSocket construction failed — consumer polls instead */
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
        intentionalCloseRef.current = true;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { isConnected, reconnect };
}
