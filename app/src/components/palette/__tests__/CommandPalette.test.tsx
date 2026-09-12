/**
 * @file CommandPalette.test.tsx
 * @description The palette as the user meets it: ⌘K and Ctrl+K open it (and a
 *              bare letter never does, so the teleop cockpit keeps WASD), the
 *              full model is listed in order, typing filters it, the arrows
 *              wrap, hover and keyboard share one selection, Enter navigates —
 *              tab destinations included — and Esc hands focus back.
 * @feature layout
 */

import { useState, type ReactElement } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { NAV_GROUPS, filterNavGroups } from '@/components/layout/navigation';
import { CommandPalette, paletteDestinations } from '../CommandPalette';
import { usePaletteHotkey } from '../usePaletteHotkey';

const flags = vi.hoisted(() => ({ multiTenancyEnabled: false, role: 'member' as string | null }));

vi.mock('@/shared/hooks', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFeatures: () => ({ multiTenancyEnabled: flags.multiTenancyEnabled }) };
});

vi.mock('@/features/auth/store/authStore', () => ({
  selectUserRole: () => flags.role,
  useAuthStore: (selector: (s: unknown) => unknown) => selector({}),
}));

// ============================================================================
// HARNESS
// ============================================================================

/** Where the router ended up, so Enter and a click can be told apart from hope. */
function LocationProbe(): ReactElement {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

/** AppLayout's wiring, minus the rest of the shell: state, hotkey, dialog. */
function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  usePaletteHotkey(() => setOpen((current) => !current));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Search pages
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
      <LocationProbe />
    </>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Harness />
    </MemoryRouter>,
  );
}

/** ⌘K, as the hook sees it. */
const pressShortcut = (init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document, { key: 'k', metaKey: true, ...init });

const palette = () => screen.queryByTestId('command-palette');
const field = () => screen.getByRole('combobox');
const options = () => screen.getAllByRole('option');
/** The label of each row: the first span; the second one is the muted trail. */
const optionLabels = () => options().map((option) => option.querySelector('span')?.textContent ?? '');
const selectedLabel = () =>
  screen.getByRole('option', { selected: true }).querySelector('span')?.textContent ?? '';
const location = () => screen.getByTestId('location').textContent;

/** Every keystroke that must leave the palette alone — WASD driving included. */
const STAYS_SHUT: [string, KeyboardEventInit][] = [
  ['a bare k', { key: 'k' }],
  ['the teleop cockpit driving forward', { key: 'w' }],
  ['a held ⌘K repeating', { key: 'k', metaKey: true, repeat: true }],
];

beforeEach(() => {
  flags.multiTenancyEnabled = false;
  flags.role = 'member';
});

// ============================================================================
// TESTS
// ============================================================================

describe('CommandPalette', () => {
  it('opens on ⌘K and closes on a second press', () => {
    renderHarness();
    expect(palette()).toBeNull();
    pressShortcut();
    expect(palette()).toBeInTheDocument();
    pressShortcut();
    expect(palette()).toBeNull();
  });

  it('opens on Ctrl+K too, for everyone not on an Apple keyboard', () => {
    renderHarness();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(palette()).toBeInTheDocument();
  });

  it.each(STAYS_SHUT)('stays shut for %s', (_name, init) => {
    renderHarness();
    fireEvent.keyDown(document, init);
    expect(palette()).toBeNull();
  });

  it('lists every destination the model offers, in model order, with the field focused', () => {
    renderHarness();
    pressShortcut();
    expect(optionLabels()).toEqual(paletteDestinations(NAV_GROUPS).map((d) => d.label));
    expect(field()).toHaveFocus();
  });

  it('trails a destination with its row and its group where they differ', () => {
    renderHarness();
    pressShortcut();
    const rows = options().map((option) => option.textContent);
    // The Runs tab hangs under the Patrol stop of the Missions row, and reads
    // as its own page with the path back to it spelled out.
    expect(rows).toContain('Runs · Patrol · Automate');
    // A row does not repeat its own name at itself…
    expect(rows).toContain('Fleet · Operate');
    // …and a bookend group has no eyebrow to trail with.
    expect(rows).toContain('Dashboard');
  });

  it('filters by subsequence over label, row and group', async () => {
    renderHarness();
    pressShortcut();
    await userEvent.type(field(), 'visits');
    expect(optionLabels()).toEqual(['Visits']);
  });

  it('echoes the query back when nothing matches', async () => {
    renderHarness();
    pressShortcut();
    await userEvent.type(field(), 'zzzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/zzzz/)).toBeInTheDocument();
  });

  it('navigates to the selected destination on Enter and closes', async () => {
    renderHarness();
    pressShortcut();
    await userEvent.type(field(), 'visits');
    fireEvent.keyDown(field(), { key: 'Enter' });
    // A tab destination carries its ?tab= — the page reads it off the URL.
    expect(location()).toBe('/tour?tab=visits');
    expect(palette()).toBeNull();
  });

  it('navigates on a click, too', async () => {
    renderHarness();
    pressShortcut();
    await userEvent.type(field(), 'marketplace');
    await userEvent.click(screen.getByRole('option', { name: /Marketplace/ }));
    expect(location()).toBe('/marketplace');
  });

  it('wraps the arrows and jumps with Home and End', () => {
    renderHarness();
    pressShortcut();
    const labels = optionLabels();
    expect(selectedLabel()).toBe(labels[0]);
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(selectedLabel()).toBe(labels[labels.length - 1]);
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(selectedLabel()).toBe(labels[0]);
    fireEvent.keyDown(field(), { key: 'End' });
    expect(selectedLabel()).toBe(labels[labels.length - 1]);
    fireEvent.keyDown(field(), { key: 'Home' });
    expect(selectedLabel()).toBe(labels[0]);
  });

  it('points aria-activedescendant at the selected row', () => {
    renderHarness();
    pressShortcut();
    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field()).toHaveAttribute('aria-activedescendant', options()[1].id);
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(options()[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('lets the pointer take the selection, so hover and Enter never disagree', () => {
    renderHarness();
    pressShortcut();
    fireEvent.mouseMove(options()[3]);
    expect(selectedLabel()).toBe(optionLabels()[3]);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(location()).toBe(paletteDestinations(NAV_GROUPS)[3].path);
  });

  it('starts from a blank query every time it opens', async () => {
    renderHarness();
    pressShortcut();
    await userEvent.type(field(), 'visits');
    expect(optionLabels()).toEqual(['Visits']);
    fireEvent.keyDown(document, { key: 'Escape' });
    pressShortcut();
    expect(field()).toHaveValue('');
    expect(optionLabels()).toHaveLength(paletteDestinations(NAV_GROUPS).length);
  });

  it('closes on Esc and hands focus back to whatever opened it', async () => {
    renderHarness();
    const trigger = screen.getByRole('button', { name: 'Search pages' });
    await userEvent.click(trigger);
    expect(palette()).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(palette()).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('offers a member exactly what the gate leaves, and nothing beside it', () => {
    // No shipped group is gated since TASK-279 took the last one, so this
    // passes today by listing everything. It is written against the gate
    // rather than against a copy of the model on purpose: the day a gated
    // group returns, the palette has to hide it without being touched.
    flags.role = 'member';
    renderHarness();
    pressShortcut();
    expect(optionLabels()).toEqual(
      paletteDestinations(filterNavGroups(NAV_GROUPS, { multiTenancyEnabled: false }, 'member')).map((d) => d.label),
    );
  });
});
