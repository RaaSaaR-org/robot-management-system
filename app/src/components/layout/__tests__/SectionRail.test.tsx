/**
 * @file SectionRail.test.tsx
 * @description The shell's second level: nothing at all for a row that
 *              declares no rail (every row in the model today), and one link
 *              per stop — with aria-current on the stop that owns the URL —
 *              for a row that declares one.
 * @feature layout
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BrainCircuit, ListChecks, Route, Speech, Workflow } from 'lucide-react';
import { NAV_GROUPS, type NavGroup } from '../navigation';
import { SectionRail } from '../SectionRail';

// The feature and role gates are not under test here — the rail renders
// whatever the hook hands it, so the fixture replaces the hook itself rather
// than the flags behind it.
const nav = vi.hoisted(() => ({ groups: [] as NavGroup[] }));

vi.mock('../navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../navigation')>();
  return { ...actual, useVisibleNavGroups: () => nav.groups };
});

/** The shape [[TASK-277]] will put in the model: one row, three stops. */
const AUTOMATE: NavGroup = {
  id: 'automate',
  label: 'Automate',
  items: [
    // A row without a rail, to prove the rail belongs to the active row only.
    { label: 'Agent Mode', path: '/agent', icon: BrainCircuit },
    {
      label: 'Missions',
      path: '/patrol',
      icon: ListChecks,
      alsoActiveOn: [/^\/tour(\/|$)/, /^\/processes(\/|$)/],
      rail: [
        { label: 'Patrol', path: '/patrol', icon: Route },
        { label: 'Guide', path: '/tour', icon: Speech },
        { label: 'Automations', path: '/processes', icon: Workflow },
      ],
    },
  ],
};

beforeEach(() => {
  nav.groups = [AUTOMATE];
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SectionRail />
    </MemoryRouter>,
  );
}

describe('SectionRail', () => {
  it.each(['/dashboard', '/fleet', '/robots/r-1', '/compliance', '/account'])(
    'renders nothing on %s — no row in the model has a rail yet',
    (path) => {
      nav.groups = NAV_GROUPS;
      renderAt(path);
      expect(screen.queryByRole('navigation', { name: 'Section' })).toBeNull();
    },
  );

  it('renders nothing while a row without a rail is the active one', () => {
    renderAt('/agent');
    expect(screen.queryByRole('navigation', { name: 'Section' })).toBeNull();
  });

  it('renders one link per stop, current on the one that owns the URL', () => {
    renderAt('/tour?tab=visits');
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Patrol', 'Guide', 'Automations']);
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Patrol' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Guide' }).className).toContain('bg-raised');
  });

  it('stays on the editor and detail routes the row owns', () => {
    renderAt('/patrol/routes/new');
    expect(screen.getByRole('navigation', { name: 'Section' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Patrol' })).toHaveAttribute('aria-current', 'page');
  });
});
