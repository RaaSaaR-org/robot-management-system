/**
 * @file useFeatures.test.ts
 * @description Tests for the useFeatures hook and useFeaturesStore
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/api', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { apiClient } from '@/api';
import { useFeatures, useFeaturesStore } from '../useFeatures';

const DEFAULT_FLAGS = {
  multiTenancyEnabled: false,
  natsEnabled: false,
  rustfsEnabled: false,
};

const ENABLED_FLAGS = {
  multiTenancyEnabled: true,
  natsEnabled: true,
  rustfsEnabled: false,
};

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;

describe('useFeaturesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFeaturesStore.setState({
      flags: DEFAULT_FLAGS,
      loaded: false,
      loading: false,
      error: null,
    });
  });

  it('starts with default (safe disabled) flags', () => {
    const state = useFeaturesStore.getState();
    expect(state.flags).toEqual(DEFAULT_FLAGS);
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetch() loads flags from the API and marks loaded', async () => {
    mockGet.mockResolvedValueOnce({ data: ENABLED_FLAGS });

    await act(async () => {
      await useFeaturesStore.getState().fetch();
    });

    const state = useFeaturesStore.getState();
    expect(mockGet).toHaveBeenCalledWith('/config/features');
    expect(state.flags).toEqual(ENABLED_FLAGS);
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('fetch() records an error and keeps default flags on failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('network down'));

    await act(async () => {
      await useFeaturesStore.getState().fetch();
    });

    const state = useFeaturesStore.getState();
    expect(state.error).toBe('network down');
    expect(state.loading).toBe(false);
    expect(state.loaded).toBe(false);
    expect(state.flags).toEqual(DEFAULT_FLAGS);
  });

  it('fetch() uses a fallback message for non-Error rejections', async () => {
    mockGet.mockRejectedValueOnce('boom');

    await act(async () => {
      await useFeaturesStore.getState().fetch();
    });

    expect(useFeaturesStore.getState().error).toBe('Failed to load feature flags');
  });

  it('dedupes when already loaded', async () => {
    useFeaturesStore.setState({ loaded: true });
    await act(async () => {
      await useFeaturesStore.getState().fetch();
    });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('dedupes concurrent fetches while loading', async () => {
    let resolve!: (v: unknown) => void;
    mockGet.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );

    await act(async () => {
      const p1 = useFeaturesStore.getState().fetch();
      // second call should bail out immediately because loading === true
      const p2 = useFeaturesStore.getState().fetch();
      resolve({ data: ENABLED_FLAGS });
      await Promise.all([p1, p2]);
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(useFeaturesStore.getState().flags).toEqual(ENABLED_FLAGS);
  });
});

describe('useFeatures hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFeaturesStore.setState({
      flags: DEFAULT_FLAGS,
      loaded: false,
      loading: false,
      error: null,
    });
  });

  it('fetches flags on first render and returns them', async () => {
    mockGet.mockResolvedValueOnce({ data: ENABLED_FLAGS });

    const { result } = renderHook(() => useFeatures());

    // initial render returns defaults
    expect(result.current).toEqual(DEFAULT_FLAGS);

    await waitFor(() => {
      expect(result.current).toEqual(ENABLED_FLAGS);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch when flags are already loaded', async () => {
    useFeaturesStore.setState({ flags: ENABLED_FLAGS, loaded: true });

    const { result } = renderHook(() => useFeatures());
    expect(result.current).toEqual(ENABLED_FLAGS);

    // give the effect a tick
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGet).not.toHaveBeenCalled();
  });
});
