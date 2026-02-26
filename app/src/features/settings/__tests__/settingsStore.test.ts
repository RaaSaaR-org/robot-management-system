/**
 * @file settingsStore.test.ts
 * @description Tests for the settings Zustand store
 * @feature settings
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../store/settingsStore';
import { useThemeStore } from '../store/themeStore';
import type { UserSettings } from '../types/settings.types';

// Mock the settings API
vi.mock('../api/settingsApi', () => ({
  settingsApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
  },
}));

import { settingsApi } from '../api/settingsApi';

const MOCK_SETTINGS: UserSettings = {
  id: 'settings-001',
  userId: 'user-123',
  theme: 'system',
  language: 'en',
  compactMode: false,
  emailNotifications: true,
  alertsEnabled: true,
  maintenanceReminders: true,
  weeklyDigest: false,
  defaultDashboardView: 'fleet',
  refreshIntervalSec: 30,
  createdAt: '2026-02-26T00:00:00.000Z',
  updatedAt: '2026-02-26T00:00:00.000Z',
};

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useSettingsStore.setState({
      settings: null,
      isLoading: false,
      error: null,
      isInitialized: false,
    });
    // Reset theme store
    useThemeStore.setState({ theme: 'system' });
  });

  it('starts with initial state', () => {
    const state = useSettingsStore.getState();
    expect(state.settings).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.isInitialized).toBe(false);
  });

  it('fetchSettings loads settings from API', async () => {
    vi.mocked(settingsApi.getSettings).mockResolvedValue(MOCK_SETTINGS);

    await useSettingsStore.getState().fetchSettings();

    const state = useSettingsStore.getState();
    expect(state.settings).toEqual(MOCK_SETTINGS);
    expect(state.isLoading).toBe(false);
    expect(state.isInitialized).toBe(true);
    expect(settingsApi.getSettings).toHaveBeenCalledOnce();
  });

  it('fetchSettings syncs theme with themeStore', async () => {
    const darkSettings = { ...MOCK_SETTINGS, theme: 'dark' as const };
    vi.mocked(settingsApi.getSettings).mockResolvedValue(darkSettings);

    await useSettingsStore.getState().fetchSettings();

    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('fetchSettings handles API error', async () => {
    vi.mocked(settingsApi.getSettings).mockRejectedValue(new Error('Network error'));

    await useSettingsStore.getState().fetchSettings();

    const state = useSettingsStore.getState();
    expect(state.settings).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe('Network error');
  });

  it('updateSetting updates single setting optimistically', async () => {
    const updated = { ...MOCK_SETTINGS, theme: 'dark' as const };
    vi.mocked(settingsApi.updateSettings).mockResolvedValue(updated);

    // Pre-load settings
    useSettingsStore.setState({ settings: MOCK_SETTINGS, isInitialized: true });

    await useSettingsStore.getState().updateSetting('theme', 'dark');

    const state = useSettingsStore.getState();
    expect(state.settings?.theme).toBe('dark');
    expect(settingsApi.updateSettings).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('updateSetting syncs theme with themeStore when theme changes', async () => {
    const updated = { ...MOCK_SETTINGS, theme: 'light' as const };
    vi.mocked(settingsApi.updateSettings).mockResolvedValue(updated);

    useSettingsStore.setState({ settings: MOCK_SETTINGS, isInitialized: true });

    await useSettingsStore.getState().updateSetting('theme', 'light');

    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('updateSetting rolls back on API error', async () => {
    vi.mocked(settingsApi.updateSettings).mockRejectedValue(new Error('Server error'));

    useSettingsStore.setState({ settings: MOCK_SETTINGS, isInitialized: true });

    await useSettingsStore.getState().updateSetting('theme', 'dark');

    const state = useSettingsStore.getState();
    // Should rollback to original
    expect(state.settings?.theme).toBe('system');
    expect(state.error).toBe('Server error');
  });

  it('resetSettings resets to defaults', async () => {
    vi.mocked(settingsApi.resetSettings).mockResolvedValue(MOCK_SETTINGS);

    const modified = { ...MOCK_SETTINGS, theme: 'dark' as const, compactMode: true };
    useSettingsStore.setState({ settings: modified, isInitialized: true });

    await useSettingsStore.getState().resetSettings();

    const state = useSettingsStore.getState();
    expect(state.settings?.theme).toBe('system');
    expect(state.settings?.compactMode).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it('clearError clears error state', () => {
    useSettingsStore.setState({ error: 'Some error' });
    expect(useSettingsStore.getState().error).toBe('Some error');

    useSettingsStore.getState().clearError();
    expect(useSettingsStore.getState().error).toBeNull();
  });

  it('updateSettings updates multiple settings at once', async () => {
    const updated = { ...MOCK_SETTINGS, theme: 'dark' as const, language: 'de' as const };
    vi.mocked(settingsApi.updateSettings).mockResolvedValue(updated);

    useSettingsStore.setState({ settings: MOCK_SETTINGS, isInitialized: true });

    await useSettingsStore.getState().updateSettings({ theme: 'dark', language: 'de' });

    const state = useSettingsStore.getState();
    expect(state.settings?.theme).toBe('dark');
    expect(state.settings?.language).toBe('de');
  });
});
