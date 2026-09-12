/**
 * @file SettingsPage.test.tsx
 * @description The four tabs Settings owns since Updates stopped being a
 *              sidebar row (TASK-279): the ?tab=updates deep link, the header
 *              action each tab brings, and the one thing that separates the
 *              fourth tab from the other three — it renders even when the
 *              user-settings request fails, because packages are not a setting.
 * @feature settings
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/settingsApi', () => ({
  settingsApi: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
  },
}));

vi.mock('@/features/updates/api/updatesApi', () => ({
  updatesApi: {
    getPackages: vi.fn(),
    getPackage: vi.fn(),
    createPackage: vi.fn(),
    approvePackage: vi.fn(),
    deployToRobot: vi.fn(),
    triggerRollback: vi.fn(),
    getDeployments: vi.fn(),
  },
}));

import { updatesApi } from '@/features/updates/api/updatesApi';
import { useUpdatesStore } from '@/features/updates/store/updatesStore';
import { settingsApi } from '../api/settingsApi';
import { useSettingsStore } from '../store/settingsStore';
import { SettingsPage } from '../pages/SettingsPage';

const PACKAGE = {
  id: 'pkg-001',
  version: '1.1.0',
  changelog: 'Bug fixes',
  signature: 'sig',
  publicKey: 'pk',
  checksum: 'abc123',
  fileSize: 1024,
  status: 'pending' as const,
  approvedBy: null,
  approvedAt: null,
  createdAt: '2026-02-25T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  // The store fills every missing field from its defaults, so an empty object
  // is a loaded settings record.
  vi.mocked(settingsApi.getSettings).mockResolvedValue({} as never);
  // The section loads the packages itself on mount, so the list under test is
  // the one the API answers with, not whatever the store happened to hold.
  vi.mocked(updatesApi.getPackages).mockResolvedValue([PACKAGE]);
  useSettingsStore.setState({ settings: null, isLoading: false, error: null, isInitialized: false });
  useUpdatesStore.setState({ packages: [], deployments: [], isLoading: false, error: null });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

/** The page header, which owns the h1 and the actions of whichever tab is open. */
const header = () => within(screen.getByRole('heading', { level: 1, name: 'Settings' }).closest('header')!);

describe('SettingsPage', () => {
  it('offers four tabs, Updates last', async () => {
    renderAt('/settings');
    expect((await screen.findAllByRole('tab')).map((tab) => tab.textContent)).toEqual([
      'Appearance',
      'Notifications',
      'Dashboard',
      'Updates',
    ]);
  });

  it('deep-links ?tab=updates to the package list and its New package action', async () => {
    renderAt('/settings?tab=updates');

    expect(screen.getByRole('tab', { name: 'Updates' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('v1.1.0')).toBeInTheDocument();
    expect(header().getByRole('button', { name: 'New package' })).toBeInTheDocument();
    // The preference acts belong to the preference tabs.
    expect(header().queryByRole('button', { name: 'Reset to defaults' })).toBeNull();
  });

  it('keeps the preference acts on the other three tabs', async () => {
    renderAt('/settings');
    expect(await header().findByRole('button', { name: 'Reset to defaults' })).toBeInTheDocument();
    expect(header().getByRole('link', { name: 'Account and security' })).toHaveAttribute('href', '/account');
    expect(header().queryByRole('button', { name: 'New package' })).toBeNull();
  });

  it('renders the Updates tab even when the settings request fails', async () => {
    vi.mocked(settingsApi.getSettings).mockRejectedValue(new Error('settings are down'));
    renderAt('/settings?tab=updates');

    expect(await screen.findByText('v1.1.0')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your settings")).toBeNull();
  });

  it('still reports a failed settings request on a preference tab', async () => {
    vi.mocked(settingsApi.getSettings).mockRejectedValue(new Error('settings are down'));
    renderAt('/settings');

    expect(await screen.findByText("Couldn't load your settings")).toBeInTheDocument();
  });
});
