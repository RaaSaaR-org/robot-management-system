/**
 * @file SettingsService.test.ts
 * @description Unit tests for SettingsService — user settings CRUD with defaults and validation.
 * @feature user-settings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserSettings } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mocks for external boundaries (Prisma client)
// ---------------------------------------------------------------------------

const { findUnique, create, upsert, deleteMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock('../../database/client.js', () => ({
  prisma: {
    userSettings: {
      findUnique,
      create,
      upsert,
      deleteMany,
    },
  },
}));

import { settingsService } from '../SettingsService.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    id: 's1',
    userId: 'u1',
    theme: 'system',
    language: 'en',
    compactMode: false,
    emailNotifications: true,
    alertsEnabled: true,
    maintenanceReminders: true,
    weeklyDigest: false,
    defaultDashboardView: 'fleet',
    refreshIntervalSec: 30,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserSettings;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// getSettings
// ===========================================================================

describe('getSettings', () => {
  it('returns existing settings without creating', async () => {
    const existing = makeSettings();
    findUnique.mockResolvedValue(existing);

    const result = await settingsService.getSettings('u1');

    expect(result).toBe(existing);
    expect(findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates default settings when none exist', async () => {
    findUnique.mockResolvedValue(null);
    const created = makeSettings({ id: 's-new' });
    create.mockResolvedValue(created);

    const result = await settingsService.getSettings('u2');

    expect(result).toBe(created);
    expect(create).toHaveBeenCalledWith({ data: { userId: 'u2' } });
  });

  it('propagates DB errors', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    await expect(settingsService.getSettings('u1')).rejects.toThrow('db down');
  });
});

// ===========================================================================
// updateSettings
// ===========================================================================

describe('updateSettings', () => {
  it('upserts valid settings', async () => {
    const updated = makeSettings({ theme: 'dark' });
    upsert.mockResolvedValue(updated);

    const result = await settingsService.updateSettings('u1', { theme: 'dark' });

    expect(result).toBe(updated);
    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: { theme: 'dark' },
      create: { userId: 'u1', theme: 'dark' },
    });
  });

  it('rejects an invalid theme without touching the DB', async () => {
    await expect(
      settingsService.updateSettings('u1', { theme: 'neon' })
    ).rejects.toThrow('Invalid theme');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid language', async () => {
    await expect(
      settingsService.updateSettings('u1', { language: 'xx' })
    ).rejects.toThrow('Invalid language');
  });

  it('rejects an invalid dashboard view', async () => {
    await expect(
      settingsService.updateSettings('u1', { defaultDashboardView: 'nope' })
    ).rejects.toThrow('Invalid dashboard view');
  });

  it('rejects a refresh interval below the minimum', async () => {
    await expect(
      settingsService.updateSettings('u1', { refreshIntervalSec: 1 })
    ).rejects.toThrow('refreshIntervalSec must be between');
  });

  it('rejects a refresh interval above the maximum', async () => {
    await expect(
      settingsService.updateSettings('u1', { refreshIntervalSec: 999 })
    ).rejects.toThrow('refreshIntervalSec must be between');
  });

  it('accepts boundary refresh interval values', async () => {
    upsert.mockResolvedValue(makeSettings());
    await expect(
      settingsService.updateSettings('u1', { refreshIntervalSec: 5 })
    ).resolves.toBeDefined();
    await expect(
      settingsService.updateSettings('u1', { refreshIntervalSec: 300 })
    ).resolves.toBeDefined();
  });
});

// ===========================================================================
// resetSettings
// ===========================================================================

describe('resetSettings', () => {
  it('deletes existing settings then creates defaults', async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    const created = makeSettings({ id: 's-reset' });
    create.mockResolvedValue(created);

    const result = await settingsService.resetSettings('u1');

    expect(result).toBe(created);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(create).toHaveBeenCalledWith({ data: { userId: 'u1' } });
  });

  it('propagates delete errors and does not create', async () => {
    deleteMany.mockRejectedValue(new Error('delete failed'));
    await expect(settingsService.resetSettings('u1')).rejects.toThrow('delete failed');
    expect(create).not.toHaveBeenCalled();
  });
});
