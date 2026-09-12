/**
 * @file setup.ts
 * @description Vitest global test setup for React + jsdom environment
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '@/mocks/server';

// MSW: intercept real HTTP so tests can exercise the api client end to end.
// `onUnhandledRequest: 'bypass'` is deliberate — most suites replace the api
// module with vi.fn()s and never reach the network; 'error' would fail them.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  // msw's WebSocket interceptor redefines `globalThis.WebSocket` as a
  // non-writable property. Suites that swap in a fake socket for the duration
  // of a test (`globalThis.WebSocket = FakeSocket`) then throw in strict mode.
  // Keep msw's class as the value, but make the slot assignable again.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  if (descriptor && !descriptor.writable && descriptor.configurable) {
    Object.defineProperty(globalThis, 'WebSocket', {
      value: globalThis.WebSocket,
      writable: true,
      configurable: true,
      enumerable: descriptor.enumerable,
    });
  }
});

// Cleanup DOM after each test
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Mock window.matchMedia (used by ThemeProvider)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
