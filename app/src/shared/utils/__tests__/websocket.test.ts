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
  const hostname = host.split(':')[0];
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { protocol, host, hostname } as Location,
  });
  return () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

/** Clear both env inputs so a test exercises exactly the branch it targets. */
function clearEnvInputs(): void {
  vi.stubEnv('VITE_WS_URL', '');
  vi.stubEnv('VITE_API_BASE_URL', '');
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

    it('override takes precedence over VITE_API_BASE_URL', () => {
      vi.stubEnv('VITE_WS_URL', 'ws://envhost/path');
      vi.stubEnv('VITE_API_BASE_URL', 'http://api.example.com:3001/api');

      expect(getWebSocketUrl()).toBe('ws://envhost/path');
    });
  });

  describe('VITE_API_BASE_URL derivation', () => {
    it('derives ws:// from an absolute http API base, keeping host and port', () => {
      vi.stubEnv('VITE_WS_URL', '');
      vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001/api');
      const restore = stubLocation('http:', 'localhost:1420');

      expect(getWebSocketUrl()).toBe('ws://localhost:3001/api/a2a/ws');

      restore();
    });

    it('derives wss:// from an https API base and honors a custom path', () => {
      vi.stubEnv('VITE_WS_URL', '');
      vi.stubEnv('VITE_API_BASE_URL', 'https://api.neodem.local/api');
      const restore = stubLocation('http:', 'localhost:1420');

      expect(getWebSocketUrl('/ws/telemetry')).toBe(
        'wss://api.neodem.local/ws/telemetry'
      );

      restore();
    });

    it('ignores a relative API base and falls through', () => {
      vi.stubEnv('VITE_WS_URL', '');
      vi.stubEnv('VITE_API_BASE_URL', '/api');
      vi.stubEnv('DEV', false);
      const restore = stubLocation('https:', 'neodem.local');

      expect(getWebSocketUrl()).toBe('wss://neodem.local/api/a2a/ws');

      restore();
    });
  });

  describe('SSR / no-window fallback', () => {
    it('falls back to localhost:3001 with the default path when window is undefined', () => {
      clearEnvInputs();
      vi.stubGlobal('window', undefined);

      expect(getWebSocketUrl()).toBe('ws://localhost:3001/api/a2a/ws');
    });

    it('uses the provided path in the SSR fallback', () => {
      clearEnvInputs();
      vi.stubGlobal('window', undefined);

      expect(getWebSocketUrl('/custom/socket')).toBe(
        'ws://localhost:3001/custom/socket'
      );
    });
  });

  describe('dev fallback (no absolute API base)', () => {
    it('targets the API dev port on the page host instead of the Vite origin', () => {
      clearEnvInputs();
      vi.stubEnv('DEV', true);
      const restore = stubLocation('http:', '192.168.178.67:1420');

      expect(getWebSocketUrl()).toBe('ws://192.168.178.67:3001/api/a2a/ws');

      restore();
    });
  });

  describe('dynamic URL from window.location (production)', () => {
    it('uses ws:// for http pages and includes host + default path', () => {
      clearEnvInputs();
      vi.stubEnv('DEV', false);
      const restore = stubLocation('http:', '192.168.178.67');

      expect(getWebSocketUrl()).toBe('ws://192.168.178.67/api/a2a/ws');

      restore();
    });

    it('uses wss:// for https pages', () => {
      clearEnvInputs();
      vi.stubEnv('DEV', false);
      const restore = stubLocation('https:', 'neodem.local');

      expect(getWebSocketUrl()).toBe('wss://neodem.local/api/a2a/ws');

      restore();
    });

    it('preserves the port in the host', () => {
      clearEnvInputs();
      vi.stubEnv('DEV', false);
      const restore = stubLocation('http:', 'localhost:1420');

      expect(getWebSocketUrl()).toBe('ws://localhost:1420/api/a2a/ws');

      restore();
    });

    it('honors a custom path with the dynamic host', () => {
      clearEnvInputs();
      vi.stubEnv('DEV', false);
      const restore = stubLocation('https:', 'example.com:8443');

      expect(getWebSocketUrl('/ws/telemetry')).toBe(
        'wss://example.com:8443/ws/telemetry'
      );

      restore();
    });

    it('treats any non-https protocol (e.g. file:) as insecure ws://', () => {
      clearEnvInputs();
      vi.stubEnv('DEV', false);
      const restore = stubLocation('file:', 'somehost');

      expect(getWebSocketUrl()).toBe('ws://somehost/api/a2a/ws');

      restore();
    });
  });
});
