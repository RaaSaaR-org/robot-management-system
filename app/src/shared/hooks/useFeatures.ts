/**
 * @file useFeatures.ts
 * @description Fetches the server's feature-flag snapshot from
 * `/api/config/features` (public, no auth) and caches it in a Zustand
 * store so the whole app can feature-gate UI synchronously. Mirrors the
 * server-side pattern from TASK-155: multi-tenancy, NATS, and RustFS are
 * opt-in, and the UI should render "disabled" states without probing
 * each feature individually.
 * @feature shared
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { apiClient } from '@/api';

export interface FeatureFlags {
  multiTenancyEnabled: boolean;
  natsEnabled: boolean;
  rustfsEnabled: boolean;
}

interface FeaturesState {
  flags: FeatureFlags;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
}

const DEFAULT_FLAGS: FeatureFlags = {
  multiTenancyEnabled: false,
  natsEnabled: false,
  rustfsEnabled: false,
};

export const useFeaturesStore = create<FeaturesState>((set, get) => ({
  flags: DEFAULT_FLAGS,
  loaded: false,
  loading: false,
  error: null,

  async fetch() {
    // Guard against duplicate fetches during strict-mode double-mount
    if (get().loading || get().loaded) return;
    set({ loading: true, error: null });
    try {
      const response = await apiClient.get<FeatureFlags>('/config/features');
      set({ flags: response.data, loaded: true, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load feature flags',
        loading: false,
        // Keep DEFAULT_FLAGS so the UI stays in its safe "disabled" state.
      });
    }
  },
}));

/**
 * Hook that lazily fetches feature flags on first render and returns them.
 * Safe to call from multiple components — the store dedupes requests.
 */
export function useFeatures(): FeatureFlags {
  const flags = useFeaturesStore((s) => s.flags);
  const loaded = useFeaturesStore((s) => s.loaded);
  const loading = useFeaturesStore((s) => s.loading);
  const fetch = useFeaturesStore((s) => s.fetch);

  useEffect(() => {
    if (!loaded && !loading) {
      void fetch();
    }
  }, [loaded, loading, fetch]);

  return flags;
}
