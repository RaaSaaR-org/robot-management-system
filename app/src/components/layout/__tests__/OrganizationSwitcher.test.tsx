/**
 * @file OrganizationSwitcher.test.tsx
 * @description Who gets a menu out of the organization pill, and what is in it.
 *              Since TASK-279 it is also where Team and Organizations live, so
 *              an owner needs the menu too — but only a super-admin may see the
 *              tenant list, and nobody sees any of it with multi-tenancy off.
 * @feature layout
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useOrganizationsStore } from '@/features/organizations';
import type { Organization } from '@/features/organizations/types/organizations.types';
import { OrganizationSwitcher } from '../OrganizationSwitcher';

const flags = vi.hoisted(() => ({ multiTenancyEnabled: true, role: 'member' as string | null }));

vi.mock('@/shared/hooks', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFeatures: () => ({ multiTenancyEnabled: flags.multiTenancyEnabled }) };
});

vi.mock('@/features/auth/store/authStore', () => ({
  selectUserRole: () => flags.role,
  useAuthStore: (selector: (s: unknown) => unknown) => selector({}),
}));

const organization = (id: string, name: string): Organization => ({
  id,
  slug: name.toLowerCase(),
  name,
  logoUrl: null,
  plan: null,
  settings: '{}',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  isDefault: id === 'org-1',
  counts: { users: 1, robots: 0, datasets: 0, trainingJobs: 0 },
});

const ACME = organization('org-1', 'Acme');
const OTHER = organization('org-2', 'Contoso');

beforeEach(() => {
  flags.multiTenancyEnabled = true;
  flags.role = 'member';
  // `loaded` both ways: the component only fetches what it has not got, so
  // seeding the store keeps the API client out of this test entirely.
  useOrganizationsStore.setState({
    current: ACME,
    currentLoaded: true,
    currentLoading: false,
    list: [ACME, OTHER],
    listLoaded: true,
    listLoading: false,
  });
});

function renderSwitcher() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <OrganizationSwitcher />
    </MemoryRouter>,
  );
}

/** Open the pill's menu and hand back a scope over the panel it reveals. */
async function openMenu() {
  renderSwitcher();
  // The pill's accessible name is the organization it shows — the mark and
  // the chevron beside it are decoration.
  await userEvent.click(screen.getByRole('button', { name: 'Acme' }));
  return within(screen.getByRole('menu', { name: 'Organization menu' }));
}

describe('OrganizationSwitcher', () => {
  it('renders nothing at all while multi-tenancy is off', () => {
    flags.multiTenancyEnabled = false;
    flags.role = 'super-admin';
    const { container } = renderSwitcher();
    expect(container).toBeEmptyDOMElement();
  });

  it('gives a member the static pill and no menu', () => {
    renderSwitcher();
    expect(screen.getByTitle('Current organization: Acme')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('gives an owner a menu with Team and no tenant list', async () => {
    flags.role = 'owner';
    const menu = await openMenu();

    expect(menu.getByRole('menuitem', { name: 'Team' })).toHaveAttribute('href', '/team');
    expect(menu.queryByRole('menuitem', { name: 'Organizations' })).toBeNull();
    // The tenant list and its impersonation copy are super-admin only.
    expect(menu.queryAllByRole('menuitemradio')).toEqual([]);
    expect(menu.queryByText(/Super-admin troubleshooting/)).toBeNull();
    expect(menu.getByText('Acme')).toBeInTheDocument();
  });

  it('gives a super-admin the tenant list, Team and Organizations', async () => {
    flags.role = 'super-admin';
    const menu = await openMenu();

    const tenants = menu.getAllByRole('menuitemradio');
    expect(tenants).toHaveLength(2);
    expect(tenants[0]).toHaveAttribute('aria-checked', 'true');
    expect(within(tenants[0]).getByText('Acme')).toBeInTheDocument();
    expect(within(tenants[1]).getByText('Contoso')).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: 'Team' })).toHaveAttribute('href', '/team');
    expect(menu.getByRole('menuitem', { name: 'Organizations' })).toHaveAttribute('href', '/organizations');
    expect(menu.getByText(/Super-admin troubleshooting/)).toBeInTheDocument();
  });

  it('closes the menu when an administration page is followed', async () => {
    flags.role = 'owner';
    const menu = await openMenu();
    await userEvent.click(menu.getByRole('menuitem', { name: 'Team' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
