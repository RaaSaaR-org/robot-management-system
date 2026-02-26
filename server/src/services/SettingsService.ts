/**
 * @file SettingsService.ts
 * @description User settings management — CRUD with defaults for new users
 * @feature user-settings
 */

import { prisma } from '../database/client.js';
import type { UserSettings } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

/** Fields that can be updated via the API */
export interface UpdateSettingsDto {
  theme?: string;
  language?: string;
  compactMode?: boolean;
  emailNotifications?: boolean;
  alertsEnabled?: boolean;
  maintenanceReminders?: boolean;
  weeklyDigest?: boolean;
  defaultDashboardView?: string;
  refreshIntervalSec?: number;
}

/** Valid values for enum-like fields */
const VALID_THEMES = ['light', 'dark', 'system'] as const;
const VALID_LANGUAGES = ['en', 'de', 'fr', 'es', 'ja'] as const;
const VALID_DASHBOARD_VIEWS = ['fleet', 'robots', 'training'] as const;
const MIN_REFRESH_INTERVAL = 5;
const MAX_REFRESH_INTERVAL = 300;

// ============================================================================
// SETTINGS SERVICE
// ============================================================================

export class SettingsService {
  // ==========================================================================
  // GET SETTINGS
  // ==========================================================================

  /**
   * Get settings for a user, creating defaults if missing
   */
  async getSettings(userId: string): Promise<UserSettings> {
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (settings) {
      return settings;
    }

    // Create default settings for new user
    return prisma.userSettings.create({
      data: { userId },
    });
  }

  // ==========================================================================
  // UPDATE SETTINGS
  // ==========================================================================

  /**
   * Update settings for a user (upserts if missing)
   */
  async updateSettings(userId: string, data: UpdateSettingsDto): Promise<UserSettings> {
    // Validate enum fields
    this.validate(data);

    return prisma.userSettings.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }

  // ==========================================================================
  // RESET SETTINGS
  // ==========================================================================

  /**
   * Reset settings to defaults by deleting and recreating
   */
  async resetSettings(userId: string): Promise<UserSettings> {
    await prisma.userSettings.deleteMany({
      where: { userId },
    });

    return prisma.userSettings.create({
      data: { userId },
    });
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  private validate(data: UpdateSettingsDto): void {
    if (data.theme !== undefined && !VALID_THEMES.includes(data.theme as typeof VALID_THEMES[number])) {
      throw new Error(`Invalid theme. Must be one of: ${VALID_THEMES.join(', ')}`);
    }

    if (data.language !== undefined && !VALID_LANGUAGES.includes(data.language as typeof VALID_LANGUAGES[number])) {
      throw new Error(`Invalid language. Must be one of: ${VALID_LANGUAGES.join(', ')}`);
    }

    if (data.defaultDashboardView !== undefined && !VALID_DASHBOARD_VIEWS.includes(data.defaultDashboardView as typeof VALID_DASHBOARD_VIEWS[number])) {
      throw new Error(`Invalid dashboard view. Must be one of: ${VALID_DASHBOARD_VIEWS.join(', ')}`);
    }

    if (data.refreshIntervalSec !== undefined) {
      if (typeof data.refreshIntervalSec !== 'number' || data.refreshIntervalSec < MIN_REFRESH_INTERVAL || data.refreshIntervalSec > MAX_REFRESH_INTERVAL) {
        throw new Error(`refreshIntervalSec must be between ${MIN_REFRESH_INTERVAL} and ${MAX_REFRESH_INTERVAL}`);
      }
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

export const settingsService = new SettingsService();
