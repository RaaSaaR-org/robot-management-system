/**
 * @file navigation.ts
 * @description The app's navigation model: the six sidebar groups (Overview ·
 *              Operate · Build · Comply · System · Admin), their feature and
 *              role gates, and the rule that decides which entry is active for
 *              a URL (nested routes included). Sidebar and MobileNav both read
 *              it, so desktop and mobile can never drift apart.
 * @feature layout
 */

import {
  Bell,
  BookOpen,
  Bot,
  Box,
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
}

export interface NavGroup {
  id: string;
  /** Eyebrow label — also the page eyebrow of every page in the group */
  label: string;
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
  {
    id: 'overview',
    label: 'Overview',
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
        // A robot's detail page is reached from the fleet list.
        alsoActiveOn: [/^\/robots\/[^/]+\/?$/],
      },
      {
        label: 'Control Center',
        path: '/control-center',
        icon: Joystick,
        // Opening a specific robot's cockpit is the same page.
        alsoActiveOn: [/^\/robots\/[^/]+\/cockpit\/?$/],
      },
      { label: 'Agent Mode', path: '/agent', icon: BrainCircuit },
      { label: 'Patrol', path: '/patrol', icon: Route },
      // Host mode (TASK-213) — the robot with a person in front of it.
      { label: 'Guide', path: '/tour', icon: Speech },
      { label: 'Automations', path: '/processes', icon: Workflow },
      {
        label: 'Alerts',
        path: '/alerts',
        icon: Bell,
        // Incidents are a tab of Alerts; their detail route stays separate.
        alsoActiveOn: [/^\/incidents(\/|$)/],
      },
      { label: 'Digital Twin', path: '/sites', icon: Box },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    items: [
      // Pipeline overview — the entry point of the training workflow (TASK-143).
      { label: 'Skill Training', path: '/pipeline', icon: GraduationCap },
      // Pipeline stages in order: collect → dataset → train → models → deploy.
      { label: 'Data Collection', path: '/data-collection', icon: Video },
      { label: 'Datasets', path: '/datasets', icon: Database },
      { label: 'Training', path: '/training', icon: Cpu },
      // Model Registry (TASK-238).
      { label: 'Models', path: '/models', icon: Brain },
      { label: 'Deployments', path: '/deployments', icon: Rocket },
      { label: 'Fleet Learning', path: '/fleet-learning', icon: Network },
      { label: 'Marketplace', path: '/marketplace', icon: Store },
    ],
  },
  {
    id: 'comply',
    label: 'Comply',
    items: [{ label: 'Compliance', path: '/compliance', icon: ShieldCheck }],
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
