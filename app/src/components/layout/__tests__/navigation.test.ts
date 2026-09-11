/**
 * @file navigation.test.ts
 * @description The nav model: group order and the two unlabelled bookends,
 *              the tabs each row declares, which entry is active for nested
 *              and foreign detail routes, the flattened destinations the
 *              palette reads, and the feature/role gates.
 * @feature layout
 */

import { describe, it, expect } from 'vitest';
import { Route, Workflow } from 'lucide-react';
import {
  NAV_GROUPS,
  NAV_ITEMS,
  filterNavGroups,
  isNavItemActive,
  navDestinations,
  type NavGroup,
} from '../navigation';

const item = (label: string) => {
  const found = NAV_ITEMS.find((i) => i.label === label);
  if (!found) throw new Error(`no nav item ${label}`);
  return found;
};

/** Labels of every entry active for a URL — exactly one is expected. */
const activeFor = (pathname: string) => NAV_ITEMS.filter((i) => isNavItemActive(i, pathname)).map((i) => i.label);

describe('NAV_GROUPS', () => {
  it('follows the contract order, with Dashboard and Comply unlabelled', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual([
      'dashboard',
      'operate',
      'automate',
      'build',
      'comply',
      'system',
      'admin',
    ]);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      undefined,
      'Operate',
      'Automate',
      'Build',
      undefined,
      'System',
      'Admin',
    ]);
  });

  it('still holds 23 rows — this slice regroups, it removes nothing', () => {
    expect(NAV_ITEMS).toHaveLength(23);
  });

  it('puts the four automation rows in Automate, in order', () => {
    const automate = NAV_GROUPS.find((g) => g.id === 'automate')!;
    expect(automate.items.map((i) => i.label)).toEqual(['Agent Mode', 'Patrol', 'Guide', 'Automations']);
  });

  it('keeps Operate at Fleet · Control Center · Alerts · Digital Twin', () => {
    const operate = NAV_GROUPS.find((g) => g.id === 'operate')!;
    expect(operate.items.map((i) => i.label)).toEqual(['Fleet', 'Control Center', 'Alerts', 'Digital Twin']);
  });

  it('puts Models in Build between Training and Deployments', () => {
    const build = NAV_GROUPS.find((g) => g.id === 'build')!;
    const labels = build.items.map((i) => i.label);
    expect(labels.indexOf('Models')).toBe(labels.indexOf('Training') + 1);
    expect(labels[labels.indexOf('Models') + 1]).toBe('Deployments');
    expect(item('Models').path).toBe('/models');
  });

  it("copies the pages' own tab ids and labels, and declares none for a page without a tab bar", () => {
    expect(item('Fleet').tabs).toEqual([
      { id: 'map', label: 'Map' },
      { id: 'list', label: 'Robots' },
    ]);
    expect(item('Compliance').tabs?.map((t) => t.id)).toEqual([
      'overview',
      'obligations',
      'audit',
      'explainability',
      'oversight',
      'approvals',
      'privacy',
    ]);
    expect(item('Fleet Learning').tabs?.map((t) => t.label)).toEqual([
      'Rounds',
      'Convergence',
      'Privacy',
      'ROHE',
    ]);
    for (const label of ['Dashboard', 'Control Center', 'Agent Mode', 'Automations', 'Datasets', 'Docs']) {
      expect(item(label).tabs).toBeUndefined();
    }
  });

  it('declares no rail yet — the rows keep their pages in this slice', () => {
    expect(NAV_ITEMS.filter((i) => i.rail)).toEqual([]);
  });
});

describe('isNavItemActive', () => {
  it.each([
    ['/dashboard', 'Dashboard'],
    ['/fleet', 'Fleet'],
    ['/robots/r-1', 'Fleet'],
    ['/robots/r-1/cockpit', 'Control Center'],
    ['/patrol/routes/new', 'Patrol'],
    ['/patrol/runs/run-1', 'Patrol'],
    ['/tour/routes/abc', 'Guide'],
    ['/incidents/i-1', 'Alerts'],
    ['/sites/s-1', 'Digital Twin'],
    ['/datasets/d-1/episodes', 'Datasets'],
    ['/data-collection/new', 'Data Collection'],
    ['/fleet-learning/rounds/1', 'Fleet Learning'],
    ['/marketplace/mine', 'Marketplace'],
    ['/deployments/dep-1', 'Deployments'],
    ['/docs/architecture', 'Docs'],
  ])('%s → %s', (pathname, label) => {
    expect(activeFor(pathname)).toEqual([label]);
  });

  it('is segment-aware: /fleet is not active on /fleet-learning', () => {
    expect(isNavItemActive(item('Fleet'), '/fleet-learning')).toBe(false);
  });

  it('marks nothing on a page outside the nav', () => {
    expect(activeFor('/account')).toEqual([]);
  });
});

