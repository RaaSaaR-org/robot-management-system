/**
 * @file settingsApi.ts
 * @description API client functions for user settings
 * @feature settings
 */

import { apiClient } from '@/api/client';
import type { UserSettings, UpdateSettingsDto } from '../types/settings.types';

// ============================================================================
// SETTINGS API
// ============================================================================

export const settingsApi = {
  /** Get current user settings (creates defaults if missing) */
  getSettings: () =>
    apiClient.get<UserSettings>('/settings').then((res) => res.data),

  /** Update user settings (partial update) */
  updateSettings: (data: UpdateSettingsDto) =>
    apiClient.put<UserSettings>('/settings', data).then((res) => res.data),

  /** Reset all settings to defaults */
  resetSettings: () =>
    apiClient.post<UserSettings>('/settings/reset').then((res) => res.data),
};
