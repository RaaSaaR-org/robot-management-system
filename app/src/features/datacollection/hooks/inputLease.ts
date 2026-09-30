/**
 * @file inputLease.ts
 * @description Joins a data-collection input socket (gamepad, simulated VR)
 *              to the session page's control lease (TASK-320). The socket
 *              binds with `bindSocket` once the page's lease is bound, may
 *              drive only after the agent answers `bound` on that socket, and
 *              goes quiet on `revoked` / `expired` / a refused bind or when
 *              the page's lease ends. It never acquires a lease on its own.
 * @feature datacollection
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { LeaseSocket, UseControlLeaseReturn } from '../../robots/hooks/useControlLease';

/** The part of the page's `useControlLease` an input hook needs. */
export type InputLease = Pick<UseControlLeaseReturn, 'enabled' | 'state' | 'bindSocket'>;

/** The part of a WebSocket the gate touches, so tests can pass a fake. */
export interface GateSocket {
  readonly readyState: number;
  send(data: string): void;
}

const OPEN = 1;

interface Entry {
  ws: GateSocket;
  /** A bind frame went out for the page's current lease. */
  bindSent: boolean;
  /** The agent answered `bound` on this socket. */
  bound: boolean;
}

export interface InputLeaseGate {
  /** The socket opened: bind it now if the page already holds the lease. */
  attach(ws: GateSocket): void;
  /** The socket closed or the input stopped. */
  detach(ws: GateSocket): void;
  /** Feed every parsed message through; true when it was a lease message. */
  handleMessage(ws: GateSocket, msg: unknown): boolean;
  /**
   * Whether a motion frame may go out on `ws`: always with the capability off
   * (or no lease given), otherwise only while this socket is bound.
   */
  canDrive(ws: GateSocket): boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toLeaseSocket(ws: GateSocket): LeaseSocket {
  return {
    send: (payload) => {
      if (ws.readyState !== OPEN) return false;
      ws.send(JSON.stringify(payload));
      return true;
    },
    isOpen: () => ws.readyState === OPEN,
  };
}

/**
 * One gate per input hook. With `lease` undefined or its capability off every
 * frame is admitted — the hook behaves exactly as it did before leases.
 */
export function useInputLeaseGate(lease: InputLease | undefined): InputLeaseGate {
  const leaseRef = useRef(lease);
  leaseRef.current = lease;
  const entryRef = useRef<Entry | null>(null);

  const tryBind = useCallback((entry: Entry) => {
    const l = leaseRef.current;
    if (!l?.enabled || l.state !== 'bound' || entry.bindSent) return;
    if (entry.ws.readyState !== OPEN) return;
    entry.bindSent = l.bindSocket(toLeaseSocket(entry.ws));
  }, []);

  const enabled = lease?.enabled === true;
  const state = lease?.state;

  // Follow the page's lease: join when it is bound, go quiet when it is not.
  // A new lease (the operator took control again) is joined afresh.
  useEffect(() => {
    const entry = entryRef.current;
    if (!entry) return;
    if (enabled && state === 'bound') {
      tryBind(entry);
    } else {
      entry.bindSent = false;
      entry.bound = false;
    }
  }, [enabled, state, tryBind]);

  const attach = useCallback(
    (ws: GateSocket) => {
      const entry: Entry = { ws, bindSent: false, bound: false };
      entryRef.current = entry;
      tryBind(entry);
    },
    [tryBind],
  );

  const detach = useCallback((ws: GateSocket) => {
    if (entryRef.current?.ws === ws) entryRef.current = null;
  }, []);

  const handleMessage = useCallback((ws: GateSocket, msg: unknown): boolean => {
    if (!isRecord(msg)) return false;
    const entry = entryRef.current?.ws === ws ? entryRef.current : null;
    if (msg.type === 'lease') {
      if (!entry) return true;
      if (msg.state === 'bound' && entry.bindSent) entry.bound = true;
      else if (msg.state === 'revoked' || msg.state === 'expired') {
        // Silenced until the operator takes control again; no re-bind here.
        entry.bound = false;
      }
      return true;
    }
    if (msg.type === 'error' && (msg.code === 'lease_invalid' || msg.code === 'lease_required')) {
      if (entry) entry.bound = false;
      return true;
    }
    return false;
  }, []);

  const canDrive = useCallback((ws: GateSocket): boolean => {
    if (!leaseRef.current?.enabled) return true;
    const entry = entryRef.current;
    return !!entry && entry.ws === ws && entry.bound && leaseRef.current.state === 'bound';
  }, []);

  // Stable identity, so a hook can list the gate in its effect's dependencies.
  return useMemo(() => ({ attach, detach, handleMessage, canDrive }), [attach, detach, handleMessage, canDrive]);
}
