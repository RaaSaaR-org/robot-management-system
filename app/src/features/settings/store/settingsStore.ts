/**
 * @file settingsStore.ts
 * @description Zustand store for user settings with server sync
 * @feature settings
 */

import { createStore } from '@/store';
import { settingsApi } from '../api/settingsApi';
import { useThemeStore } from './themeStore';
import type { UserSettings, UpdateSettingsDto, ThemeValue } from '../types/settings.types';

// ============================================================================
// TYPES
// ============================================================================

export interface SettingsStore {
  /** Server-synced settings */
  settings: UserSettings | null;
  /** Whether settings are being loaded */
  isLoading: boolean;
  /** Last error message */
  error: string | null;
  /** Whether settings have been fetched at least once */
  isInitialized: boolean;

  /** Fetch settings from server */
  fetchSettings: () => Promise<void>;
  /** Update a single setting */
  updateSetting: <K extends keyof UpdateSettingsDto>(key: K, value: UpdateSettingsDto[K]) => Promise<void>;
  /** Update multiple settings at once */
  updateSettings: (data: UpdateSettingsDto) => Promise<void>;
  /** Reset all settings to defaults */
  resetSettings: () => Promise<void>;
  /** Clear error */
  clearError: () => void;
}

// ============================================================================
// STORE
// ============================================================================

export const useSettingsStore = createStore<SettingsStore>(
  (set, get) => ({
    settings: null,
    isLoading: false,
    error: null,
    isInitialized: false,

    fetchSettings: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const settings = await settingsApi.getSettings();
        set((state) => {
          state.settings = settings;
          state.isLoading = false;
          state.isInitialized = true;
        });

        // Sync theme with themeStore
        syncTheme(settings.theme as ThemeValue);
      } catch (error) {
        set((state) => {
          state.isLoading = false;
          state.error = error instanceof Error ? error.message : 'Failed to fetch settings';
        });
      }
    },

    updateSetting: async (key, value) => {
      const current = get().settings;
      if (!current) return;

      // Optimistic update
      set((state) => {
        if (state.settings) {
          (state.settings as Record<string, unknown>)[key] = value;
        }
      });

      try {
        const updated = await settingsApi.updateSettings({ [key]: value } as UpdateSettingsDto);
        set((state) => {
          state.settings = updated;
        });

        // Sync theme if it changed
        if (key === 'theme') {
          syncTheme(value as ThemeValue);
        }
      } catch (error) {
        // Rollback on error
        set((state) => {
          state.settings = current;
          state.error = error instanceof Error ? error.message : 'Failed to update setting';
        });
      }
    },

    updateSettings: async (data) => {
      const current = get().settings;
      if (!current) return;

      // Optimistic update
      set((state) => {
        if (state.settings) {
          Object.assign(state.settings, data);
        }
      });

      try {
        const updated = await settingsApi.updateSettings(data);
        set((state) => {
          state.settings = updated;
        });

        if (data.theme) {
          syncTheme(data.theme);
        }
      } catch (error) {
        set((state) => {
          state.settings = current;
          state.error = error instanceof Error ? error.message : 'Failed to update settings';
        });
      }
    },

    resetSettings: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const settings = await settingsApi.resetSettings();
        set((state) => {
          state.settings = settings;
          state.isLoading = false;
        });

        syncTheme(settings.theme as ThemeValue);
      } catch (error) {
        set((state) => {
          state.isLoading = false;
          state.error = error instanceof Error ? error.message : 'Failed to reset settings';
        });
      }
    },

    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },
  }),
  {
    name: 'SettingsStore',
  }
);

// ============================================================================
// HELPERS
// ============================================================================

/** Sync theme setting with the themeStore */
function syncTheme(theme: ThemeValue) {
  const { setTheme } = useThemeStore.getState();
  setTheme(theme);
}

// ============================================================================
// SELECTORS
// ============================================================================

export const selectSettings = (state: SettingsStore) => state.settings;
export const selectSettingsLoading = (state: SettingsStore) => state.isLoading;
export const selectSettingsError = (state: SettingsStore) => state.error;
