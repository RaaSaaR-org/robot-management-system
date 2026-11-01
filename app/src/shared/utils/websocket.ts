/**
 * @file websocket.ts
 * @description WebSocket URL utilities for dynamic URL generation
 * @feature shared
 */

import { ensureFreshAccessToken, onAccessTokenChange, refreshAccessToken } from '@/api/client';

/**
 * Get the WebSocket URL for the API server.
 * Uses wss:// for HTTPS, ws:// for HTTP.
 *
 * Resolution order:
 *  1. `VITE_WS_URL` — explicit override, returned verbatim.
 *  2. `VITE_API_BASE_URL` — if it is an absolute http(s) URL, the WebSocket
 *     connects to the same host with `path`.
 *  3. SSR / test environments (no `window`) — `ws://localhost:3001`.
 *  4. Everything else — the PAGE'S OWN ORIGIN, dev included (TASK-393).
 *
 * Dev used to target `:3001` on the page's host. That made the API server a
 * second port every client had to reach — and a Meta Quest on `adb reverse`
 * reaches exactly one: `localhost:1420` inside the headset is the
 * workstation, `localhost:3001` is the headset. The Vite dev server proxies
 * `/api` with `ws: true` (`vite.config.ts`), so the page origin DOES have a
 * WebSocket endpoint for every `/api/...` path, and on an https page the
 * socket inherits `wss:` instead of being refused as mixed content.
 *
 * @param path - WebSocket path (default: '/api/a2a/ws')
 * @returns WebSocket URL
 *
 * @example
 * ```ts
 * const wsUrl = getWebSocketUrl();
 * // If page is at https://neodem.local/, returns wss://neodem.local/api/a2a/ws
 * ```
 */
export function getWebSocketUrl(path: string = '/api/a2a/ws'): string {
  // Allow override via environment variable
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  // Derive from the configured API base URL when it is absolute
  const apiBase: string | undefined = import.meta.env.VITE_API_BASE_URL;
  if (apiBase && /^https?:\/\//.test(apiBase)) {
    try {
      const api = new URL(apiBase);
      const protocol = api.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${api.host}${path}`;
    } catch {
      // Malformed base URL — fall through to the defaults below.
    }
  }

  // Fallback for SSR or test environments
  if (typeof window === 'undefined') {
    return `ws://localhost:3001${path}`;
  }

  // Same origin: a deployment's reverse proxy, or the Vite dev proxy.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

/**
 * Open a socket to the API server's event stream and identify it (TASK-366).
 *
 * The server sends events only to a socket that proved who it is, and only
 * those its tenant may see. The access token goes in-band as an `auth` frame —
 * never in the URL, where proxies and access logs would keep it (the same rule
 * as the control-lease socket, TASK-318). A socket opened without a token
 * (signed out, or auth disabled) simply sends nothing; under
 * `AUTH_DISABLED=true` the server identifies every socket itself.
 *
 * The access token is short-lived and the HTTP client refreshes it lazily, so
 * after an idle spell the stored one is often expired. The socket therefore:
 *  - refreshes the token before the first `auth` frame when it is (nearly)
 *    expired, sharing the HTTP client's single-flight refresh;
 *  - when the server still rejects the token (`{type:'auth',
 *    authenticated:false}`), refreshes once and authenticates again;
 *  - re-sends `auth` whenever the token is refreshed elsewhere while the
 *    socket is open — the server re-identifies a socket on every `auth` frame.
 *
 * Listeners go on with `addEventListener` before the caller can set its own
 * handlers, so callers' `onopen` / `onmessage` keep working unchanged.
 */
export function openServerSocket(url: string = getWebSocketUrl()): WebSocket {
  const ws = new WebSocket(url);
  if (typeof ws.addEventListener !== 'function') return ws;

  // The refresh before the first frame also fires the token-change listener;
  // the same token goes out once.
  let lastSent: string | null = null;
  const sendAuth = (token: string | null) => {
    // 1 === WebSocket.OPEN (the constant is absent on some test doubles).
    if (!token || token === lastSent || ws.readyState !== 1) return;
    lastSent = token;
    ws.send(JSON.stringify({ type: 'auth', token }));
  };

  // One refresh per rejection streak: a server that keeps rejecting a freshly
  // refreshed token (wrong secret, revoked user) must not cause a loop.
  let retriedAfterRejection = false;
  let unsubscribe: (() => void) | null = null;

  ws.addEventListener('open', () => {
    unsubscribe = onAccessTokenChange((token) => sendAuth(token));
    void ensureFreshAccessToken().then(sendAuth);
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string' || !event.data.includes('"auth"')) return;
    let msg: { type?: unknown; authenticated?: unknown };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg?.type !== 'auth') return;
    if (msg.authenticated === true) {
      retriedAfterRejection = false;
      return;
    }
    if (msg.authenticated !== false || retriedAfterRejection) return;
    retriedAfterRejection = true;
    // A successful refresh re-sends `auth` through the token-change listener.
    refreshAccessToken().catch(() => {
      // Signed out, or the refresh failed: nothing to identify with. The
      // socket stays as the server left it; the next connect tries again.
    });
  });

  ws.addEventListener('close', () => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return ws;
}
