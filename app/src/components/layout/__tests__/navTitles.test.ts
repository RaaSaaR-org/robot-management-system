/**
 * @file navTitles.test.ts
 * @description The word you click in the navigation is the word the page is
 *              titled with. "Skill Training" opened a page called "Pipeline",
 *              "Models" one called "Model Registry", and "Missions" a page that
 *              never said Missions (TASK-486). Read off the page sources, so a
 *              rename on either side fails here.
 * @feature layout
 */

import { describe, it, expect } from 'vitest';
import { NAV_GROUPS } from '../navigation';

const PAGES = import.meta.glob<string>('/src/features/*/pages/*.tsx', { query: '?raw', import: 'default', eager: true });

const source = (file: string): string => {
  const text = PAGES[`/src/features/${file}`];
  if (!text) throw new Error(`no page source at ${file}`);
  return text;
};

const rows = NAV_GROUPS.flatMap((group) => group.items);
const row = (label: string) => {
  const found = rows.find((r) => r.label === label);
  if (!found) throw new Error(`no navigation row "${label}"`);
  return found;
};

describe('navigation labels and page titles', () => {
  it('titles the Skill Training row’s own page "Skill Training"', () => {
    expect(row('Skill Training').path).toBe('/pipeline');
    expect(source('pipeline/pages/PipelinePage.tsx')).toContain("const TITLE = 'Skill Training';");
  });

  it('titles every Skill Training stage that has a list page with its rail label', () => {
    const titled: Record<string, string> = {
      '/datasets': 'training/pages/DatasetsPage.tsx',
      '/models': 'deployment/pages/ModelsPage.tsx',
      '/experiments': 'experiments/pages/ExperimentsPage.tsx',
    };
    const stops = row('Skill Training').rail ?? [];
    for (const [path, file] of Object.entries(titled)) {
      const stop = stops.find((s) => s.path === path);
      expect(stop, path).toBeDefined();
      expect(source(file), file).toContain(`title="${stop?.label}"`);
    }
  });

  it('names Missions on each of the three pages the Missions row opens', () => {
    const missions = row('Missions');
    const pages: Record<string, string> = {
      '/patrol': 'patrol/pages/PatrolPage.tsx',
      '/tour': 'tour/pages/TourPage.tsx',
      '/processes': 'processes/pages/ProcessesPage.tsx',
    };
    expect((missions.rail ?? []).map((s) => s.path).sort()).toEqual(Object.keys(pages).sort());
    for (const stop of missions.rail ?? []) {
      const text = source(pages[stop.path]);
      // The rail stop is the title; the row is the eyebrow above it.
      expect(text, stop.path).toContain(`title="${stop.label}"`);
      expect(text, stop.path).toContain('eyebrow="Automate · Missions"');
    }
  });
});
