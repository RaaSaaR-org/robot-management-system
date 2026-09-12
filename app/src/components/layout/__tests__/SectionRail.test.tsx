/**
 * @file SectionRail.test.tsx
 * @description The shell's second level: nothing at all for a row that
 *              declares no rail (still most of them), and — for the one row
 *              that does, Missions — the three stops on every URL it owns,
 *              with aria-current on the stop that owns that URL.
 * @feature layout
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NAV_GROUPS, type NavGroup } from '../navigation';
import { SectionRail } from '../SectionRail';

// The feature and role gates are not under test here — the rail renders
// whatever the hook hands it, so the fixture replaces the hook itself rather
// than the flags behind it. The groups it hands over are the real ones: the
// rail and the model must agree, and a hand-written copy of the model would
// only prove the copy right.
const nav = vi.hoisted(() => ({ groups: [] as NavGroup[] }));

vi.mock('../navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../navigation')>();
  return { ...actual, useVisibleNavGroups: () => nav.groups };
});

/** The Missions rail, in model order (TASK-277). */
const STOPS = ['Patrol', 'Guide', 'Automations'];

beforeEach(() => {
  nav.groups = NAV_GROUPS;
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
    'renders nothing on %s — the row that owns it declares no rail',
    (path) => {
      renderAt(path);
      expect(screen.queryByRole('navigation', { name: 'Section' })).toBeNull();
    },
  );

  it('renders nothing on /agent: Agent Mode sits beside Missions with no rail of its own', () => {
    renderAt('/agent');
    expect(screen.queryByRole('navigation', { name: 'Section' })).toBeNull();
  });

  // Every URL the Missions row owns, editors and run details included: the rail
  // belongs to the row, so it never disappears one level down.
  it.each([
    ['/patrol', 'Patrol'],
    ['/patrol?tab=runs', 'Patrol'],
    ['/patrol/routes/new', 'Patrol'],
    ['/patrol/routes/r-1', 'Patrol'],
    ['/patrol/runs/run-1', 'Patrol'],
    ['/tour', 'Guide'],
    ['/tour?tab=visits', 'Guide'],
    ['/tour/routes/new', 'Guide'],
    ['/tour/routes/t-1', 'Guide'],
    ['/tour/runs/run-1', 'Guide'],
    ['/processes', 'Automations'],
    ['/processes/p-1', 'Automations'],
  ])('shows Patrol · Guide · Automations on %s, current on %s', (path, current) => {
    renderAt(path);
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(STOPS);
    expect(screen.getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
    for (const other of STOPS.filter((stop) => stop !== current)) {
      expect(screen.getByRole('link', { name: other })).not.toHaveAttribute('aria-current');
    }
  });

  it('raises the current stop out of the track', () => {
    renderAt('/tour?tab=visits');
    expect(screen.getByRole('link', { name: 'Guide' }).className).toContain('bg-raised');
    expect(screen.getByRole('link', { name: 'Patrol' }).className).not.toContain('bg-raised');
  });
});
