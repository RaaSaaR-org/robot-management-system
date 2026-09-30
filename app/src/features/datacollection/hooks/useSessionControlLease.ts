/**
 * @file useSessionControlLease.ts
 * @description The session page's one control lease (TASK-320). Wraps
 *              `useControlLease` and, only while the server advertises leases
 *              and the session is live, keeps the page's own agent socket on
 *              `/ws/keyboard-teleop` open as the lease's primary socket — the
 *              one "Take control" binds and renewal rides on. The page's
 *              input sockets (gamepad, simulated VR) join this lease; this
 *              socket itself sends no motion. Capability off: no socket, no
 *              change.
 * @feature datacollection
 */

import { useEffect, useRef, useState } from 'react';
import {
  useControlLease,
  type LeaseSocket,
  type UseControlLeaseOptions,
  type UseControlLeaseReturn,
} from '../../robots/hooks/useControlLease';

export interface UseSessionControlLeaseReturn {
  lease: UseControlLeaseReturn;
  /** The page's lease socket is open — "Take control" needs it to bind. */
  connected: boolean;
}

function agentWsUrl(a2aAgentUrl: string | undefined): string {
  const agent = a2aAgentUrl?.replace(/\/$/, '') ?? 'http://localhost:41243';
  return `${agent.replace(/^http/, 'ws')}/ws/keyboard-teleop`;
}

/**
 * Keyed on the robot's id and agent URL, never the robot object: a store
 * refresh hands out a new object, and reconnecting would release control.
 *
 * @param robotId     the session's robot
 * @param a2aAgentUrl the robot agent's URL (its default port when unset)
 * @param active      the session is live, the robot known, and an input drives it
 */
export function useSessionControlLease(
  robotId: string,
  a2aAgentUrl: string | undefined,
  active: boolean,
  options: UseControlLeaseOptions = {},
): UseSessionControlLeaseReturn {
  const lease = useControlLease(robotId, options);
  const leaseRef = useRef(lease);
  leaseRef.current = lease;
  const [connected, setConnected] = useState(false);

  const enabled = lease.enabled;

  useEffect(() => {
    if (!enabled || !active || !robotId) return;
    let disposed = false;
    const ws = new WebSocket(agentWsUrl(a2aAgentUrl));

    const socket: LeaseSocket = {
      send: (payload) => {
        if (ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(payload));
        return true;
      },
      isOpen: () => ws.readyState === WebSocket.OPEN,
    };

    ws.onopen = () => {
      if (disposed) return;
      leaseRef.current.attachSocket(socket);
      setConnected(true);
    };
    ws.onmessage = (event) => {
      if (disposed) return;
      try {
        leaseRef.current.handleSocketMessage(JSON.parse(String(event.data)));
      } catch {
        /* not JSON */
      }
    };
    const onGone = (): void => {
      if (disposed) return;
      // A closed primary socket ends the lease (and the inputs go quiet with it).
      leaseRef.current.attachSocket(null);
      setConnected(false);
    };
    ws.onclose = onGone;
    ws.onerror = onGone;

    return () => {
      disposed = true;
      // Hand control back on purpose first: no "control lost" banner.
      leaseRef.current.release();
      leaseRef.current.attachSocket(null);
      setConnected(false);
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    };
  }, [enabled, active, robotId, a2aAgentUrl]);

  return { lease, connected };
}
