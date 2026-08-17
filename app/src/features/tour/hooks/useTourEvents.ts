/**
 * @file useTourEvents.ts
 * @description Streams `agent:tour:*` events from the A2A WebSocket (the same
 *              fleet-wide `agent:*` fan-out the Agent Mode page listens to) into
 *              the tour store. Fleet-wide by default; pass a robotId to follow
 *              one robot only.
 * @feature tour
 */

import { useEffect, useRef, useState } from 'react';
import { getWebSocketUrl } from '@/shared/utils/websocket';
import { isAgentModeEvent } from '@/features/agentmode/types/agentmode.types';
import type { AgentModeEvent } from '@/features/agentmode/types/agentmode.types';
import { useTourStore } from '../store/tourStore';

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';
const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 5;

/** The event types this hook forwards; everything else on the socket is ignored. */
export const TOUR_EVENT_TYPES: ReadonlySet<AgentModeEvent['type']> = new Set<AgentModeEvent['type']>([
  'agent:tour:started',
  'agent:tour:leg',
  'agent:tour:turn',
  'agent:tour:finished',
]);

/** True for the events the tour store cares about. */
export function isTourEvent(event: AgentModeEvent): boolean {
  return TOUR_EVENT_TYPES.has(event.type);
}

export interface UseTourEventsReturn {
  isConnected: boolean;
  error: string | null;
}

/**
 * Subscribe to live tour events.
 *
 * @param robotId - Follow one robot only; `undefined`/`null` = every robot.
 * @param enabled - Set false to keep the hook idle (e.g. while another socket already forwards).
 */
export function useTourEvents(robotId?: string | null, enabled = true): UseTourEventsReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || IS_DEMO) return;
    let mounted = true;
    let closedByUs = false;
    const applyEvent = useTourStore.getState().applyEvent;

    const connect = () => {
      if (!mounted) return;
      try {
        const ws = new WebSocket(getWebSocketUrl('/api/a2a/ws'));
        wsRef.current = ws;
        ws.onopen = () => {
          if (!mounted) return;
          attemptsRef.current = 0;
          setIsConnected(true);
          setError(null);
        };
        ws.onmessage = (msg) => {
          if (!mounted) return;
          try {
            const data: unknown = JSON.parse(msg.data);
            if (!isAgentModeEvent(data) || !isTourEvent(data)) return;
            if (robotId && data.robotId !== robotId) return;
            applyEvent(data);
          } catch (err) {
            console.error('Failed to parse tour event:', err);
          }
        };
        ws.onclose = () => {
          if (wsRef.current !== ws) return;
          wsRef.current = null;
          if (!mounted || closedByUs) return;
          setIsConnected(false);
          if (attemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            attemptsRef.current += 1;
            const backoff = Math.min(RECONNECT_DELAY_MS * 2 ** (attemptsRef.current - 1), 60_000);
            timerRef.current = setTimeout(connect, backoff);
          } else {
            setError('Max reconnection attempts reached');
          }
        };
        ws.onerror = () => {
          if (closedByUs || wsRef.current !== ws) return;
          if (mounted) setError('WebSocket connection error');
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
      }
    };

    connect();
    return () => {
      mounted = false;
      closedByUs = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
    };
  }, [robotId, enabled]);

  return { isConnected, error };
}
