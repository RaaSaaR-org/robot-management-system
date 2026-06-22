/**
 * @file themeStore.test.ts
 * @description Tests for the theme Zustand store
 * @feature settings
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, selectTheme } from '../themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'system' });
  });

  it('starts with system theme', () => {
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('setTheme sets an explicit theme', () => {
    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');

    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('cycleTheme advances system -> light -> dark -> system', () => {
    const { cycleTheme } = useThemeStore.getState();

    expect(useThemeStore.getState().theme).toBe('system');

    cycleTheme();
    expect(useThemeStore.getState().theme).toBe('light');

    cycleTheme();
    expect(useThemeStore.getState().theme).toBe('dark');

    cycleTheme();
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('cycleTheme from an explicit start respects the rotation', () => {
    useThemeStore.setState({ theme: 'dark' });
    useThemeStore.getState().cycleTheme();
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('selectTheme reads the current theme', () => {
    useThemeStore.setState({ theme: 'light' });
    expect(selectTheme(useThemeStore.getState())).toBe('light');
  });
});
