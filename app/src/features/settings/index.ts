/**
 * @file index.ts
 * @description Barrel export for settings feature
 * @feature settings
 */

// Theme store
export { useThemeStore, selectTheme } from './store/themeStore';
export type { ThemeMode, ThemeStore } from './store/themeStore';

// UI store
export { useUIStore, selectSidebarCollapsed, selectMobileMenuOpen } from './store/uiStore';
export type { UIStore } from './store/uiStore';

// Settings store
export { useSettingsStore, selectSettings, selectSettingsLoading, selectSettingsError } from './store/settingsStore';
export type { SettingsStore } from './store/settingsStore';

// Settings types
export type {
  UserSettings,
  UpdateSettingsDto,
  AppearanceSettings,
  NotificationSettings,
  DashboardSettings,
  ThemeValue,
  LanguageValue,
  DashboardView,
} from './types/settings.types';

// Settings hooks
export { useSettings, useAppearanceSettings, useNotificationSettings, useDashboardSettings } from './hooks/useSettings';

// Settings API
export { settingsApi } from './api/settingsApi';

// Settings page
export { SettingsPage } from './pages/SettingsPage';
