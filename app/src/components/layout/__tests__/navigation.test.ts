/**
 * @file navigation.test.ts
 * @description The nav model: group order and the two unlabelled bookends,
 *              the tabs and the rail a row declares, which entry is active for
 *              nested and foreign detail routes, the flattened destinations
 *              the palette reads, and the feature/role gates.
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

  it('is down to 20 rows: Digital Twin is a Fleet tab, Guide and Automations are rail stops', () => {
    expect(NAV_ITEMS).toHaveLength(20);
    // Their pages are unchanged; only their rows are gone.
    expect(NAV_ITEMS.map((i) => i.path)).not.toContain('/sites');
    expect(NAV_ITEMS.map((i) => i.path)).not.toContain('/tour');
    expect(NAV_ITEMS.map((i) => i.path)).not.toContain('/processes');
  });

  it('is down to Agent Mode · Missions in Automate', () => {
    const automate = NAV_GROUPS.find((g) => g.id === 'automate')!;
    expect(automate.items.map((i) => i.label)).toEqual(['Agent Mode', 'Missions']);
    expect(item('Missions').path).toBe('/patrol');
  });

  it('keeps Operate at Fleet · Control Center · Alerts', () => {
    const operate = NAV_GROUPS.find((g) => g.id === 'operate')!;
    expect(operate.items.map((i) => i.label)).toEqual(['Fleet', 'Control Center', 'Alerts']);
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
      { id: 'sites', label: 'Sites' },
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
    for (const label of ['Dashboard', 'Control Center', 'Agent Mode', 'Datasets', 'Docs']) {
      expect(item(label).tabs).toBeUndefined();
    }
    // A railed row declares no tabs: the tabs belong to the stops' pages.
    expect(item('Missions').tabs).toBeUndefined();
  });

  it('gives Missions the only rail: Patrol · Guide · Automations, tabs and all', () => {
    expect(NAV_ITEMS.filter((i) => i.rail).map((i) => i.label)).toEqual(['Missions']);
    const rail = item('Missions').rail!;
    expect(rail.map((stop) => [stop.label, stop.path])).toEqual([
      ['Patrol', '/patrol'],
      ['Guide', '/tour'],
      ['Automations', '/processes'],
    ]);
    // Copied verbatim from PatrolPage's and TourPage's own TABS consts.
    expect(rail[0].tabs).toEqual([
      { id: 'routes', label: 'Routes' },
      { id: 'runs', label: 'Runs' },
    ]);
    expect(rail[1].tabs).toEqual([
      { id: 'tours', label: 'Tours' },
      { id: 'visits', label: 'Visits' },
    ]);
    // ProcessesPage has no tab bar.
    expect(rail[2].tabs).toBeUndefined();
  });
});

describe('isNavItemActive', () => {
  it.each([
    ['/dashboard', 'Dashboard'],
    ['/fleet', 'Fleet'],
    ['/robots/r-1', 'Fleet'],
    ['/robots/r-1/cockpit', 'Control Center'],
    // The ten URLs the one Missions row owns — its own subtree plus the two
    // it claims through alsoActiveOn.
    ['/patrol', 'Missions'],
    ['/patrol/routes/new', 'Missions'],
    ['/patrol/routes/abc', 'Missions'],
    ['/patrol/runs/run-1', 'Missions'],
    ['/tour', 'Missions'],
    ['/tour/routes/new', 'Missions'],
    ['/tour/routes/abc', 'Missions'],
    ['/tour/runs/run-1', 'Missions'],
    ['/processes', 'Missions'],
    ['/processes/p-1', 'Missions'],
    ['/incidents/i-1', 'Alerts'],
    // The twin viewer is still its own route, reached from Fleet's Sites tab.
    ['/sites/s-1', 'Fleet'],
    ['/sites', 'Fleet'],
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

  it('leaves Agent Mode dark on every Missions URL', () => {
    for (const pathname of ['/patrol', '/patrol/routes/new', '/tour', '/tour?tab=visits', '/processes/p-1']) {
      expect(isNavItemActive(item('Agent Mode'), pathname)).toBe(false);
    }
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
    expect(paths).toContain('/fleet?tab=sites');
    expect(paths).not.toContain('/fleet?tab=map');
    expect(paths).toContain('/compliance?tab=privacy');
    expect(paths).not.toContain('/compliance?tab=overview');
  });

  it('reaches all three Missions pages and both their later tabs', () => {
    expect(paths).toContain('/patrol');
    expect(paths).toContain('/patrol?tab=runs');
    expect(paths).toContain('/tour');
    expect(paths).toContain('/tour?tab=visits');
    expect(paths).toContain('/processes');
    expect(paths).not.toContain('/patrol?tab=routes');
    expect(paths).not.toContain('/tour?tab=tours');
  });

  it("names the row Missions and the stops themselves, so the palette reads a page's own name", () => {
    expect(destinations.filter((d) => d.path === '/patrol').map((d) => [d.kind, d.label])).toEqual([
      ['row', 'Missions'],
      ['rail', 'Patrol'],
      ['tab', 'Routes'],
    ]);
    expect(destinations.find((d) => d.path === '/processes')).toMatchObject({
      label: 'Automations',
      kind: 'rail',
      row: 'Automations',
      group: 'Automate',
    });
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
