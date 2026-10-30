/**
 * @file useLeaseTake.ts
 * @description "Take control" for the session page's Set up step 2 (TASK-427),
 *              on a VR session whose page holds no lease of its own (TASK-396:
 *              only the simulated input joins it). The press is the only thing
 *              that opens the page's lease socket: `wanted` turns it on, then
 *              the lease is taken and the promise resolves true once the robot
 *              confirms it — the same flow the robot's Teleop tab runs for its
 *              readiness panel (TASK-419 D3). The socket moves nothing.
 *
 *              The server never preempts a held lease, so the page has to give
 *              it back for the operator to take control in the headset:
 *              `release()` does (the step's Release button), and
 *              `useLeaseHandOver` does it on its own the moment the hand-over
 *              is due (arm control on and the robot balancing, so only the
 *              operator still needs control).
 * @feature datacollection
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseControlLeaseReturn } from '../../robots/hooks/useControlLease';

/** How long the page waits for its lease socket to open, ms. */
export const TAKE_CONNECT_MS = 5_000;
/** How long it waits for the robot to confirm the lease, ms. */
export const TAKE_BIND_MS = 5_000;

type LeaseView = Pick<UseControlLeaseReturn, 'state' | 'notice' | 'acquire' | 'release'>;

export interface UseLeaseTakeReturn {
  /** The user pressed Take control: the page's lease socket stays open from now on. */
  wanted: boolean;
  /** Hand the hook this render's lease and socket state (call on every render). */
  sync(lease: LeaseView, connected: boolean): void;
  /** Open the socket if needed, take the lease, resolve true once bound. */
  take(): Promise<boolean>;
  /** Give the lease back and close the page's lease socket. Idempotent. */
  release(): void;
}

const until = (ok: () => boolean, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (ok()) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, 100);
    };
    tick();
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useLeaseTake(): UseLeaseTakeReturn {
  const [wanted, setWanted] = useState(false);
  const leaseRef = useRef<LeaseView | null>(null);
  const connectedRef = useRef(false);

  const sync = useCallback((lease: LeaseView, connected: boolean) => {
    leaseRef.current = lease;
    connectedRef.current = connected;
  }, []);

  const take = useCallback(async (): Promise<boolean> => {
    // Read through a function: the ref changes between awaits.
    const state = (): string | undefined => leaseRef.current?.state;
    if (state() === 'bound') return true;
    setWanted(true);
    if (!(await until(() => connectedRef.current, TAKE_CONNECT_MS))) return false;
    // The lease hook learns of the socket on open; give it one render to see it.
    await sleep(50);
    const lease = leaseRef.current;
    if (!lease) return false;
    await lease.acquire();
    await sleep(50);
    await until(
      () => state() === 'bound' || (state() === 'observing' && leaseRef.current?.notice !== null),
      TAKE_BIND_MS,
    );
    return state() === 'bound';
  }, []);

  const release = useCallback(() => {
    setWanted(false);
    leaseRef.current?.release();
  }, []);

  return { wanted, sync, take, release };
}

/**
 * Give the page's lease back once, when the hand-over becomes due (TASK-427).
 * Fires on the edge of `due` only, so a lease the user takes again on purpose
 * afterwards stays theirs (the step shows it, with Release) instead of being
 * pulled from under them.
 *
 * @param due     the hand-over is due now (the lease's work is done: arm control on, robot balancing)
 * @param holds   the page holds the lease it took through `useLeaseTake`
 * @param handOver releases it (and tells the user)
 */
export function useLeaseHandOver(due: boolean, holds: boolean, handOver: () => void): void {
  const wasDue = useRef(false);
  const handOverRef = useRef(handOver);
  handOverRef.current = handOver;
  useEffect(() => {
    const rising = due && !wasDue.current;
    wasDue.current = due;
    if (rising && holds) handOverRef.current();
  }, [due, holds]);
}
