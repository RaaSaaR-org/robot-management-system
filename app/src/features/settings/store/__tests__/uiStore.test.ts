/**
 * @file uiStore.test.ts
 * @description Tests for the UI Zustand store (sidebar, mobile nav)
 * @feature settings
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, selectSidebarCollapsed, selectMobileMenuOpen } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarCollapsed: false, mobileMenuOpen: false });
  });

  it('starts with sidebar expanded and mobile menu closed', () => {
    const state = useUIStore.getState();
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.mobileMenuOpen).toBe(false);
  });

  it('setSidebarCollapsed sets the explicit value', () => {
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);

    useUIStore.getState().setSidebarCollapsed(false);
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('toggleSidebar flips the collapsed state', () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);

    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('setMobileMenuOpen sets the explicit value', () => {
    useUIStore.getState().setMobileMenuOpen(true);
    expect(useUIStore.getState().mobileMenuOpen).toBe(true);

    useUIStore.getState().setMobileMenuOpen(false);
    expect(useUIStore.getState().mobileMenuOpen).toBe(false);
  });

  it('toggleMobileMenu flips the open state', () => {
    expect(useUIStore.getState().mobileMenuOpen).toBe(false);

    useUIStore.getState().toggleMobileMenu();
    expect(useUIStore.getState().mobileMenuOpen).toBe(true);

    useUIStore.getState().toggleMobileMenu();
    expect(useUIStore.getState().mobileMenuOpen).toBe(false);
  });

  it('sidebar and mobile menu states are independent', () => {
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
    expect(useUIStore.getState().mobileMenuOpen).toBe(false);
  });

  it('selectors read the corresponding state', () => {
    useUIStore.setState({ sidebarCollapsed: true, mobileMenuOpen: true });
    const state = useUIStore.getState();
    expect(selectSidebarCollapsed(state)).toBe(true);
    expect(selectMobileMenuOpen(state)).toBe(true);
  });
});
