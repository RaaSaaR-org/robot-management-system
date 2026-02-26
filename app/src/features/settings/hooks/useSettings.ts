/**
 * @file useSettings.ts
 * @description Hooks for accessing user settings
 * @feature settings
 */

import { useCallback, useMemo } from 'react';
import { useSettingsStore } from '../store/settingsStore';
import type {
  AppearanceSettings,
  NotificationSettings,
  DashboardSettings,
  UpdateSettingsDto,
} from '../types/settings.types';

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Primary hook for user settings.
 *
 * @example
 * ```tsx
 * const { settings, updateSetting, isLoading } = useSettings();
 * ```
 */
export function useSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const isLoading = useSettingsStore((s) => s.isLoading);
  const error = useSettingsStore((s) => s.error);
  const isInitialized = useSettingsStore((s) => s.isInitialized);
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const updateSettingAction = useSettingsStore((s) => s.updateSetting);
  const updateSettingsAction = useSettingsStore((s) => s.updateSettings);
  const resetSettingsAction = useSettingsStore((s) => s.resetSettings);
  const clearError = useSettingsStore((s) => s.clearError);

  const updateSetting = useCallback(
    <K extends keyof UpdateSettingsDto>(key: K, value: UpdateSettingsDto[K]) =>
      updateSettingAction(key, value),
    [updateSettingAction]
  );

  const updateSettings = useCallback(
    (data: UpdateSettingsDto) => updateSettingsAction(data),
    [updateSettingsAction]
  );

  const resetSettings = useCallback(() => resetSettingsAction(), [resetSettingsAction]);

  return useMemo(
    () => ({
      settings,
      isLoading,
      error,
      isInitialized,
      fetchSettings,
      updateSetting,
      updateSettings,
      resetSettings,
      clearError,
    }),
    [settings, isLoading, error, isInitialized, fetchSettings, updateSetting, updateSettings, resetSettings, clearError]
  );
}

// ============================================================================
// SUBSECTION HOOKS
// ============================================================================

/** Hook for appearance settings only */
export function useAppearanceSettings(): AppearanceSettings | null {
  const settings = useSettingsStore((s) => s.settings);
  return useMemo(() => {
    if (!settings) return null;
    return {
      theme: settings.theme,
      language: settings.language,
      compactMode: settings.compactMode,
    };
  }, [settings]);
}

/** Hook for notification settings only */
export function useNotificationSettings(): NotificationSettings | null {
  const settings = useSettingsStore((s) => s.settings);
  return useMemo(() => {
    if (!settings) return null;
    return {
      emailNotifications: settings.emailNotifications,
      alertsEnabled: settings.alertsEnabled,
      maintenanceReminders: settings.maintenanceReminders,
      weeklyDigest: settings.weeklyDigest,
    };
  }, [settings]);
}

/** Hook for dashboard settings only */
export function useDashboardSettings(): DashboardSettings | null {
  const settings = useSettingsStore((s) => s.settings);
  return useMemo(() => {
    if (!settings) return null;
    return {
      defaultDashboardView: settings.defaultDashboardView,
      refreshIntervalSec: settings.refreshIntervalSec,
    };
  }, [settings]);
}
