/**
 * @file UserMenu.test.tsx
 * @description The avatar menu: the two pages it opens — Account settings, and
 *              Settings since it left the sidebar (TASK-279) — with Sign out
 *              last behind its separator, and the arrow keys that walk them.
 * @feature layout
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { UserMenu } from '../UserMenu';

const auth = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock('@/features/auth', () => ({
  useAuth: () => ({
    user: { id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'owner' },
    logout: auth.logout,
  }),
}));

beforeEach(() => {
  auth.logout.mockClear();
});

/** Open the menu the way a user does, and hand back its items in DOM order. */
async function openMenu() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <UserMenu />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Open user menu' }));
  return screen.getAllByRole('menuitem');
}

describe('UserMenu', () => {
  it('offers Account settings, Settings and Sign out, in that order', async () => {
    const items = await openMenu();
    expect(items.map((item) => item.textContent)).toEqual(['Account settings', 'Settings', 'Sign out']);
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('menuitem', { name: 'Account settings' })).toHaveAttribute('href', '/account');
  });

  it('walks every item with the arrow keys, the new one included', async () => {
    const [account, settings, signOut] = await openMenu();
    // Opening focuses the first item; from there the keys do the rest.
    expect(account).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(settings).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(signOut).toHaveFocus();
    // The list wraps, so End and Home stay meaningful either way round.
    await userEvent.keyboard('{ArrowDown}');
    expect(account).toHaveFocus();
  });

  it('names the signed-in user above the links', async () => {
    await openMenu();
    // Scoped to the panel: the trigger shows the name too.
    const panel = within(screen.getByRole('menu', { name: 'User menu' }));
    expect(panel.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(panel.getByText('ada@example.com')).toBeInTheDocument();
    expect(panel.getByText('Owner')).toBeInTheDocument();
  });
});
