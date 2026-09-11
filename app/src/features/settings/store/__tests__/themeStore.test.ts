/**
 * @file themeStore.test.ts
 * @description Tests for the theme Zustand store
 * @feature settings
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, selectTheme } from '../themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' });
  });

  it('starts with the dark theme', () => {
    expect(useThemeStore.getInitialState().theme).toBe('dark');
  });

  it('setTheme sets an explicit theme', () => {
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');

    useThemeStore.getState().setTheme('system');
    expect(useThemeStore.getState().theme).toBe('system');

    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('cycleTheme advances system -> light -> dark -> system', () => {
    useThemeStore.setState({ theme: 'system' });
    const { cycleTheme } = useThemeStore.getState();

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
