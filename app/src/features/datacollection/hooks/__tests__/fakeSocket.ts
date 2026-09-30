/**
 * @file fakeSocket.ts
 * @description A WebSocket stand-in and a stubbed page lease for the
 *              data-collection input hook tests (TASK-320).
 * @feature datacollection
 */

import { vi } from 'vitest';
import type { LeaseSocket } from '../../../robots/hooks/useControlLease';
import type { InputLease } from '../inputLease';

export class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  static last(): FakeSocket {
    return FakeSocket.instances[FakeSocket.instances.length - 1];
  }
}

/** A page lease stub: `bindSocket` sends the bind frame, as the real hook does. */
export function stubLease(state: InputLease['state'], enabled = true) {
  const bindSocket = vi.fn((socket: LeaseSocket) =>
    socket.send({ bind: { leaseId: 'secret', generation: 7 } }),
  );
  return { enabled, state, bindSocket } satisfies InputLease;
}

export const binds = (ws: FakeSocket) => ws.sent.filter((m) => 'bind' in m);
