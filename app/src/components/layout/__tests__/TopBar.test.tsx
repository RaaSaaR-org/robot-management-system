/**
 * @file TopBar.test.tsx
 * @description The top bar's own controls: the ⌘K search affordance the
 *              navigation cut leans on (TASK-280), the docs help icon that
 *              replaced the sidebar's Docs row (TASK-279), and the theme toggle
 *              beside it — all icon-led, so they live or die by their
 *              accessible name.
 * @feature layout
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useThemeStore } from '@/features/settings/store/themeStore';
import { useUIStore } from '@/features/settings/store/uiStore';
import { TopBar } from '../TopBar';

// The two menus at the right end have tests of their own and would pull the
// auth store, the organizations store and the API client into this one.
vi.mock('../OrganizationSwitcher', () => ({ OrganizationSwitcher: () => null }));
vi.mock('../UserMenu', () => ({ UserMenu: () => null }));

// The logo is shared with the landing page; its provider is not under test here.
vi.mock('@/components/common/Logo', () => ({ Logo: () => <span>NeoDEM</span> }));

beforeEach(() => {
  useThemeStore.setState({ theme: 'dark' });
  useUIStore.setState({ sidebarCollapsed: false, mobileMenuOpen: false });
});

function renderTopBar(onOpenPalette: () => void = () => {}) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <TopBar onOpenPalette={onOpenPalette} />
    </MemoryRouter>,
  );
}

describe('TopBar', () => {
  it('opens the palette from a search affordance that spells the shortcut out', async () => {
    const onOpenPalette = vi.fn();
    renderTopBar(onOpenPalette);
    const search = screen.getByRole('button', { name: 'Search pages' });
    // jsdom reports no platform, so the hint is the non-Apple spelling here.
    expect(search).toHaveTextContent('Ctrl K');
    expect(search).toHaveAttribute('title', 'Search pages (Ctrl K)');
    await userEvent.click(search);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it('places the search affordance left of the docs icon', () => {
    renderTopBar();
    const position = screen
      .getByRole('button', { name: 'Search pages' })
      .compareDocumentPosition(screen.getByRole('link', { name: 'Docs' }));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('links to the docs from a help icon with an accessible name', () => {
    renderTopBar();
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
  });

  it('places the help icon left of the theme toggle', () => {
    renderTopBar();
    const position = screen
      .getByRole('link', { name: 'Docs' })
      .compareDocumentPosition(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('still toggles the theme from the icon beside it', async () => {
    renderTopBar();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(useThemeStore.getState().theme).toBe('light');
  });
});
