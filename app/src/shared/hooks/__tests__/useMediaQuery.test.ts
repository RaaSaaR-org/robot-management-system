/**
 * @file useMediaQuery.test.ts
 * @description Tests for useMediaQuery and convenience hooks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useMediaQuery,
  useIsMobile,
  useIsTabletOrAbove,
  useIsDesktop,
  useBreakpoint,
  BREAKPOINTS,
} from '../useMediaQuery';

interface FakeMQL {
  matches: boolean;
  media: string;
  listeners: Array<(e: MediaQueryListEvent) => void>;
  addEventListener: (type: string, cb: (e: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: string, cb: (e: MediaQueryListEvent) => void) => void;
}

/**
 * Installs a fake matchMedia. `matcher` decides whether a given query matches.
 * Returns the list of created MQL objects so tests can fire change events.
 */
function installMatchMedia(matcher: (query: string) => boolean) {
  const created: FakeMQL[] = [];
  const fn = vi.fn((query: string): FakeMQL => {
    const mql: FakeMQL = {
      media: query,
      matches: matcher(query),
      listeners: [],
      addEventListener(_type, cb) {
        this.listeners.push(cb);
      },
      removeEventListener(_type, cb) {
        this.listeners = this.listeners.filter((l) => l !== cb);
      },
    };
    created.push(mql);
    return mql;
  });
  vi.stubGlobal('matchMedia', fn);
  // also assign on window since the hook reads window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: fn,
  });
  return { fn, created };
}

describe('useMediaQuery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when the query matches initially', () => {
    installMatchMedia(() => true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true);
  });

  it('returns false when the query does not match initially', () => {
    installMatchMedia(() => false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
  });

  it('updates when a change event fires', () => {
    const { created } = installMatchMedia(() => false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);

    act(() => {
      // the effect creates a second MQL; fire on the latest
      const mql = created[created.length - 1];
      mql.listeners.forEach((l) =>
        l({ matches: true } as MediaQueryListEvent)
      );
    });
    expect(result.current).toBe(true);
  });

  it('removes the change listener on unmount', () => {
    const { created } = installMatchMedia(() => false);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    const mql = created[created.length - 1];
    expect(mql.listeners.length).toBe(1);
    unmount();
    expect(mql.listeners.length).toBe(0);
  });

  it('re-subscribes when the query string changes', () => {
    const { fn } = installMatchMedia(() => false);
    const { rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: '(min-width: 768px)' },
    });
    const callsBefore = fn.mock.calls.length;
    rerender({ q: '(min-width: 1024px)' });
    expect(fn.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(fn).toHaveBeenCalledWith('(min-width: 1024px)');
  });
});

describe('convenience hooks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('useIsMobile queries max-width below md', () => {
    const { fn } = installMatchMedia(() => true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    expect(fn).toHaveBeenCalledWith(`(max-width: ${BREAKPOINTS.md - 1}px)`);
  });

  it('useIsTabletOrAbove queries min-width md', () => {
    const { fn } = installMatchMedia(() => true);
    renderHook(() => useIsTabletOrAbove());
    expect(fn).toHaveBeenCalledWith(`(min-width: ${BREAKPOINTS.md}px)`);
  });

  it('useIsDesktop queries min-width lg', () => {
    const { fn } = installMatchMedia(() => true);
    renderHook(() => useIsDesktop());
    expect(fn).toHaveBeenCalledWith(`(min-width: ${BREAKPOINTS.lg}px)`);
  });
});

describe('useBreakpoint', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Returns a matcher that reports a match for any breakpoint min-width
   * that is <= the given simulated viewport width.
   */
  const matcherForWidth = (width: number) => (query: string) => {
    const m = query.match(/min-width:\s*(\d+)px/);
    if (!m) return false;
    return width >= Number(m[1]);
  };

  it('returns xs when below all breakpoints', () => {
    installMatchMedia(matcherForWidth(500));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('xs');
  });

  it('returns md at 800px', () => {
    installMatchMedia(matcherForWidth(800));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('md');
  });

  it('returns lg at 1100px', () => {
    installMatchMedia(matcherForWidth(1100));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('lg');
  });

  it('returns 2xl at 1600px', () => {
    installMatchMedia(matcherForWidth(1600));
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('2xl');
  });
});
