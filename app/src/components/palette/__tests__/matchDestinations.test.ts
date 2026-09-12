/**
 * @file matchDestinations.test.ts
 * @description The palette's filter: case-insensitive subsequence over a
 *              destination's label, alias, row and group, ranked label-first
 *              and otherwise left in the model's order.
 * @feature layout
 */

import { describe, it, expect } from 'vitest';
import { Rocket, Route, Speech } from 'lucide-react';
import { NAV_GROUPS } from '@/components/layout/navigation';
import { matchDestinations, paletteDestinations, type PaletteDestination } from '../CommandPalette';

// A fixture rather than the shipped model: ranking is about the relation
// between two entries, and this pins that relation without re-breaking every
// time a row is renamed. Guide and Visits are the real pair the rule exists
// for — a tab whose only hit is in the row above it.
const FIXTURE: PaletteDestination[] = [
  { label: 'Visits', path: '/tour?tab=visits', kind: 'tab', icon: Speech, group: 'Automate', row: 'Guide' },
  { label: 'Guide', path: '/tour', kind: 'rail', icon: Speech, group: 'Automate', row: 'Guide' },
  { label: 'Deployments', path: '/deployments', kind: 'row', icon: Rocket, group: 'Build', row: 'Deployments' },
  { label: 'Routes', path: '/patrol', kind: 'tab', icon: Route, group: 'Automate', row: 'Patrol' },
];

const labels = (destinations: PaletteDestination[]) => destinations.map((d) => d.label);

describe('matchDestinations', () => {
  it('lists everything, in model order, for an empty query', () => {
    expect(labels(matchDestinations(FIXTURE, ''))).toEqual(['Visits', 'Guide', 'Deployments', 'Routes']);
  });

  it('treats a query of spaces as empty rather than as a filter', () => {
    expect(labels(matchDestinations(FIXTURE, '   '))).toEqual(labels(FIXTURE));
  });

  it('matches a subsequence of the label: "dpmt" finds Deployments', () => {
    expect(labels(matchDestinations(FIXTURE, 'dpmt'))).toEqual(['Deployments']);
  });

  it('ignores case in both directions', () => {
    expect(labels(matchDestinations(FIXTURE, 'GUIDE'))).toEqual(['Guide', 'Visits']);
  });

  it('ranks an exact prefix above a hit found only in the row', () => {
    // Visits comes first in the model, and still loses: its only hit is the
    // "Guide" in its trail, while Guide itself starts with the query.
    expect(labels(matchDestinations(FIXTURE, 'gui'))).toEqual(['Guide', 'Visits']);
  });

  it('ranks a label subsequence above a row or group hit', () => {
    // "rue" is inside Routes; Guide and Visits only reach it through /tour's
    // row. Routes is last in the model and first in the result.
    expect(labels(matchDestinations(FIXTURE, 'rue'))).toEqual(['Routes']);
  });

  it('keeps the model order inside one rank', () => {
    expect(labels(matchDestinations(FIXTURE, 'automate'))).toEqual(['Visits', 'Guide', 'Routes']);
  });

  it('returns nothing when nothing matches', () => {
    expect(matchDestinations(FIXTURE, 'zzz')).toEqual([]);
  });

  it('reaches a demoted page in the shipped model — the reason the palette exists', () => {
    const offered = paletteDestinations(NAV_GROUPS);
    // Guide lost its sidebar row in TASK-277 and its Visits tab was never one.
    expect(matchDestinations(offered, 'visits')[0]).toMatchObject({ path: '/tour?tab=visits' });
    expect(matchDestinations(offered, 'guide')[0]).toMatchObject({ path: '/tour' });
    // Datasets and Learning lost theirs in TASK-278.
    expect(matchDestinations(offered, 'datasets')[0]).toMatchObject({ path: '/datasets' });
    expect(matchDestinations(offered, 'learning')[0]).toMatchObject({ path: '/fleet-learning' });
    // And a tab nobody ever navigated to by name: Train's simulation runs.
    expect(matchDestinations(offered, 'simulation')[0]).toMatchObject({ path: '/training?tab=simulation' });
  });

  it('still answers to the name of every destination folded into another', () => {
    const offered = paletteDestinations(NAV_GROUPS);
    // Three destinations share /patrol — the Missions row, the Patrol rail stop
    // and its Routes tab — because a page writes its first tab by deleting
    // `?tab=`. Only the row is offered, so "patrol" would find nothing at all
    // without the aliases, and "patrol" is the name that page had for years.
    const missions = offered.find((d) => d.path === '/patrol');
    expect(missions).toMatchObject({ label: 'Missions', aliases: ['Patrol', 'Routes'] });
    expect(matchDestinations(offered, 'patrol')[0]).toMatchObject({ path: '/patrol' });
    // Same for the first tab of a row that kept its own name — and typing the
    // alias whole beats the m-a-p that hides inside "Marketplace".
    expect(matchDestinations(offered, 'map')[0]).toMatchObject({ path: '/fleet' });
    expect(matchDestinations(offered, 'overview')[0]).toMatchObject({ path: '/pipeline' });
  });

  it('ranks a hit on the page\u2019s own name above one on an alias', () => {
    const aliased: PaletteDestination[] = [
      { label: 'Missions', path: '/patrol', kind: 'row', icon: Route, group: 'Automate', row: 'Missions', aliases: ['Patrol'] },
      { label: 'Patrol runs', path: '/patrol?tab=runs', kind: 'tab', icon: Route, group: 'Automate', row: 'Patrol' },
    ];
    expect(labels(matchDestinations(aliased, 'patrol'))).toEqual(['Patrol runs', 'Missions']);
  });
});
