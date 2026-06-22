/**
 * @file useLocalStorage.test.ts
 * @description Tests for useLocalStorage hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from '../useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns the initial value when key is absent', () => {
    const { result } = renderHook(() => useLocalStorage('missing', 'def'));
    expect(result.current[0]).toBe('def');
  });

  it('reads an existing JSON value from localStorage', () => {
    window.localStorage.setItem('count', JSON.stringify(42));
    const { result } = renderHook(() => useLocalStorage('count', 0));
    expect(result.current[0]).toBe(42);
  });

  it('falls back to initial value and warns on malformed JSON', () => {
    window.localStorage.setItem('bad', '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useLocalStorage('bad', 'fallback'));
    expect(result.current[0]).toBe('fallback');
    expect(warn).toHaveBeenCalled();
  });

  it('persists a new value to localStorage and updates state', () => {
    const { result } = renderHook(() => useLocalStorage('theme', 'dark'));
    act(() => {
      result.current[1]('light');
    });
    expect(result.current[0]).toBe('light');
    expect(JSON.parse(window.localStorage.getItem('theme')!)).toBe('light');
  });

  it('supports functional updates based on previous value', () => {
    const { result } = renderHook(() => useLocalStorage('n', 1));
    act(() => {
      result.current[1]((prev) => prev + 5);
    });
    expect(result.current[0]).toBe(6);
    expect(JSON.parse(window.localStorage.getItem('n')!)).toBe(6);
  });

  it('serializes complex objects', () => {
    const { result } = renderHook(() =>
      useLocalStorage<{ a: number[] }>('obj', { a: [] })
    );
    act(() => {
      result.current[1]({ a: [1, 2, 3] });
    });
    expect(result.current[0]).toEqual({ a: [1, 2, 3] });
    expect(JSON.parse(window.localStorage.getItem('obj')!)).toEqual({ a: [1, 2, 3] });
  });

  it('removes the value and resets to initial value', () => {
    const { result } = renderHook(() => useLocalStorage('k', 'init'));
    act(() => {
      result.current[1]('changed');
    });
    expect(window.localStorage.getItem('k')).not.toBeNull();

    act(() => {
      result.current[2]();
    });
    expect(result.current[0]).toBe('init');
    expect(window.localStorage.getItem('k')).toBeNull();
  });

  it('syncs state from a storage event from another tab', () => {
    const { result } = renderHook(() => useLocalStorage('shared', 'a'));
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'shared',
          newValue: JSON.stringify('from-other-tab'),
        })
      );
    });
    expect(result.current[0]).toBe('from-other-tab');
  });

  it('resets to initial value when storage event clears the key', () => {
    const { result } = renderHook(() => useLocalStorage('shared', 'init'));
    act(() => {
      result.current[1]('x');
    });
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'shared', newValue: null })
      );
    });
    expect(result.current[0]).toBe('init');
  });

  it('ignores storage events for unrelated keys', () => {
    const { result } = renderHook(() => useLocalStorage('mine', 'v'));
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'other',
          newValue: JSON.stringify('nope'),
        })
      );
    });
    expect(result.current[0]).toBe('v');
  });

  it('removes the storage listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useLocalStorage('k', 'v'));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('storage', expect.any(Function));
  });
});
