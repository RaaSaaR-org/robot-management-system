/**
 * @file settingsStore.ts
 * @description Zustand store for user settings with server sync
 * @feature settings
 */

import { createStore } from '@/store';
import { getErrorMessage } from '@/shared/utils';
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
        const settings = normalizeSettings(await settingsApi.getSettings());
        set((state) => {
          state.settings = settings;
          state.isLoading = false;
          state.isInitialized = true;
        });
        // The theme belongs to this device (themeStore, also set from the top
        // bar), so loading the server copy never overrides it. Picking a theme
        // in Settings or resetting writes both.
      } catch (error) {
        set((state) => {
          state.isLoading = false;
          state.error = getErrorMessage(error, 'Failed to fetch settings');
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
          state.settings = normalizeSettings(updated, { ...current, [key]: value });
        });

        // Sync theme if it changed
        if (key === 'theme') {
          syncTheme(value as ThemeValue);
        }
      } catch (error) {
        // Rollback on error
        set((state) => {
          state.settings = current;
          state.error = getErrorMessage(error, 'Failed to update setting');
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
          state.settings = normalizeSettings(updated, { ...current, ...data });
        });

        if (data.theme) {
          syncTheme(data.theme);
        }
      } catch (error) {
        set((state) => {
          state.settings = current;
          state.error = getErrorMessage(error, 'Failed to update settings');
        });
      }
    },

    resetSettings: async () => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const settings = normalizeSettings(await settingsApi.resetSettings());
        set((state) => {
          state.settings = settings;
          state.isLoading = false;
        });

        // The device goes back to the app default (dark), whatever an older
        // database column default says.
        syncTheme(DEFAULT_SETTINGS.theme);
      } catch (error) {
        set((state) => {
          state.isLoading = false;
          state.error = getErrorMessage(error, 'Failed to reset settings');
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

const THEME_VALUES: readonly ThemeValue[] = ['dark', 'light', 'system'];

/** The values a user starts with; dark is the app default. Mirrors the server's schema defaults. */
const DEFAULT_SETTINGS: UserSettings = {
  id: '',
  userId: '',
  theme: 'dark',
  language: 'en',
  compactMode: false,
  emailNotifications: true,
  alertsEnabled: true,
  maintenanceReminders: true,
  weeklyDigest: false,
  defaultDashboardView: 'fleet',
  refreshIntervalSec: 30,
  createdAt: '',
  updatedAt: '',
};

function isThemeValue(value: unknown): value is ThemeValue {
  return typeof value === 'string' && (THEME_VALUES as readonly string[]).includes(value);
}

/**
 * Fill in every field the API left out, from `fallback` then the defaults.
 * The demo's mock API answers /settings with an empty list, and an unknown
 * theme must never reach the theme store.
 */
function normalizeSettings(raw: unknown, fallback: Partial<UserSettings> = {}): UserSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof UserSettings, unknown>>;
  const base: UserSettings = { ...DEFAULT_SETTINGS, ...fallback };
  const result = { ...base } as Record<keyof UserSettings, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof UserSettings)[]) {
    const value = source[key];
    if (value !== undefined && value !== null && typeof value === typeof DEFAULT_SETTINGS[key]) {
      result[key] = value;
    }
  }
  if (!isThemeValue(result.theme)) result.theme = base.theme;
  return result as UserSettings;
}

/** Sync theme setting with the themeStore; ignores anything that is not a theme. */
function syncTheme(theme: ThemeValue) {
  if (!isThemeValue(theme)) return;
  useThemeStore.getState().setTheme(theme);
}

// ============================================================================
// SELECTORS
// ============================================================================

export const selectSettings = (state: SettingsStore) => state.settings;
export const selectSettingsLoading = (state: SettingsStore) => state.isLoading;
export const selectSettingsError = (state: SettingsStore) => state.error;
