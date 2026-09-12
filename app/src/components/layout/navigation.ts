/**
 * @file navigation.ts
 * @description The app's navigation model: the sidebar groups (Dashboard ·
 *              Operate · Automate · Build · Comply · System · Admin), the
 *              second level a row can own (its rail, its tabs), the feature and
 *              role gates, and the rule that decides which entry is active for
 *              a URL (nested routes included). Sidebar, MobileNav and
 *              SectionRail all read it, so the levels can never drift apart.
 * @feature layout
 */

import {
  Bell,
  BookOpen,
  Bot,
  Brain,
  BrainCircuit,
  Building2,
  CloudDownload,
  Cpu,
  Database,
  GraduationCap,
  Joystick,
  LayoutDashboard,
  Network,
  Rocket,
  Route,
  Settings,
  ShieldCheck,
  Speech,
  Store,
  Users,
  Video,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useFeatures } from '@/shared/hooks';
import { useAuthStore, selectUserRole } from '@/features/auth/store/authStore';
import type { UserRole } from '@/features/auth/types/auth.types';

// ============================================================================
// TYPES
// ============================================================================

/** One tab of a page, as the page's own `TABS` const declares it. */
export interface NavTab {
  /** The `?tab=` value. The first tab of a page omits the param. */
  id: string;
  label: string;
}

/** One entry of a row's second-level rail. Its own page, its own tabs. */
export interface NavRailItem {
  label: string;
  path: string;
  icon: LucideIcon;
  tabs?: NavTab[];
}

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /**
   * Minimum role required to see this entry. Omit for "any authenticated
   * user" (subject to the group-level gate).
   */
  requiresRole?: UserRole[];
  /**
   * Extra URLs this entry owns besides its own path and everything under it —
   * detail routes that live elsewhere in the URL space (`/robots/:id` belongs
   * to Fleet, `/incidents/:id` to Alerts).
   */
  alsoActiveOn?: RegExp[];
  /** URLs under `path` that belong to another entry instead. */
  notActiveOn?: RegExp[];
  /** Second-level rail rendered by `SectionRail` while this row is active. */
  rail?: NavRailItem[];
  /** This page's own tabs, when it has no rail. First tab = the bare path. */
  tabs?: NavTab[];
}

export interface NavGroup {
  id: string;
  /**
   * Eyebrow label — also the page eyebrow of every page in the group. Omitted
   * for the bookend groups of one row: a label over a single row only repeats
   * it, and its page then carries no eyebrow either.
   */
  label?: string;
  items: NavItem[];
  /**
   * Feature flag the group requires. When the flag is false, the group is
   * hidden. Omit for always-visible groups.
   */
  requiresFeature?: 'multiTenancyEnabled';
  /**
   * Roles allowed to see the group. Independent from `requiresFeature` — both
   * must pass.
   */
  requiresRole?: UserRole[];
}

// ============================================================================
// GROUPS
// ============================================================================

