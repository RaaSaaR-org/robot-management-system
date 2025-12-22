/**
 * @file themeStore.ts
 * @description Zustand store for theme state management
 * @feature settings
 */

import { createStore } from '@/store';

// ============================================================================
// TYPES
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeStore {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
}

// ============================================================================
// STORE
// ============================================================================

export const useThemeStore = createStore<ThemeStore>(
  (set, get) => ({
    theme: 'system',

    setTheme: (theme: ThemeMode) => {
      set((state) => {
        state.theme = theme;
      });
    },

    cycleTheme: () => {
      const current = get().theme;
      const next: ThemeMode = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
      set((state) => {
        state.theme = next;
      });
    },
  }),
  {
    name: 'ThemeStore',
    persist: true,
    partialize: (state) => ({
      theme: state.theme,
    }),
  }
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectTheme = (state: ThemeStore) => state.theme;
