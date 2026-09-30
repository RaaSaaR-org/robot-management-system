/**
 * @file UpdatesSection.test.tsx
 * @description The package table Settings renders as its Updates tab: the list
 *              itself, the acts each status offers, and the "New package" flag
 *              the parent owns because the button for it sits in the page
 *              header above this component.
 * @feature updates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { confirm, toast } from '@/shared/components/ui';

vi.mock('@/shared/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/components/ui')>();
  return {
    ...actual,
    confirm: vi.fn(),
    toast: { ...actual.toast, success: vi.fn(), error: vi.fn() },
  };
});

// Mock the updatesApi
vi.mock('../api/updatesApi', () => ({
  updatesApi: {
    deletePackage: vi.fn(),
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

  describe('Delete (TASK-272)', () => {
    const deployed = {
      id: 'pkg-001',
      version: '1.1.0',
      changelog: 'Live',
      signature: 'sig',
      publicKey: 'pk',
      checksum: 'abc',
      fileSize: 1024,
      status: 'deployed' as const,
      approvedBy: 'admin',
      approvedAt: '2026-02-25T00:00:00.000Z',
      createdAt: '2026-02-25T00:00:00.000Z',
    };

    function openDelete() {
      vi.mocked(updatesApi.getPackages).mockResolvedValue([deployed]);
      useUpdatesStore.setState({ packages: [deployed] });
      renderSection();
      fireEvent.click(screen.getByRole('button', { name: 'Actions for v1.1.0' }));
      fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    }

    it('confirms with the consequence, archives a deployed package and says so', async () => {
      vi.mocked(confirm).mockResolvedValue(true);
      vi.mocked(updatesApi.deletePackage).mockResolvedValue({ id: 'pkg-001', outcome: 'archived' });

      openDelete();

      await waitFor(() => expect(updatesApi.deletePackage).toHaveBeenCalledWith('pkg-001'));
      expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({
        title: 'Delete v1.1.0?',
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      expect(String(vi.mocked(confirm).mock.calls[0][0].description)).toContain('archived');
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Package archived', expect.anything()));
      expect(useUpdatesStore.getState().packages).toHaveLength(0);
    });

    it('does nothing when the confirm is declined', async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      openDelete();

      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(updatesApi.deletePackage).not.toHaveBeenCalled();
    });

    it("toasts the server's reason when the delete is refused", async () => {
      vi.mocked(confirm).mockResolvedValue(true);
      vi.mocked(updatesApi.deletePackage).mockRejectedValue({ message: 'still installing on 1 robot(s)' });

      openDelete();

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Couldn't delete the package", {
          description: 'still installing on 1 robot(s)',
        })
      );
      expect(useUpdatesStore.getState().packages).toHaveLength(1);
    });
  });
});
