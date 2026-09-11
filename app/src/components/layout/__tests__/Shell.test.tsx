/**
 * @file Shell.test.tsx
 * @description Sidebar and MobileNav behaviour: static group eyebrows, the
 *              active entry on nested routes, the collapsed icon rail, and the
 *              drawer's close paths (Esc, overlay, navigation) and focus.
 * @feature layout
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useUIStore } from '@/features/settings/store/uiStore';
import { Sidebar } from '../Sidebar';
import { MobileNav } from '../MobileNav';

const flags = vi.hoisted(() => ({ multiTenancyEnabled: false, role: 'member' as string | null }));

vi.mock('@/shared/hooks', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFeatures: () => ({ multiTenancyEnabled: flags.multiTenancyEnabled }) };
});

vi.mock('@/features/auth/store/authStore', () => ({
  selectUserRole: () => flags.role,
  useAuthStore: (selector: (s: unknown) => unknown) => selector({}),
}));

// The drawer header shows the brand logo; its provider is not under test here.
vi.mock('@/components/common/Logo', () => ({ Logo: () => <span>NeoDEM</span> }));

beforeEach(() => {
  flags.multiTenancyEnabled = false;
  flags.role = 'member';
  useUIStore.setState({ sidebarCollapsed: false, mobileMenuOpen: false });
});

function renderAt(path: string, ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('Sidebar', () => {
  it('renders static group eyebrows, no accordion toggles', () => {
    renderAt('/dashboard', <Sidebar />);
    for (const label of ['Operate', 'Automate', 'Build', 'System']) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    }
    // The bookend groups hold one row each and carry no eyebrow: no heading,
    // and the section borrows the row's name so it is still a landmark.
    for (const label of ['Overview', 'Comply', 'Dashboard', 'Compliance']) {
      expect(screen.queryByRole('heading', { name: label })).toBeNull();
    }
    expect(screen.getByRole('region', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Compliance' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks the owning entry current on a nested detail route', () => {
    renderAt('/robots/r-1', <Sidebar />);
    expect(screen.getByRole('link', { name: 'Fleet' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Fleet' }).className).toContain('bg-primary/10');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the Admin gates: owners get Team only', () => {
    flags.multiTenancyEnabled = true;
    flags.role = 'owner';
    renderAt('/dashboard', <Sidebar />);
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Organizations' })).toBeNull();
  });

  it('collapses to an icon rail whose links keep their names', () => {
    useUIStore.setState({ sidebarCollapsed: true });
    renderAt('/training', <Sidebar />);
    expect(screen.queryByRole('heading', { name: 'Build' })).toBeNull();
    expect(screen.getAllByRole('separator').length).toBeGreaterThan(0);
    // Hairlines instead of eyebrows, but every group keeps a name — the
    // unlabelled one included.
    expect(screen.getByRole('region', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Automate' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Training' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('MobileNav', () => {
  it('moves focus into the open drawer and closes on Esc', () => {
    const onClose = vi.fn();
    renderAt('/dashboard', <MobileNav isOpen onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on an overlay click', async () => {
    const onClose = vi.fn();
    renderAt('/dashboard', <MobileNav isOpen onClose={onClose} />);
    await userEvent.click(screen.getByTestId('mobile-nav-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when an entry is followed', async () => {
    const onClose = vi.fn();
    renderAt('/dashboard', <MobileNav isOpen onClose={onClose} />);
    await userEvent.click(screen.getByRole('link', { name: 'Patrol' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('is inert and hidden while closed', () => {
    renderAt('/dashboard', <MobileNav isOpen={false} onClose={() => {}} />);
    const drawer = screen.getByRole('dialog', { hidden: true });
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    expect(drawer).toHaveAttribute('inert');
  });
});