export const NAV_GROUPS: NavGroup[] = [
  // The two bookend groups (dashboard, comply) carry no label: a single row
  // needs no heading over it.
  {
    id: 'dashboard',
    items: [{ label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard }],
  },
  {
    id: 'operate',
    label: 'Operate',
    items: [
      {
        label: 'Fleet',
        path: '/fleet',
        icon: Bot,
        // A robot's detail page is reached from the fleet list, and the twin
        // viewer from the Sites tab — both keep this row lit (TASK-276).
        alsoActiveOn: [/^\/robots\/[^/]+\/?$/, /^\/sites(\/|$)/],
        tabs: [
          { id: 'map', label: 'Map' },
          { id: 'list', label: 'Robots' },
          { id: 'sites', label: 'Sites' },
        ],
      },
      {
        label: 'Control Center',
        path: '/control-center',
        icon: Joystick,
        // Opening a specific robot's cockpit is the same page.
        alsoActiveOn: [/^\/robots\/[^/]+\/cockpit\/?$/],
      },
      {
        label: 'Alerts',
        path: '/alerts',
        icon: Bell,
        // Incidents are a tab of Alerts; their detail route stays separate.
        alsoActiveOn: [/^\/incidents(\/|$)/],
        tabs: [
          { id: 'active', label: 'Active' },
          { id: 'history', label: 'History' },
          { id: 'incidents', label: 'Incidents' },
        ],
      },
    ],
  },
  // Automate — the work a robot does on its own, whether a human kicked it off
  // (Agent Mode) or a schedule did.
  {
    id: 'automate',
    label: 'Automate',
    items: [
      { label: 'Agent Mode', path: '/agent', icon: BrainCircuit },
      {
        label: 'Patrol',
        path: '/patrol',
        icon: Route,
        tabs: [
          { id: 'routes', label: 'Routes' },
          { id: 'runs', label: 'Runs' },
        ],
      },
      // Host mode (TASK-213) — the robot with a person in front of it.
      {
        label: 'Guide',
        path: '/tour',
        icon: Speech,
        tabs: [
          { id: 'tours', label: 'Tours' },
          { id: 'visits', label: 'Visits' },
        ],
      },
      { label: 'Automations', path: '/processes', icon: Workflow },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    items: [
      // Pipeline overview — the entry point of the training workflow (TASK-143).
      { label: 'Skill Training', path: '/pipeline', icon: GraduationCap },
      // Pipeline stages in order: collect → dataset → train → models → deploy.
      {
        label: 'Data Collection',
        path: '/data-collection',
        icon: Video,
        tabs: [
          { id: 'sessions', label: 'Sessions' },
          { id: 'priorities', label: 'Priorities' },
          { id: 'uncertainty', label: 'Uncertainty' },
        ],
      },
      { label: 'Datasets', path: '/datasets', icon: Database },
      {
        label: 'Training',
        path: '/training',
        icon: Cpu,
        tabs: [
          { id: 'jobs', label: 'Jobs' },
          { id: 'simulation', label: 'Simulation' },
          { id: 'evaluation', label: 'Evaluation' },
        ],
      },
      // Model Registry (TASK-238).
      { label: 'Models', path: '/models', icon: Brain },
      {
        label: 'Deployments',
        path: '/deployments',
        icon: Rocket,
        tabs: [
          { id: 'deployments', label: 'Deployments' },
          { id: 'skills', label: 'Skills' },
        ],
      },
      {
        label: 'Fleet Learning',
        path: '/fleet-learning',
        icon: Network,
        tabs: [
          { id: 'rounds', label: 'Rounds' },
          { id: 'convergence', label: 'Convergence' },
          { id: 'privacy', label: 'Privacy' },
          { id: 'rohe', label: 'ROHE' },
        ],
      },
      { label: 'Marketplace', path: '/marketplace', icon: Store },
    ],
  },
  {
    id: 'comply',
    items: [
      {
        label: 'Compliance',
        path: '/compliance',
        icon: ShieldCheck,
        tabs: [
          { id: 'overview', label: 'Overview' },
          { id: 'obligations', label: 'Obligations' },
          { id: 'audit', label: 'Audit trail' },
          { id: 'explainability', label: 'Explainability' },
          { id: 'oversight', label: 'Oversight' },
          { id: 'approvals', label: 'Approvals' },
          { id: 'privacy', label: 'Data privacy' },
        ],
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { label: 'Updates', path: '/updates', icon: CloudDownload },
      { label: 'Docs', path: '/docs', icon: BookOpen },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
  // Admin — only when multi-tenancy is on AND the user is an owner or a
  // platform super-admin. Members and viewers never see the group.
  {
    id: 'admin',
    label: 'Admin',
    requiresFeature: 'multiTenancyEnabled',
    requiresRole: ['super-admin', 'owner'],
    items: [
      {
        label: 'Organizations',
        path: '/organizations',
        // Platform-level cross-tenant view — super-admin only.
        requiresRole: ['super-admin'],
        icon: Building2,
      },
      {
        label: 'Team',
        path: '/team',
        // Owners manage their own tenant; super-admins reach any team via
        // impersonation.
        requiresRole: ['super-admin', 'owner'],
        icon: Users,
      },
    ],
  },
];

/** Every entry, flattened. Kept for older imports. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

// ============================================================================
// ACTIVE MATCHING
// ============================================================================

/**
 * Whether `item` is the current page for `pathname`: its own path or anything
 * below it (segment-aware, so `/fleet` is not active on `/fleet-learning`),
 * plus the extra detail routes it owns.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.notActiveOn?.some((re) => re.test(pathname))) return false;
  if (pathname === item.path || pathname.startsWith(`${item.path}/`)) return true;
  return item.alsoActiveOn?.some((re) => re.test(pathname)) ?? false;
}

// ============================================================================
// DESTINATIONS
// ============================================================================

export type NavDestinationKind = 'row' | 'rail' | 'tab';

export interface NavDestination {
  label: string;
  /** Where clicking it goes, `?tab=` included when it is a tab. */
  path: string;
  kind: NavDestinationKind;
  icon: LucideIcon;
  /** The group's label, or undefined for the unlabelled bookend groups. */
  group?: string;
  /** The row this destination hangs under — its own label for a row. */
  row: string;
}

/**
 * The tabs of one page (a row's own, or a rail stop's) as destinations. Every
 * page writes its first tab by *deleting* `?tab=`, so the first tab's URL is
 * the bare path and only the later ones carry the param.
 */
function tabDestinations(owner: NavRailItem, group?: string): NavDestination[] {
  return (owner.tabs ?? []).map((tab, index) => ({
    label: tab.label,
    path: index === 0 ? owner.path : `${owner.path}?tab=${tab.id}`,
    kind: 'tab' as const,
    // A tab borrows the icon of the page it belongs to — it has none of its own.
    icon: owner.icon,
    group,
    row: owner.label,
  }));
}

/**
 * Every place the navigation can take you: each row, each rail item, each tab.
 * The single enumeration — the palette reads this, so nothing declared in the
 * model can become unreachable.
 *
 * Order is the model's own, top to bottom: the row, then either each rail stop
 * followed by that stop's tabs, or (for a row without a rail) the row's own
 * tabs. A page's first tab shares its owner's URL, by the convention above.
 */
export function navDestinations(groups: NavGroup[]): NavDestination[] {
  const destinations: NavDestination[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      destinations.push({
        label: item.label,
        path: item.path,
        kind: 'row',
        icon: item.icon,
        group: group.label,
        row: item.label,
      });
      if (item.rail) {
        // A row with a rail has no tabs of its own: its page is whatever stop
        // the rail points at, so the tabs hang off the stops.
        for (const stop of item.rail) {
          destinations.push({
            label: stop.label,
            path: stop.path,
            kind: 'rail',
            icon: stop.icon,
            group: group.label,
            row: stop.label,
          });
          destinations.push(...tabDestinations(stop, group.label));
        }
      } else {
        destinations.push(...tabDestinations(item, group.label));
      }
    }
  }
  return destinations;
}

// ============================================================================
// GATES
// ============================================================================

type FeatureFlags = Partial<Record<NonNullable<NavGroup['requiresFeature']>, boolean>>;

/**
 * Apply the gates: feature flag first, then the group's role, then each item's
 * role. A group left with no visible items is dropped.
 */
export function filterNavGroups(
  groups: NavGroup[],
  features: FeatureFlags,
  role: UserRole | null,
): NavGroup[] {
  const roleAllowed = (roles?: UserRole[]) => !roles || (role !== null && roles.includes(role));
  return groups
    .filter((g) => (g.requiresFeature ? features[g.requiresFeature] === true : true))
    .filter((g) => roleAllowed(g.requiresRole))
    .map((g) => ({ ...g, items: g.items.filter((i) => roleAllowed(i.requiresRole)) }))
    .filter((g) => g.items.length > 0);
}

/** The groups the current user may see. */
export function useVisibleNavGroups(): NavGroup[] {
  const features = useFeatures();
  const role = useAuthStore(selectUserRole);
  return filterNavGroups(NAV_GROUPS, features, role);
}

/** The flattened entries the current user may see. */
export function useVisibleNavItems(): NavItem[] {
  return useVisibleNavGroups().flatMap((g) => g.items);
}
