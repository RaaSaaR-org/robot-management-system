/**
 * @file uiStore.ts
 * @description Zustand store for UI state (sidebar, mobile nav)
 * @feature settings
 */

import { createStore } from '@/store';

// ============================================================================
// TYPES
// ============================================================================

export interface UIStore {
  /** Whether sidebar is collapsed (icons only) */
  sidebarCollapsed: boolean;
  /** Whether mobile navigation drawer is open */
  mobileMenuOpen: boolean;
  /** Set sidebar collapsed state */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Toggle sidebar collapsed state */
  toggleSidebar: () => void;
  /** Set mobile menu open state */
  setMobileMenuOpen: (open: boolean) => void;
  /** Toggle mobile menu open state */
  toggleMobileMenu: () => void;
}

// ============================================================================
// STORE
// ============================================================================

export const useUIStore = createStore<UIStore>(
  (set) => ({
    sidebarCollapsed: false,
    mobileMenuOpen: false,

    setSidebarCollapsed: (collapsed: boolean) => {
      set((state) => {
        state.sidebarCollapsed = collapsed;
      });
    },

    toggleSidebar: () => {
      set((state) => {
        state.sidebarCollapsed = !state.sidebarCollapsed;
      });
    },

    setMobileMenuOpen: (open: boolean) => {
      set((state) => {
        state.mobileMenuOpen = open;
      });
    },

    toggleMobileMenu: () => {
      set((state) => {
        state.mobileMenuOpen = !state.mobileMenuOpen;
      });
    },
  }),
  {
    name: 'UIStore',
    persist: true,
    partialize: (state) => ({
      sidebarCollapsed: state.sidebarCollapsed,
      // Don't persist mobileMenuOpen - should start closed
    }),
  }
);

// ============================================================================
// SELECTORS
// ============================================================================

export const selectSidebarCollapsed = (state: UIStore) => state.sidebarCollapsed;
export const selectMobileMenuOpen = (state: UIStore) => state.mobileMenuOpen;
