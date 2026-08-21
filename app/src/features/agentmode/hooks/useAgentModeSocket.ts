/**
 * @file useAgentModeSocket.ts
 * @description Streams `agent:*` events from the A2A WebSocket into the store.
 *              In demo mode no socket is opened — a scripted plan is replayed
 *              instead so the page is fully functional in the demo build.
 * @feature agentmode
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getWebSocketUrl } from '@/shared/utils/websocket';
import { useAgentModeStore } from '../store/agentmodeStore';
import { usePatrolStore } from '@/features/patrol/store/patrolStore';
import { isAgentModeEvent } from '../types/agentmode.types';
import type { AgentPlan } from '../types/agentmode.types';

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

const RECONNECT_DELAY_MS = 3_000;
const MAX_RECONNECT_ATTEMPTS = 5;

/** Delay between accepting a command and the first demo plan event. */
const DEMO_PLANNING_DELAY_MS = 350;
/** Trailing pause before the demo plan reports itself finished. */
const DEMO_FINISH_DELAY_MS = 250;

export interface UseAgentModeSocketReturn {
  /** Whether agent events are currently flowing. */
  isConnected: boolean;
  /** Connection error, if any. */
  error: string | null;
  /**
   * Start over after the backoff gave up.
   *
   * `MAX_RECONNECT_ATTEMPTS` is reached after roughly a minute and a half of
   * downtime — a server restart or a laptop that slept through lunch — and the
   * hook then stops on its own. Without a way back, the only cure for a console
   * that says "Offline" for the rest of the shift is a page reload, which is
   * not something an operator should have to know.
   */
  retry: () => void;
}

/** Dev-only debug logging for WebSocket lifecycle events. */
function debugLog(...args: unknown[]): void {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
}

/**
 * Subscribe to Agent Mode events for a robot.
 *
 * @param robotId - Robot to follow; `null` keeps the hook idle
 */
