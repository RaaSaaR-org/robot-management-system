/**
 * @file websocket.ts
 * @description WebSocket URL utilities for dynamic URL generation
 * @feature shared
 */

/**
 * Get the WebSocket URL for the API server.
 * Uses wss:// for HTTPS, ws:// for HTTP.
 *
 * Resolution order:
 *  1. `VITE_WS_URL` — explicit override, returned verbatim.
 *  2. `VITE_API_BASE_URL` — if it is an absolute http(s) URL, the WebSocket
 *     connects to the same host with `path`. This matters under the Vite dev
 *     server: the page origin (:1420) has no WebSocket endpoint of its own,
 *     so a page-origin URL always fails once with a console warning before
 *     any reconnect reaches the API server.
 *  3. SSR / test environments (no `window`) — `ws://localhost:3001`.
 *  4. Dev without an absolute API base — API server's default dev port
 *     (:3001) on the page's host.
 *  5. Production same-origin deployments — derive from the page origin,
 *     which enables cross-device access via the host the page came from.
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

  // No absolute API base configured. In dev the page origin is the Vite
  // server, which has no WebSocket endpoint of its own — target the API
  // server's default dev port on the same host instead.
  if (import.meta.env.DEV) {
    return `ws://${window.location.hostname}:3001${path}`;
  }

  // Production same-origin deployments: dynamic URL based on current host
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}
