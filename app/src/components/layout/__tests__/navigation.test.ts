/**
 * @file navigation.test.ts
 * @description The nav model: group order, which entry is active for nested
 *              and foreign detail routes, and the feature/role gates.
 * @feature layout
 */

import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, filterNavGroups, isNavItemActive } from '../navigation';

const item = (label: string) => {
  const found = NAV_ITEMS.find((i) => i.label === label);
  if (!found) throw new Error(`no nav item ${label}`);
  return found;
};

/** Labels of every entry active for a URL — exactly one is expected. */
const activeFor = (pathname: string) => NAV_ITEMS.filter((i) => isNavItemActive(i, pathname)).map((i) => i.label);

describe('NAV_GROUPS', () => {
  it('follows the contract order: Overview · Operate · Build · Comply · System · Admin', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Overview', 'Operate', 'Build', 'Comply', 'System', 'Admin']);
  });

  it('puts Models in Build between Training and Deployments', () => {
    const build = NAV_GROUPS.find((g) => g.id === 'build')!;
    const labels = build.items.map((i) => i.label);
    expect(labels.indexOf('Models')).toBe(labels.indexOf('Training') + 1);
    expect(labels[labels.indexOf('Models') + 1]).toBe('Deployments');
    expect(item('Models').path).toBe('/models');
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
