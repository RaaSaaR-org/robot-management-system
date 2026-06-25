/**
 * @file useTwinEvents.ts
 * @description Subscribes to digital-twin WebSocket events on the shared a2a
 *   socket (`session:progress`, `twin:ready`, `twin:failed`, `twinZone:*`) and
 *   fans them out to typed callbacks. Mirrors the deployment/training progress
 *   hooks; auto-reconnects, scoped to a single twin id where relevant.
 * @feature digitaltwin
 */

import { useCallback, useEffect, useRef } from 'react';
import { getWebSocketUrl } from '@/shared/utils/websocket';
import type {
  TwinWebSocketEvent,
  SessionProgressEvent,
  TwinReadyEvent,
  TwinFailedEvent,
  TwinZoneCreatedEvent,
  TwinZoneUpdatedEvent,
  TwinZoneDeletedEvent,
} from '../types/twin.types';

export interface UseTwinEventsHandlers {
  /** Only events for this twin id are delivered (others ignored). */
  twinId?: string;
  onSessionProgress?: (event: SessionProgressEvent) => void;
  onTwinReady?: (event: TwinReadyEvent) => void;
  onTwinFailed?: (event: TwinFailedEvent) => void;
  onZoneCreated?: (event: TwinZoneCreatedEvent) => void;
  onZoneUpdated?: (event: TwinZoneUpdatedEvent) => void;
  onZoneDeleted?: (event: TwinZoneDeletedEvent) => void;
}

const TWIN_EVENT_TYPES = new Set([
  'session:progress',
  'twin:ready',
  'twin:failed',
  'twinZone:created',
  'twinZone:updated',
  'twinZone:deleted',
]);

/** Subscribe to twin events. Reconnects automatically; no-op in demo mode. */
export function useTwinEvents(handlers: UseTwinEventsHandlers): { isConnected: boolean } {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedRef = useRef(false);

  // Keep handlers in a ref so the socket isn't torn down on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const handleMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    let data: TwinWebSocketEvent & { twinId?: string };
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!data?.type || !TWIN_EVENT_TYPES.has(data.type)) return;

    const h = handlersRef.current;
    // Twin-scoped filter (when a twinId was provided).
    if (h.twinId && data.twinId && data.twinId !== h.twinId) return;

    switch (data.type) {
      case 'session:progress':
        h.onSessionProgress?.(data);
        break;
      case 'twin:ready':
        h.onTwinReady?.(data);
        break;
      case 'twin:failed':
        h.onTwinFailed?.(data);
        break;
      case 'twinZone:created':
        h.onZoneCreated?.(data);
        break;
      case 'twinZone:updated':
        h.onZoneUpdated?.(data);
        break;
      case 'twinZone:deleted':
        h.onZoneDeleted?.(data);
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (import.meta.env.VITE_DEMO_MODE === 'true') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(getWebSocketUrl());
      ws.onopen = () => {
        connectedRef.current = true;
      };
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        connectedRef.current = false;
        reconnectRef.current = setTimeout(connect, 5000);
      };
      ws.onerror = () => {
        // onclose fires next and schedules a reconnect.
      };
      wsRef.current = ws;
    } catch {
      reconnectRef.current = setTimeout(connect, 5000);
    }
  }, [handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      connectedRef.current = false;
    };
  }, [connect]);

  return { isConnected: connectedRef.current };
}
