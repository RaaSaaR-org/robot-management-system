/**
 * @file settings.types.ts
 * @description Type definitions for user settings
 * @feature settings
 */

// ============================================================================
// USER SETTINGS
// ============================================================================

export interface UserSettings {
  id: string;
  userId: string;
  theme: ThemeValue;
  language: LanguageValue;
  compactMode: boolean;
  emailNotifications: boolean;
  alertsEnabled: boolean;
  maintenanceReminders: boolean;
  weeklyDigest: boolean;
  defaultDashboardView: DashboardView;
  refreshIntervalSec: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// VALUE TYPES
// ============================================================================

export type ThemeValue = 'light' | 'dark' | 'system';
export type LanguageValue = 'en' | 'de' | 'fr' | 'es' | 'ja';
export type DashboardView = 'fleet' | 'robots' | 'training';

// ============================================================================
// DTO
// ============================================================================

export type UpdateSettingsDto = Partial<Omit<UserSettings, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

// ============================================================================
// SUBSECTION TYPES (for hooks)
// ============================================================================

export interface AppearanceSettings {
  theme: ThemeValue;
  language: LanguageValue;
  compactMode: boolean;
}

export interface NotificationSettings {
  emailNotifications: boolean;
  alertsEnabled: boolean;
  maintenanceReminders: boolean;
  weeklyDigest: boolean;
}

export interface DashboardSettings {
  defaultDashboardView: DashboardView;
  refreshIntervalSec: number;
}
