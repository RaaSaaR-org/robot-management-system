/**
 * @file UpdatesSection.test.tsx
 * @description The package table Settings renders as its Updates tab: the list
 *              itself, the acts each status offers, and the "New package" flag
 *              the parent owns because the button for it sits in the page
 *              header above this component.
 * @feature updates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Mock the updatesApi
vi.mock('../api/updatesApi', () => ({
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

import { updatesApi } from '../api/updatesApi';
import { useUpdatesStore } from '../store/updatesStore';
import { UpdatesSection } from '../components/UpdatesSection';

/** The section with the flag its parent owns; the tab bar above it is not under test. */
function renderSection(onOpenChange = vi.fn()) {
  render(<UpdatesSection newPackageOpen={false} onNewPackageOpenChange={onOpenChange} />);
  return onOpenChange;
}

describe('UpdatesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useUpdatesStore.setState({
      packages: [],
      deployments: [],
      isLoading: false,
      error: null,
    });
    // Mock fetchPackages to avoid an actual API call in the mount effect
    vi.mocked(updatesApi.getPackages).mockResolvedValue([]);
  });

  it('renders update list', () => {
    useUpdatesStore.setState({
      packages: [
        {
          id: 'pkg-001',
          version: '1.1.0',
          changelog: 'Bug fixes',
          signature: 'sig',
          publicKey: 'pk',
          checksum: 'abc123',
          fileSize: 1024,
          status: 'pending',
          approvedBy: null,
          approvedAt: null,
          createdAt: '2026-02-25T00:00:00.000Z',
        },
        {
          id: 'pkg-002',
          version: '1.2.0',
          changelog: 'New features',
          signature: 'sig2',
          publicKey: 'pk2',
          checksum: 'def456',
          fileSize: 2048,
          status: 'approved',
          approvedBy: 'admin',
          approvedAt: '2026-02-25T01:00:00.000Z',
          createdAt: '2026-02-25T00:30:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    });

    renderSection();

    expect(screen.getByText('v1.1.0')).toBeInTheDocument();
    expect(screen.getByText('v1.2.0')).toBeInTheDocument();
    expect(screen.getByText('Bug fixes')).toBeInTheDocument();
    expect(screen.getByText('New features')).toBeInTheDocument();
    // The page header is SettingsPage's now (TASK-279), so the section draws
    // no heading of its own.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('shows approve button for pending updates', () => {
    useUpdatesStore.setState({
      packages: [
        {
          id: 'pkg-001',
          version: '1.1.0',
          changelog: 'Fix',
          signature: 'sig',
          publicKey: 'pk',
          checksum: 'abc',
          fileSize: 512,
          status: 'pending',
          approvedBy: null,
          approvedAt: null,
          createdAt: '2026-02-25T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    });

    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for v1.1.0' }));
    expect(screen.getByRole('menuitem', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Deploy to robot/ })).not.toBeInTheDocument();
  });

  it('shows deploy button for approved updates', () => {
    useUpdatesStore.setState({
      packages: [
        {
          id: 'pkg-001',
          version: '1.1.0',
          changelog: 'Ready to deploy',
          signature: 'sig',
          publicKey: 'pk',
          checksum: 'abc',
          fileSize: 1024,
          status: 'approved',
          approvedBy: 'admin',
          approvedAt: '2026-02-25T00:00:00.000Z',
          createdAt: '2026-02-25T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    });

    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for v1.1.0' }));
    expect(screen.getByRole('menuitem', { name: /Deploy to robot/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Approve/ })).not.toBeInTheDocument();
  });

  it('offers "New package" from the empty state and asks the parent to open it', async () => {
    const onOpenChange = renderSection();

    // The mount effect loads the packages, so the empty state only settles
    // once that resolves — before it, the table is still a skeleton.
    fireEvent.click(await screen.findByRole('button', { name: 'New package' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('shows a roll-back act only on a deployed package', () => {
    useUpdatesStore.setState({
      packages: [
        {
          id: 'pkg-001',
          version: '1.1.0',
          changelog: 'Live',
          signature: 'sig',
          publicKey: 'pk',
          checksum: 'abc',
          fileSize: 1024,
          status: 'deployed',
          approvedBy: 'admin',
          approvedAt: '2026-02-25T00:00:00.000Z',
          createdAt: '2026-02-25T00:00:00.000Z',
        },
      ],
      isLoading: false,
      error: null,
    });

    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for v1.1.0' }));
    expect(screen.getByRole('menuitem', { name: /Roll back/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Deploy to robot/ })).toBeInTheDocument();
  });
});
