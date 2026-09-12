/**
 * @file navigation.test.ts
 * @description The nav model: group order and the two unlabelled bookends,
 *              the tabs and the rail a row declares, which entry is active for
 *              nested and foreign detail routes, the flattened destinations
 *              the palette reads, the feature/role gates — and the one thing
 *              the model implies about the pages: a page under a rail draws no
 *              pipeline chip of its own.
 * @feature layout
 */

import { describe, it, expect } from 'vitest';
import { Building2, Route, Users, Workflow } from 'lucide-react';
import {
  NAV_GROUPS,
  NAV_ITEMS,
  filterNavGroups,
  isNavItemActive,
  navDestinations,
  type NavGroup,
} from '../navigation';

/** Labels of every entry the sidebar would offer — the row count, in other words. */
const rowLabels = NAV_ITEMS.map((i) => i.label);

// The pages of the Build group, as raw source. A rail stop and the
// PipelineBreadcrumb say the same thing twice, so the chip left the pages the
// Skill Training rail covers (TASK-278) — an absence no render of a single
// page can prove, hence the source text. import.meta.glob rather than node:fs,
// for the reason design-drift.test.ts gives: the app's tsconfig carries no Node
// types, and Vite resolves the glob when it transforms this file.
const BUILD_PAGES = import.meta.glob<string>(
  [
    '../../../features/datacollection/pages/DataCollectionPage.tsx',
    '../../../features/datacollection/pages/NewSessionPage.tsx',
    '../../../features/datacollection/pages/SessionDetailPage.tsx',
    '../../../features/training/pages/DatasetsPage.tsx',
    '../../../features/training/pages/DatasetEpisodesPage.tsx',
    '../../../features/training/pages/TrainingPage.tsx',
    '../../../features/deployment/pages/DeploymentsPage.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
);

const source = (file: string) => {
  const key = Object.keys(BUILD_PAGES).find((k) => k.endsWith(`/${file}`));
  if (!key) throw new Error(`no source for ${file}`);
  return BUILD_PAGES[key];
};

const item = (label: string) => {
  const found = NAV_ITEMS.find((i) => i.label === label);
  if (!found) throw new Error(`no nav item ${label}`);
  return found;
};

/** Labels of every entry active for a URL — exactly one is expected. */
const activeFor = (pathname: string) => NAV_ITEMS.filter((i) => isNavItemActive(i, pathname)).map((i) => i.label);

describe('NAV_GROUPS', () => {
  it('follows the contract order, with Dashboard and Comply unlabelled', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(['dashboard', 'operate', 'automate', 'build', 'comply']);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([undefined, 'Operate', 'Automate', 'Build', undefined]);
  });

  it('is down to the contract 10 rows, in contract order', () => {
    expect(rowLabels).toEqual([
      'Dashboard',
      'Fleet',
      'Control Center',
      'Alerts',
      'Agent Mode',
      'Missions',
      'Skill Training',
      'Deployments',
      'Marketplace',
      'Compliance',
    ]);
  });

  it('keeps the pages of the thirteen rows it dropped, only not as rows', () => {
    // The twin went into a Fleet tab (TASK-276), Guide and Automations into the
    // Missions rail (TASK-277), the five stages into the Skill Training rail
    // (TASK-278), and the last five into the chrome (TASK-279): Updates into
    // Settings, Docs into the top bar, Settings into the user menu, and
    // Organizations and Team into the organization switcher.
    const paths = NAV_ITEMS.map((i) => i.path);
    for (const gone of [
      '/sites',
      '/tour',
      '/processes',
      '/data-collection',
      '/datasets',
      '/training',
      '/models',
      '/fleet-learning',
      '/updates',
      '/docs',
      '/settings',
      '/organizations',
      '/team',
    ]) {
      expect(paths).not.toContain(gone);
    }
  });

  it('leaves every shipped group ungated: the one gate the model had left with Admin', () => {
    // The gates themselves stay in the model — see filterNavGroups below.
    expect(NAV_GROUPS.filter((g) => g.requiresFeature || g.requiresRole)).toEqual([]);
    expect(NAV_ITEMS.filter((i) => i.requiresRole)).toEqual([]);
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

  it('is down to Skill Training · Deployments · Marketplace in Build', () => {
    const build = NAV_GROUPS.find((g) => g.id === 'build')!;
    expect(build.items.map((i) => i.label)).toEqual(['Skill Training', 'Deployments', 'Marketplace']);
    expect(item('Skill Training').path).toBe('/pipeline');
    // Deployments keeps a row: it is the seam where Build hands over to
    // Operate, so it hangs under no rail.
    expect(item('Deployments').rail).toBeUndefined();
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
    expect(item('Deployments').tabs?.map((t) => t.label)).toEqual(['Deployments', 'Skills']);
    for (const label of ['Dashboard', 'Control Center', 'Agent Mode', 'Marketplace']) {
      expect(item(label).tabs).toBeUndefined();
    }
    // A railed row declares no tabs: the tabs belong to the stops' pages.
    expect(item('Missions').tabs).toBeUndefined();
    expect(item('Skill Training').tabs).toBeUndefined();
  });

  it('declares a rail on exactly two rows', () => {
    expect(NAV_ITEMS.filter((i) => i.rail).map((i) => i.label)).toEqual(['Missions', 'Skill Training']);
  });

  it('gives Missions the rail Patrol · Guide · Automations, tabs and all', () => {
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

  it('gives Skill Training the six pipeline stops, tabs and all', () => {
    const rail = item('Skill Training').rail!;
    expect(rail.map((stop) => [stop.label, stop.path])).toEqual([
      ['Overview', '/pipeline'],
      ['Collect', '/data-collection'],
      ['Datasets', '/datasets'],
      ['Train', '/training'],
      ['Models', '/models'],
      ['Learning', '/fleet-learning'],
    ]);
    // Copied verbatim from each stage page's own TABS const.
    expect(rail[1].tabs).toEqual([
      { id: 'sessions', label: 'Sessions' },
      { id: 'priorities', label: 'Priorities' },
      { id: 'uncertainty', label: 'Uncertainty' },
    ]);
    expect(rail[3].tabs).toEqual([
      { id: 'jobs', label: 'Jobs' },
      { id: 'simulation', label: 'Simulation' },
      { id: 'evaluation', label: 'Evaluation' },
    ]);
    expect(rail[5].tabs?.map((t) => t.label)).toEqual(['Rounds', 'Convergence', 'Privacy', 'ROHE']);
    // The overview, the dataset list and the model registry own no tab bar.
    for (const index of [0, 2, 4]) expect(rail[index].tabs).toBeUndefined();
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
    // The eleven URLs the one Skill Training row owns: its own /pipeline plus
    // the five stages it claims through alsoActiveOn, detail routes included.
    ['/pipeline', 'Skill Training'],
    ['/data-collection', 'Skill Training'],
    ['/data-collection/new', 'Skill Training'],
    ['/data-collection/sess-1', 'Skill Training'],
    ['/data-collection/record/sess-1', 'Skill Training'],
    ['/datasets', 'Skill Training'],
    ['/datasets/d-1/episodes', 'Skill Training'],
    ['/training', 'Skill Training'],
    ['/models', 'Skill Training'],
    ['/fleet-learning', 'Skill Training'],
    ['/fleet-learning/rounds/1', 'Skill Training'],
    ['/marketplace/mine', 'Marketplace'],
    ['/deployments/dep-1', 'Deployments'],
  ])('%s → %s', (pathname, label) => {
    expect(activeFor(pathname)).toEqual([label]);
  });

  it('is segment-aware: /fleet is not active on /fleet-learning, and back', () => {
    expect(isNavItemActive(item('Fleet'), '/fleet-learning')).toBe(false);
    expect(isNavItemActive(item('Skill Training'), '/fleet')).toBe(false);
  });

  it('leaves Agent Mode dark on every Missions URL', () => {
    for (const pathname of ['/patrol', '/patrol/routes/new', '/tour', '/tour?tab=visits', '/processes/p-1']) {
      expect(isNavItemActive(item('Agent Mode'), pathname)).toBe(false);
    }
  });

  it('marks nothing on a page outside the nav', () => {
    expect(activeFor('/account')).toEqual([]);
  });

  it.each(['/docs', '/docs/architecture', '/settings', '/settings?tab=updates', '/updates', '/team', '/organizations'])(
    'leaves the whole sidebar dark on %s — it is chrome, not navigation (TASK-279)',
    (pathname) => {
      expect(activeFor(pathname)).toEqual([]);
    },
  );
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

  it('reaches every pipeline stage and every later stage tab', () => {
    for (const path of [
      '/pipeline',
      '/data-collection',
      '/data-collection?tab=priorities',
      '/datasets',
      '/training',
      '/training?tab=simulation',
      '/models',
      '/fleet-learning',
      '/fleet-learning?tab=privacy',
    ]) {
      expect(paths).toContain(path);
    }
    // A first tab is written by deleting the param, so it never appears.
    expect(paths).not.toContain('/data-collection?tab=sessions');
    expect(paths).not.toContain('/training?tab=jobs');
    expect(paths).not.toContain('/fleet-learning?tab=rounds');
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
      row: 'Train',
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
  // The gates outlived the group that used them: Admin moved into the
  // organization switcher (TASK-279) and no shipped group declares a gate any
  // more. They are tested against the fixture that group was, because that is
  // the shape the next gated group — and the palette reading it — will have.
  const ADMIN: NavGroup = {
    id: 'admin',
    label: 'Admin',
    requiresFeature: 'multiTenancyEnabled',
    requiresRole: ['super-admin', 'owner'],
    items: [
      { label: 'Organizations', path: '/organizations', icon: Building2, requiresRole: ['super-admin'] },
      { label: 'Team', path: '/team', icon: Users, requiresRole: ['super-admin', 'owner'] },
    ],
  };
  const gated = [...NAV_GROUPS, ADMIN];
  const labels = (groups: ReturnType<typeof filterNavGroups>) => groups.map((g) => g.label);

  it('hides a feature-gated group while the flag is off, whatever the role', () => {
    expect(labels(filterNavGroups(gated, { multiTenancyEnabled: false }, 'super-admin'))).not.toContain('Admin');
  });

  it('drops the items an owner may not see, keeping the group', () => {
    const admin = filterNavGroups(gated, { multiTenancyEnabled: true }, 'owner').find((g) => g.id === 'admin');
    expect(admin?.items.map((i) => i.label)).toEqual(['Team']);
  });

  it('keeps every item for the role that may see them all', () => {
    const admin = filterNavGroups(gated, { multiTenancyEnabled: true }, 'super-admin').find((g) => g.id === 'admin');
    expect(admin?.items.map((i) => i.label)).toEqual(['Organizations', 'Team']);
  });

  it('hides a role-gated group from members even with the flag on', () => {
    expect(labels(filterNavGroups(gated, { multiTenancyEnabled: true }, 'member'))).not.toContain('Admin');
  });

  it('passes the shipped model through untouched — nothing in it is gated', () => {
    expect(filterNavGroups(NAV_GROUPS, { multiTenancyEnabled: false }, 'viewer').flatMap((g) => g.items)).toEqual(
      NAV_ITEMS,
    );
  });
});

describe('PipelineBreadcrumb', () => {
  it.each([
    'DataCollectionPage.tsx',
    'NewSessionPage.tsx',
    'SessionDetailPage.tsx',
    'DatasetsPage.tsx',
    'DatasetEpisodesPage.tsx',
    'TrainingPage.tsx',
  ])('is gone from %s — the rail above it already offers Overview and every sibling', (file) => {
    expect(source(file)).not.toContain('PipelineBreadcrumb');
  });

  it('stays on DeploymentsPage, the one stage with no rail over it', () => {
    expect(source('DeploymentsPage.tsx')).toContain('<PipelineBreadcrumb stage="deploy" />');
  });
});
