/**
 * @file UpdatesPage.test.tsx
 * @description Tests for UpdatesPage component
 * @feature updates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
import { UpdatesPage } from '../pages/UpdatesPage';

describe('UpdatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useUpdatesStore.setState({
      packages: [],
      deployments: [],
      isLoading: false,
      error: null,
    });
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

    // Mock fetchPackages to avoid actual API call in useEffect
    vi.mocked(updatesApi.getPackages).mockResolvedValue([]);

    render(<UpdatesPage />);

    expect(screen.getByText('Secure Updates')).toBeInTheDocument();
    expect(screen.getByText('v1.1.0')).toBeInTheDocument();
    expect(screen.getByText('v1.2.0')).toBeInTheDocument();
    expect(screen.getByText('Bug fixes')).toBeInTheDocument();
    expect(screen.getByText('New features')).toBeInTheDocument();
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

    vi.mocked(updatesApi.getPackages).mockResolvedValue([]);

    render(<UpdatesPage />);

    const approveButtons = screen.getAllByText('Approve');
    expect(approveButtons.length).toBeGreaterThan(0);
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

    vi.mocked(updatesApi.getPackages).mockResolvedValue([]);

    render(<UpdatesPage />);

    const deployButtons = screen.getAllByText('Deploy');
    expect(deployButtons.length).toBeGreaterThan(0);
  });
});
