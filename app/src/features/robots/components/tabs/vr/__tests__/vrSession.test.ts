/**
 * @file vrSession.test.ts
 * @description Tests for the teleop link: liveness classification, the E-Stop
 *              send order, the streaming gate, and the reconnecting socket.
 * @feature robots
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  linkState,
  estopSequence,
  shouldStream,
  createTeleopLink,
  LINK_STALE_AFTER_MS,
  LINK_LOST_AFTER_MS,
  RECONNECT_BACKOFF_MS,
  STOP_FRAME,
  ESTOP_REASON,
  type LinkStatus,
  type TeleopSocketLike,
} from '../vrSession';

describe('linkState', () => {
  it('is live inside the fresh window', () => {
    expect(linkState(1000, 1000)).toBe('live');
    expect(linkState(1000 + LINK_STALE_AFTER_MS - 1, 1000)).toBe('live');
  });

  it('is stale from the stale boundary', () => {
    expect(linkState(1000 + LINK_STALE_AFTER_MS, 1000)).toBe('stale');
    expect(linkState(1000 + LINK_LOST_AFTER_MS - 1, 1000)).toBe('stale');
  });

  it('is lost from the lost boundary', () => {
    expect(linkState(1000 + LINK_LOST_AFTER_MS, 1000)).toBe('lost');
    expect(linkState(1e9, 1000)).toBe('lost');
  });

  it('is LOST when no state message has ever arrived — fail-safe, not optimistic', () => {
    expect(linkState(1000, null)).toBe('lost');
    expect(linkState(1000, undefined)).toBe('lost');
    expect(linkState(1000, Number.NaN)).toBe('lost');
  });

  it('does not call a backwards clock a dead link', () => {
    expect(linkState(500, 1000)).toBe('live');
  });

  it('handles a non-finite now', () => {
    expect(linkState(Number.NaN, 1000)).toBe('lost');
  });
});

describe('shouldStream', () => {
  it('streams only on an open, unlatched link', () => {
    expect(shouldStream({ estopLatched: false, status: 'open' })).toBe(true);
  });

  it('stops the moment an E-Stop is latched', () => {
    // The agent DISCARDS teleop input once latched and answers
    // {type:'error', code:'estop_latched'} — one refusal per frame otherwise.
    expect(shouldStream({ estopLatched: true, status: 'open' })).toBe(false);
  });

  it('does not stream on a link that is not open', () => {
    for (const status of ['connecting', 'closed', 'error'] as LinkStatus[]) {
      expect(shouldStream({ estopLatched: false, status })).toBe(false);
    }
  });
});

describe('estopSequence', () => {
  it('sends the zero-move frame FIRST, then the estop, on the same socket', async () => {
    const sent: unknown[] = [];
    await estopSequence((p) => sent.push(p));
    expect(sent).toEqual([STOP_FRAME, { estop: { reason: ESTOP_REASON } }]);
  });

  it('carries a caller-supplied reason', async () => {
    const sent: unknown[] = [];
    await estopSequence((p) => sent.push(p), undefined, 'operator pressed both grips');
    expect(sent[1]).toEqual({ estop: { reason: 'operator pressed both grips' } });
  });

  it('does not wait for the REST call before writing to the socket', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const rest = () =>
      new Promise<void>((resolve) => {
        order.push('rest-started');
        release = () => {
          order.push('rest-finished');
          resolve();
        };
      });
    const promise = estopSequence(() => order.push('socket'), rest);
    // Both socket frames are already out while the REST call is still pending.
    expect(order).toEqual(['socket', 'socket', 'rest-started']);
    release();
    await promise;
    expect(order).toEqual(['socket', 'socket', 'rest-started', 'rest-finished']);
  });

  it('a failing REST call never affects the socket frames', async () => {
    const sent: unknown[] = [];
    const r = await estopSequence(
      (p) => sent.push(p),
      () => Promise.reject(new Error('unreachable from the headset')),
    );
    expect(sent).toHaveLength(2);
    expect(r).toEqual({ socket: 'sent', rest: 'failed' });
  });

  it('a dead socket never stops the REST alert from being raised', async () => {
    const rest = vi.fn(() => Promise.resolve());
    const r = await estopSequence(() => {
      throw new Error('socket closed');
    }, rest);
    expect(rest).toHaveBeenCalledOnce();
    expect(r).toEqual({ socket: 'failed', rest: 'ok' });
  });

  it('reports a skipped REST call when none was supplied', async () => {
    expect(await estopSequence(() => {})).toEqual({ socket: 'sent', rest: 'skipped' });
  });
});

/** A controllable stand-in for `WebSocket`. */
class FakeSocket implements TeleopSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('createTeleopLink', () => {
  let sockets: FakeSocket[];
  let statuses: LinkStatus[];
  let messages: Array<{ msg: unknown; at: number }>;

  const build = (now = () => 1000) => {
    sockets = [];
    statuses = [];
    messages = [];
    return createTeleopLink({
      url: 'ws://robot/ws/keyboard-teleop',
      onMessage: (msg, at) => messages.push({ msg, at }),
      onStatus: (s) => statuses.push(s),
      now,
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
    });
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports connecting then open, instead of a boolean', () => {
    const link = build();
    link.connect();
    expect(link.status()).toBe('connecting');
    sockets[0].open();
    expect(link.status()).toBe('open');
    expect(statuses).toEqual(['connecting', 'open']);
    link.dispose();
  });

  it('parses inbound frames and timestamps them for linkState', () => {
    const link = build(() => 4242);
    link.connect();
    sockets[0].open();
    sockets[0].onmessage?.({ data: '{"type":"state","positions":{"a":1}}' });
    expect(messages).toEqual([{ msg: { type: 'state', positions: { a: 1 } }, at: 4242 }]);
    expect(link.lastMessageAt()).toBe(4242);
    link.dispose();
  });

  it('survives an unparseable frame without dropping the link', () => {
    const link = build();
    link.connect();
    sockets[0].open();
    expect(() => sockets[0].onmessage?.({ data: 'not json' })).not.toThrow();
    expect(messages).toHaveLength(0);
    expect(link.status()).toBe('open');
    link.dispose();
  });

  it('reconnects with a bounded backoff after a drop', () => {
    const link = build();
    link.connect();
    sockets[0].open();
    sockets[0].drop();
    expect(link.status()).toBe('closed');

    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0] - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    expect(link.status()).toBe('connecting');
    link.dispose();
  });

  it('lengthens the delay while it keeps failing, then caps it', () => {
    const link = build();
    link.connect();
    // Never opens: each attempt closes straight away.
    const expected = [...RECONNECT_BACKOFF_MS, RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1]];
    for (let i = 0; i < expected.length; i += 1) {
      sockets[i].drop();
      vi.advanceTimersByTime(expected[i] - 1);
      expect(sockets).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(i + 2);
    }
    link.dispose();
  });

  it('resets the backoff only after a SUCCESSFUL open', () => {
    const link = build();
    link.connect();
    sockets[0].drop();
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    sockets[1].open();
    sockets[1].drop();
    // Back to the first delay, not the second.
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    expect(sockets).toHaveLength(3);
    link.dispose();
  });

  it('does not schedule two retries for one failure (error THEN close)', () => {
    const link = build();
    link.connect();
    sockets[0].onerror?.();
    expect(link.status()).toBe('error');
    sockets[0].drop();
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0] * 4);
    // One retry, not two — a real WebSocket fires both events for one failure.
    expect(sockets).toHaveLength(2);
    link.dispose();
  });

  it('dispose() cancels a pending retry so the link does not come back after the modal closes', () => {
    const link = build();
    link.connect();
    sockets[0].drop();
    link.dispose();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(link.status()).toBe('closed');
  });

  it('dispose() detaches handlers BEFORE closing, so its own onclose cannot re-arm the retry', () => {
    const link = build();
    link.connect();
    sockets[0].open();
    link.dispose();
    expect(sockets[0].closed).toBe(true);
    expect(sockets[0].onclose).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('is idempotent', () => {
    const link = build();
    link.connect();
    link.dispose();
    expect(() => link.dispose()).not.toThrow();
    link.connect();
    expect(sockets).toHaveLength(1);
  });

  it('IGNORES a stale socket\'s handlers — React StrictMode double-mounts', () => {
    // The guard that exists because a previous, closing socket's async onclose
    // could otherwise fire AFTER the live socket was installed and tear it down,
    // leaving the UI "connected" while every send silently no-opped.
    const link = build();
    link.connect();
    const first = sockets[0];
    first.drop();
    vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    const second = sockets[1];
    second.open();
    expect(link.status()).toBe('open');

    first.onclose?.();
    first.onerror?.();
    first.onmessage?.({ data: '{"stale":true}' });
    expect(link.status()).toBe('open');
    expect(messages).toHaveLength(0);
    link.dispose();
  });

  it('send() serialises only on an open socket', () => {
    const link = build();
    link.connect();
    expect(link.send({ a: 1 })).toBe(false); // still connecting
    sockets[0].open();
    expect(link.send({ positions: { a: 1 } })).toBe(true);
    expect(sockets[0].sent).toEqual(['{"positions":{"a":1}}']);
    link.dispose();
    expect(link.send({ a: 1 })).toBe(false);
  });

  it('send() returns false rather than throwing when the socket throws', () => {
    const link = build();
    link.connect();
    sockets[0].open();
    sockets[0].send = () => {
      throw new Error('closing');
    };
    expect(link.send({ a: 1 })).toBe(false);
    link.dispose();
  });

  it('reports error and retries when the socket constructor throws', () => {
    const seen: LinkStatus[] = [];
    const link = createTeleopLink({
      url: 'not a url',
      onMessage: () => {},
      onStatus: (s) => seen.push(s),
      socketFactory: () => {
        throw new Error('SyntaxError');
      },
    });
    link.connect();
    expect(seen).toEqual(['connecting', 'error']);
    expect(() => vi.advanceTimersByTime(RECONNECT_BACKOFF_MS[0])).not.toThrow();
    link.dispose();
  });

  it('a second connect() while one is live is a no-op', () => {
    const link = build();
    link.connect();
    link.connect();
    expect(sockets).toHaveLength(1);
    link.dispose();
  });
});
