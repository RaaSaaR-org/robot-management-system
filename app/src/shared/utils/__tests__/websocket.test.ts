/**
 * @file websocket.test.ts
 * @description Tests for getWebSocketUrl URL-derivation utility
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { getWebSocketUrl } from '../websocket';

/**
 * Replace window.location with a controllable stub. Returns a restore fn.
 */
function stubLocation(protocol: string, host: string): () => void {
  const original = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { protocol, host } as Location,
  });
  return () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

describe('getWebSocketUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('VITE_WS_URL override', () => {
    it('returns the env override verbatim, ignoring path and location', () => {
      vi.stubEnv('VITE_WS_URL', 'wss://override.example.com/custom/ws');
      const restore = stubLocation('http:', '192.168.1.1:1420');

      expect(getWebSocketUrl('/api/a2a/ws')).toBe(
        'wss://override.example.com/custom/ws'
      );

      restore();
    });

    it('override takes precedence even when window is undefined', () => {
      vi.stubEnv('VITE_WS_URL', 'ws://envhost/path');
      vi.stubGlobal('window', undefined);

      expect(getWebSocketUrl()).toBe('ws://envhost/path');
    });
  });

  describe('SSR / no-window fallback', () => {
    it('falls back to localhost:3001 with the default path when window is undefined', () => {
      vi.stubEnv('VITE_WS_URL', '');
      vi.stubGlobal('window', undefined);

      expect(getWebSocketUrl()).toBe('ws://localhost:3001/api/a2a/ws');
    });

    it('uses the provided path in the SSR fallback', () => {
      vi.stubEnv('VITE_WS_URL', '');
      vi.stubGlobal('window', undefined);

      expect(getWebSocketUrl('/custom/socket')).toBe(
        'ws://localhost:3001/custom/socket'
      );
    });
  });

  describe('dynamic URL from window.location', () => {
    it('uses ws:// for http pages and includes host + default path', () => {
      vi.stubEnv('VITE_WS_URL', '');
      const restore = stubLocation('http:', '192.168.178.67');

      expect(getWebSocketUrl()).toBe('ws://192.168.178.67/api/a2a/ws');

      restore();
    });

    it('uses wss:// for https pages', () => {
      vi.stubEnv('VITE_WS_URL', '');
      const restore = stubLocation('https:', 'neodem.local');

      expect(getWebSocketUrl()).toBe('wss://neodem.local/api/a2a/ws');

      restore();
    });

    it('preserves the port in the host', () => {
      vi.stubEnv('VITE_WS_URL', '');
      const restore = stubLocation('http:', 'localhost:1420');

      expect(getWebSocketUrl()).toBe('ws://localhost:1420/api/a2a/ws');

      restore();
    });

    it('honors a custom path with the dynamic host', () => {
      vi.stubEnv('VITE_WS_URL', '');
      const restore = stubLocation('https:', 'example.com:8443');

      expect(getWebSocketUrl('/ws/telemetry')).toBe(
        'wss://example.com:8443/ws/telemetry'
      );

      restore();
    });

    it('treats any non-https protocol (e.g. file:) as insecure ws://', () => {
      vi.stubEnv('VITE_WS_URL', '');
      const restore = stubLocation('file:', 'somehost');

      expect(getWebSocketUrl()).toBe('ws://somehost/api/a2a/ws');

      restore();
    });
  });
});