export function useAgentModeSocket(robotId: string | null): UseAgentModeSocketReturn {
  // Actions are pulled once — subscribing to them would re-render on every
  // store write, which is exactly what a high-frequency event stream causes.
  const actions = useMemo(() => {
    const store = useAgentModeStore.getState();
    return {
      applyEvent: store.applyEvent,
      setConnectionStatus: store.setConnectionStatus,
      fetchState: store.fetchState,
    };
  }, []);

  const pendingCommand = useAgentModeStore((state) => state.pendingCommand);
  const estopActive = useAgentModeStore((state) => state.estopActive);

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by `retry` — the effect below reads it as "connect again, now". */
  const [retryNonce, setRetryNonce] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  /**
   * The robot whose event stream this console lost, until it has caught up.
   *
   * Held per robot rather than as a bare flag so a robot switch cannot inherit
   * it: switching already re-reads the state through the page's own effect.
   */
  const droppedForRobotRef = useRef<string | null>(null);

  const retry = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setError(null);
    setRetryNonce((n) => n + 1);
  }, []);

  // --------------------------------------------------------------------------
  // Live socket (never opened in demo mode)
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (IS_DEMO) {
      // Demo build has no server behind it; the plan driver below stands in.
      setIsConnected(true);
      actions.setConnectionStatus('connected');
      return;
    }
    if (!robotId) return;

    mountedRef.current = true;
    let closedByUs = false;

    const connect = () => {
      if (!mountedRef.current) return;
      actions.setConnectionStatus('connecting');

      try {
        const ws = new WebSocket(getWebSocketUrl('/api/a2a/ws'));
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mountedRef.current) return;
          debugLog('Agent Mode WebSocket connected');
          reconnectAttemptsRef.current = 0;
          setIsConnected(true);
          setError(null);
          actions.setConnectionStatus('connected');
          // The server's socket is pure fan-out — nothing is replayed. Every
          // event emitted while this console was away is simply gone, and the
          // ones that matter are the terminal ones: a `agent:block:finished`
          // and an `agent:plan:finished` lost to a server restart leave the
          // rail reading "Running · walk" for the rest of the session, with
          // the 15 s heartbeat keeping the freshness line at "just now" while
          // it carries no `plan` that could correct it. So a socket that comes
          // back after a drop asks what actually happened.
          if (droppedForRobotRef.current === robotId) {
            droppedForRobotRef.current = null;
            void actions.fetchState(robotId);
          }
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          try {
            const data: unknown = JSON.parse(event.data);
            if (isAgentModeEvent(data)) {
              actions.applyEvent(data);
              // TASK-212: patrol/finding events also feed the patrol store so
              // the map overlay and the announcer see them without a second
              // socket. The patrol store ignores every other type itself.
              usePatrolStore.getState().applyEvent(data);
            }
          } catch (err) {
            console.error('Failed to parse Agent Mode event:', err);
          }
        };

        ws.onclose = () => {
          // Close events arrive async: a superseded socket (robot switch,
          // StrictMode remount) must not clobber the live socket's ref —
          // cleanup would then never close it — nor schedule a reconnect.
          if (wsRef.current !== ws) return;
          wsRef.current = null;
          if (!mountedRef.current || closedByUs) return;
          setIsConnected(false);
          actions.setConnectionStatus('disconnected');
          // A gap starts here, whether the reconnect below succeeds on the
          // first try or an hour later. What was missed is only knowable by
          // asking again once the stream is back.
          droppedForRobotRef.current = robotId;

          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current += 1;
            const backoff = Math.min(
              RECONNECT_DELAY_MS * 2 ** (reconnectAttemptsRef.current - 1),
              60_000
            );
            reconnectTimeoutRef.current = setTimeout(connect, backoff);
          } else {
            setError('Max reconnection attempts reached');
            actions.setConnectionStatus('error');
          }
        };

        ws.onerror = () => {
          // A socket closed during its handshake (cleanup/unmount) also fires
          // an error event — only surface errors for the live socket.
          if (closedByUs || wsRef.current !== ws) return;
          if (mountedRef.current) setError('WebSocket connection error');
        };
      } catch (err) {
        console.error('Failed to create Agent Mode WebSocket:', err);
        setError(err instanceof Error ? err.message : 'Failed to connect');
        actions.setConnectionStatus('error');
      }
    };

    connect();

    return () => {
      mountedRef.current = false;
      closedByUs = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      actions.setConnectionStatus('disconnected');
    };
  }, [robotId, actions, retryNonce]);

  // --------------------------------------------------------------------------
  // Demo plan driver — replays a realistic plan for an accepted command.
  // A latched E-Stop tears the timers down through this effect's cleanup.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!IS_DEMO || !robotId || !pendingCommand || estopActive) return;
    if (pendingCommand.robotId !== robotId) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (delay: number, fn: () => void) => {
      timers.push(
        setTimeout(() => {
          if (!cancelled) fn();
        }, delay)
      );
    };

    void (async () => {
      const demo = await import('@/mocks/agentModeDemoData');
      if (cancelled) return;

      const { plan, timings, results, lookIndex } = demo.buildDemoPlan(
        robotId,
        pendingCommand.text,
        pendingCommand.planId
      );

      let offset = DEMO_PLANNING_DELAY_MS;

      at(offset, () =>
        actions.applyEvent({
          type: 'agent:plan:started',
          robotId,
          plan,
          timestamp: new Date().toISOString(),
        })
      );

      plan.blocks.forEach((block, index) => {
        at(offset, () =>
          actions.applyEvent({
            type: 'agent:block:started',
            robotId,
            block: { ...block, status: 'running', startedAt: new Date().toISOString() },
            timestamp: new Date().toISOString(),
          })
        );

        offset += timings[index];

        at(offset, () =>
          actions.applyEvent({
            type: 'agent:block:finished',
            robotId,
            block: {
              ...block,
              status: 'done',
              finishedAt: new Date().toISOString(),
              result: results[index],
            },
            timestamp: new Date().toISOString(),
          })
        );

        if (index === lookIndex) {
          at(offset, () =>
            actions.applyEvent({
              type: 'agent:scene:updated',
              robotId,
              scene: demo.createDemoSceneAfterLook(robotId),
              timestamp: new Date().toISOString(),
            })
          );
        }
      });

      offset += DEMO_FINISH_DELAY_MS;

      at(offset, () => {
        // Read the live plan back so the per-block timestamps the UI already
        // rendered survive the final replace.
        const current = useAgentModeStore.getState().plan;
        if (!current || current.id !== plan.id) return;
        const finished: AgentPlan = {
          ...current,
          status: 'done',
          cursor: -1,
          updatedAt: new Date().toISOString(),
        };
        actions.applyEvent({
          type: 'agent:plan:finished',
          robotId,
          plan: finished,
          timestamp: new Date().toISOString(),
        });
      });
    })();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [robotId, pendingCommand, estopActive, actions]);

  return { isConnected, error, retry };
}
