/**
 * @file sessionWatch.test.ts
 * @description The watching socket (TASK-414): watch on open and every 10 s,
 *              watch again after `auth`, operator states only once the server
 *              acknowledged the watch, unwatch on close, reconnect on a drop.
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openSessionWatch, WATCH_INTERVAL_MS, WATCH_RECONNECT_MS, type OperatorState } from '../sessionWatch';

class FakeSocket {
  readyState = 0;
  bufferedAmount = 0;
  sent: Array<Record<string, unknown>> = [];
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close = vi.fn(() => {
    this.readyState = 3;
    this.fire('close', {});
  });
  fire(type: string, e: unknown) {
    (this.listeners[type] ?? []).forEach((fn) => fn(e));
  }
  open() {
    this.readyState = 1;
    this.fire('open', {});
  }
  receive(body: unknown) {
    this.fire('message', { data: JSON.stringify(body) });
  }
  types() {
    return this.sent.map((m) => m.type);
  }
}

const STATE = { inVr: true } as unknown as OperatorState;

describe('openSessionWatch', () => {
  let sockets: FakeSocket[];
  const open = () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as WebSocket;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
  });
  afterEach(() => vi.useRealTimers());

  it('watches on open, again every 10 s and after auth; unwatches on close', () => {
    const w = openSessionWatch({ sessionId: 's1', role: 'assistant', displayName: 'Ben' }, { open, url: 'ws://x' });
    const s = sockets[0];
    s.open();
    expect(s.sent[0]).toEqual({ type: 'teleop:watch', sessionId: 's1', role: 'assistant', displayName: 'Ben' });
    vi.advanceTimersByTime(WATCH_INTERVAL_MS);
    s.receive({ type: 'auth', authenticated: true });
    expect(s.types()).toEqual(['teleop:watch', 'teleop:watch', 'teleop:watch']);
    w.close();
    expect(s.sent[s.sent.length - 1]).toEqual({ type: 'teleop:unwatch', sessionId: 's1' });
    expect(s.close).toHaveBeenCalled();
    vi.advanceTimersByTime(WATCH_RECONNECT_MS * 2);
    expect(sockets).toHaveLength(1);
  });

  it('sends operator states only once the watch is acknowledged', () => {
    const w = openSessionWatch({ sessionId: 's1', role: 'operator' }, { open, url: 'ws://x' });
    const s = sockets[0];
    s.open();
    expect(w.sendOperator(STATE)).toBe(false);
    s.receive({ type: 'teleop:watched', sessionId: 's1', role: 'operator' });
    expect(w.isWatched()).toBe(true);
    expect(w.sendOperator(STATE)).toBe(true);
    expect(s.sent[s.sent.length - 1]).toEqual({ type: 'teleop:operator', sessionId: 's1', state: STATE });
    s.receive({ type: 'teleop:watch:rejected', sessionId: 's1', error: 'forbidden' });
    expect(w.sendOperator(STATE)).toBe(false);
  });

  it('reconnects after a drop and watches again', () => {
    const w = openSessionWatch({ sessionId: 's1', role: 'assistant' }, { open, url: 'ws://x' });
    sockets[0].open();
    sockets[0].readyState = 3;
    sockets[0].fire('close', {});
    vi.advanceTimersByTime(WATCH_RECONNECT_MS);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(sockets[1].types()).toEqual(['teleop:watch']);
    w.close();
  });
});
