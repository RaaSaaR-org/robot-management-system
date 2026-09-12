/**
 * @file coverage.test.ts
 * @description The guard that keeps the navigation cut safe. Every row, rail
 *              stop and tab in NAV_GROUPS is walked by hand here — not through
 *              `navDestinations`, which would only prove that function equal to
 *              itself — and every one of them must come back out of
 *              `navDestinations`, and its URL out of the palette. It fails the
 *              moment someone adds a destination the palette cannot enumerate,
 *              which is the whole reason the second level lives in
 *              `navigation.ts` at all.
 * @feature layout
 */

import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, navDestinations, type NavDestination } from '@/components/layout/navigation';
import { paletteDestinations } from '../CommandPalette';

/** One destination as a single comparable line — every field it carries. */
const key = (d: Pick<NavDestination, 'kind' | 'label' | 'path' | 'row'> & { group?: string }) =>
  `${d.kind} | ${d.label} | ${d.path} | row=${d.row} | group=${d.group ?? '—'}`;

/**
 * The model walked by hand, applying the two conventions `navigation.ts`
 * documents: a railed row's tabs hang off its stops, and a page's first tab is
 * written by deleting `?tab=`, so its URL is the bare path.
 */
function walkTheModel(): string[] {
  const expected: string[] = [];
  for (const group of NAV_GROUPS) {
    for (const row of group.items) {
      expected.push(key({ kind: 'row', label: row.label, path: row.path, row: row.label, group: group.label }));
      const owners = row.rail ?? [row];
      for (const owner of owners) {
        if (row.rail) {
          expected.push(
            key({ kind: 'rail', label: owner.label, path: owner.path, row: owner.label, group: group.label }),
          );
        }
        (owner.tabs ?? []).forEach((tab, index) => {
          expected.push(
            key({
              kind: 'tab',
              label: tab.label,
              path: index === 0 ? owner.path : `${owner.path}?tab=${tab.id}`,
              row: owner.label,
              group: group.label,
            }),
          );
        });
      }
    }
  }
  return expected;
}

describe('navigation coverage', () => {
  const expected = walkTheModel();
  const actual = navDestinations(NAV_GROUPS).map(key);

  it('enumerates every row, rail stop and tab the model declares — and nothing else', () => {
    expect(new Set(actual)).toEqual(new Set(expected));
    expect(actual).toHaveLength(expected.length);
  });

  it('enumerates them in the order the sidebar reads, top to bottom', () => {
    expect(actual).toEqual(expected);
  });

  it('counts enough destinations to have grown past the ten rows', () => {
    // A floor, not an assertion about today's number: the point of the palette
    // is that it reaches more places than the sidebar shows.
    expect(actual.length).toBeGreaterThan(NAV_GROUPS.flatMap((g) => g.items).length);
  });

  it('declares no row with both a rail and tabs of its own — those tabs would be lost', () => {
    // `navDestinations` hangs a railed row's tabs off its stops, so tabs
    // written on the row itself would silently never be enumerated. The model
    // must not offer that shape; this is where it is caught.
    const both = NAV_GROUPS.flatMap((g) => g.items).filter((row) => row.rail && row.tabs);
    expect(both.map((row) => row.label)).toEqual([]);
  });
});

describe('paletteDestinations', () => {
  const raw = navDestinations(NAV_GROUPS);
  const offered = paletteDestinations(NAV_GROUPS);

  it('offers every URL the model declares — no view is lost by the dedupe', () => {
    expect(new Set(offered.map((d) => d.path))).toEqual(new Set(raw.map((d) => d.path)));
  });

  it('drops exactly the URLs a row shares with its own first tab, and nothing more', () => {
    expect(offered).toHaveLength(new Set(raw.map((d) => d.path)).size);
    const dropped = raw.filter((d) => !offered.includes(d));
    // Everything dropped is a later entry for a URL the palette already offers.
    for (const gone of dropped) {
      expect(offered.some((kept) => kept.path === gone.path)).toBe(true);
    }
    // …and the pair the model documents is the row and its own first tab.
    expect(dropped.map((d) => [d.kind, d.label, d.path])).toContainEqual(['tab', 'Map', '/fleet']);
  });

  it('keeps the first entry for a shared URL — the row, the name the sidebar uses', () => {
    expect(offered.find((d) => d.path === '/fleet')).toMatchObject({ kind: 'row', label: 'Fleet' });
    expect(offered.find((d) => d.path === '/patrol')).toMatchObject({ kind: 'row', label: 'Missions' });
    expect(offered.map((d) => d.path)).toHaveLength(new Set(offered.map((d) => d.path)).size);
  });
});
