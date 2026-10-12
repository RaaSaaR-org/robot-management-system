/**
 * @file openServerSocket.test.ts
 * @description The event socket identifies itself with a fresh token and recovers from a rejection (TASK-366)
 * @feature shared
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { tokenStorage } from '@/api/client';
import { openServerSocket } from '../websocket';

/** A JWT-shaped token expiring `inSeconds` from now (the signature is never checked here). */
function jwtExpiringIn(inSeconds: number, tag: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: tag, exp: Math.floor(Date.now() / 1000) + inSeconds })}.sig`;
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = 1;
    this.listeners.open?.forEach((fn) => fn({}));
  }
  receive(msg: object) {
    this.listeners.message?.forEach((fn) => fn({ data: JSON.stringify(msg) }));
  }
  close() {
    this.readyState = 3;
    this.listeners.close?.forEach((fn) => fn({}));
  }
  authTokens(): string[] {
    return this.sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'auth').map((m) => m.token);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('openServerSocket', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('sends a still-valid token as is, without refreshing', async () => {
    const valid = jwtExpiringIn(600, 'valid');
    tokenStorage.setTokens(valid, 'refresh-1');
    const post = vi.spyOn(axios, 'post');
    const ws = openServerSocket('ws://test') as unknown as FakeSocket;
    ws.open();
    await flush();
    expect(ws.authTokens()).toEqual([valid]);
    expect(post).not.toHaveBeenCalled();
  });

  it('refreshes an expired token before the first auth frame', async () => {
    tokenStorage.setTokens(jwtExpiringIn(-60, 'expired'), 'refresh-1');
    const fresh = jwtExpiringIn(900, 'fresh');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: fresh, refreshToken: 'refresh-2' } });
    const ws = openServerSocket('ws://test') as unknown as FakeSocket;
    ws.open();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toEqual({ refreshToken: 'refresh-1' });
    expect(ws.authTokens()).toEqual([fresh]);
  });

  it('shares one refresh between sockets opening together', async () => {
    tokenStorage.setTokens(jwtExpiringIn(-60, 'expired'), 'refresh-1');
    const fresh = jwtExpiringIn(900, 'fresh');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: fresh, refreshToken: 'refresh-2' } });
    const a = openServerSocket('ws://test') as unknown as FakeSocket;
    const b = openServerSocket('ws://test') as unknown as FakeSocket;
    a.open();
    b.open();
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(a.authTokens()).toEqual([fresh]);
    expect(b.authTokens()).toEqual([fresh]);
  });

  it('refreshes once and re-authenticates when the server rejects the token', async () => {
    const stale = jwtExpiringIn(600, 'stale'); // valid by the client's clock, rejected by the server
    tokenStorage.setTokens(stale, 'refresh-1');
    const fresh = jwtExpiringIn(900, 'fresh');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: fresh, refreshToken: 'refresh-2' } });
    const ws = openServerSocket('ws://test') as unknown as FakeSocket;
    ws.open();
    await flush();
    ws.receive({ type: 'auth', authenticated: false, error: 'invalid_token' });
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(ws.authTokens()).toEqual([stale, fresh]);

    // A second rejection in a row does not loop.
    ws.receive({ type: 'auth', authenticated: false, error: 'invalid_token' });
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('ends quietly when the refresh token itself is rejected', async () => {
    tokenStorage.setTokens(jwtExpiringIn(600, 'stale'), 'refresh-1');
    const rejected = Object.assign(new Error('401'), { isAxiosError: true, response: { status: 401 } });
    vi.spyOn(axios, 'post').mockRejectedValue(rejected);
    const ws = openServerSocket('ws://test') as unknown as FakeSocket;
    ws.open();
    await flush();
    ws.receive({ type: 'auth', authenticated: false, error: 'invalid_token' });
    await flush();
    expect(ws.authTokens()).toHaveLength(1);
    expect(tokenStorage.getAccessToken()).toBeNull();
  });

  it('re-identifies an open socket when the token is refreshed elsewhere, and stops after close', async () => {
    const first = jwtExpiringIn(600, 'first');
    tokenStorage.setTokens(first, 'refresh-1');
    const ws = openServerSocket('ws://test') as unknown as FakeSocket;
    ws.open();
    await flush();
    const second = jwtExpiringIn(900, 'second');
    tokenStorage.setTokens(second, 'refresh-2');
    expect(ws.authTokens()).toEqual([first, second]);
    ws.close();
    tokenStorage.setTokens(jwtExpiringIn(900, 'third'), 'refresh-3');
    expect(ws.authTokens()).toEqual([first, second]);
  });

  it('sends nothing when signed out (auth disabled)', async () => {
    const post = vi.spyOn(axios, 'post');
    const ws = openServerSocket('ws://test') as unknown as FakeSocket;
    ws.open();
    await flush();
    expect(ws.sent).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });
});