describe('navDestinations', () => {
  const destinations = navDestinations(NAV_GROUPS);
  const paths = destinations.map((d) => d.path);

  it('enumerates every row, every rail item and every tab exactly once', () => {
    const rows = NAV_ITEMS.length;
    const railItems = NAV_ITEMS.reduce((n, i) => n + (i.rail?.length ?? 0), 0);
    const tabs = NAV_ITEMS.reduce(
      (n, i) =>
        n +
        (i.tabs?.length ?? 0) +
        (i.rail ?? []).reduce((m, stop) => m + (stop.tabs?.length ?? 0), 0),
      0,
    );
    expect(destinations).toHaveLength(rows + railItems + tabs);
    const keys = destinations.map((d) => `${d.kind} ${d.row} ${d.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the model order, top to bottom', () => {
    expect(destinations[0]).toMatchObject({
      label: 'Dashboard',
      path: '/dashboard',
      kind: 'row',
      row: 'Dashboard',
      group: undefined,
    });
    expect(paths.indexOf('/alerts')).toBeLessThan(paths.indexOf('/agent'));
  });

  it('writes the first tab as the bare path and every later tab as ?tab=id', () => {
    expect(paths).toContain('/fleet');
    expect(paths).toContain('/fleet?tab=list');
    expect(paths).not.toContain('/fleet?tab=map');
    expect(paths).toContain('/compliance?tab=privacy');
    expect(paths).not.toContain('/compliance?tab=overview');
  });

  it("shares a page's URL between its row and its first tab — the palette dedupes on path", () => {
    expect(destinations.filter((d) => d.path === '/fleet').map((d) => [d.kind, d.label])).toEqual([
      ['row', 'Fleet'],
      ['tab', 'Map'],
    ]);
  });

  it('carries the owning group and row, group undefined for the bookends', () => {
    expect(destinations.find((d) => d.path === '/compliance?tab=audit')).toMatchObject({
      label: 'Audit trail',
      kind: 'tab',
      row: 'Compliance',
      group: undefined,
    });
    expect(destinations.find((d) => d.path === '/patrol')?.group).toBe('Automate');
    expect(destinations.find((d) => d.path === '/training?tab=simulation')).toMatchObject({
      row: 'Training',
      group: 'Build',
    });
  });

  it("hangs a railed row's tabs off the rail stops, not off the row", () => {
    const fixture: NavGroup[] = [
      {
        id: 'automate',
        label: 'Automate',
        items: [
          {
            label: 'Missions',
            path: '/patrol',
            icon: Route,
            rail: [
              {
                label: 'Patrol',
                path: '/patrol',
                icon: Route,
                tabs: [
                  { id: 'routes', label: 'Routes' },
                  { id: 'runs', label: 'Runs' },
                ],
              },
              { label: 'Automations', path: '/processes', icon: Workflow },
            ],
          },
        ],
      },
    ];
    expect(navDestinations(fixture).map((d) => [d.kind, d.path, d.row])).toEqual([
      ['row', '/patrol', 'Missions'],
      ['rail', '/patrol', 'Patrol'],
      ['tab', '/patrol', 'Patrol'],
      ['tab', '/patrol?tab=runs', 'Patrol'],
      ['rail', '/processes', 'Automations'],
    ]);
  });
});

describe('filterNavGroups', () => {
  const labels = (groups: ReturnType<typeof filterNavGroups>) => groups.map((g) => g.label);

  it('hides Admin while multi-tenancy is off, whatever the role', () => {
    expect(labels(filterNavGroups(NAV_GROUPS, { multiTenancyEnabled: false }, 'super-admin'))).not.toContain('Admin');
  });

  it('shows owners Team but not Organizations', () => {
    const admin = filterNavGroups(NAV_GROUPS, { multiTenancyEnabled: true }, 'owner').find((g) => g.id === 'admin');
    expect(admin?.items.map((i) => i.label)).toEqual(['Team']);
  });

  it('shows super-admins both admin entries', () => {
    const admin = filterNavGroups(NAV_GROUPS, { multiTenancyEnabled: true }, 'super-admin').find(
      (g) => g.id === 'admin'
    );
    expect(admin?.items.map((i) => i.label)).toEqual(['Organizations', 'Team']);
  });

  it('hides Admin from members even with multi-tenancy on', () => {
    expect(labels(filterNavGroups(NAV_GROUPS, { multiTenancyEnabled: true }, 'member'))).not.toContain('Admin');
  });
});
