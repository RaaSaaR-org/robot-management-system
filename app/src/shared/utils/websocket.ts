/**
 * @file websocket.ts
 * @description WebSocket URL utilities for dynamic URL generation
 * @feature shared
 */

/**
 * Get WebSocket URL based on current page location.
 * Uses wss:// for HTTPS, ws:// for HTTP.
 * This enables cross-device access by connecting to the same host the page was loaded from.
 *
 * @param path - WebSocket path (default: '/api/a2a/ws')
 * @returns WebSocket URL
 *
 * @example
 * ```ts
 * const wsUrl = getWebSocketUrl();
 * // If page is at http://192.168.178.67/, returns ws://192.168.178.67/api/a2a/ws
 * // If page is at https://robomind.local/, returns wss://robomind.local/api/a2a/ws
 * ```
 */
export function getWebSocketUrl(path: string = '/api/a2a/ws'): string {
  // Allow override via environment variable
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  // Fallback for SSR or test environments
  if (typeof window === 'undefined') {
    return `ws://localhost:3001${path}`;
  }

  // Dynamic URL based on current host
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}
