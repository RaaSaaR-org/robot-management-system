/**
 * @file Sidebar.tsx
 * @description Collapsible sidebar navigation with categorized sections
 * @feature layout
 */

import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/shared/utils/cn";
import { useUIStore } from "@/features/settings/store/uiStore";
import { useFeatures } from "@/shared/hooks";
import { useAuthStore, selectUserRole } from "@/features/auth/store/authStore";
import type { UserRole } from "@/features/auth/types/auth.types";

// ============================================================================
// TYPES
// ============================================================================

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
  /**
   * Minimum role required to see this entry. Omit for "any
   * authenticated user" (subject to the category-level gate).
   */
  requiresRole?: UserRole[];
}

interface NavCategory {
  id: string;
  label: string;
  icon: ReactNode;
  items: NavItem[];
  /**
   * Feature flag this category requires. When the flag is false, the
   * category is filtered out of the rendered sidebar. Omit for
   * always-visible groups.
   */
  requiresFeature?: 'multiTenancyEnabled';
  /**
   * Minimum role required to see this category. If set, the whole
   * group (and all its items) is hidden from users whose role is not
   * in the list. Independent from `requiresFeature` — both must pass.
   */
  requiresRole?: UserRole[];
}

// ============================================================================
// ICONS
// ============================================================================

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    className={cn(
      "w-4 h-4 transition-transform duration-200",
      expanded ? "rotate-90" : "rotate-0"
    )}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 5l7 7-7 7"
    />
  </svg>
);

// ============================================================================
// NAVIGATION CATEGORIES
// ============================================================================

const NAV_CATEGORIES: NavCategory[] = [
  {
    id: "main",
    label: "Main",
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    items: [
      {
        label: "Dashboard",
        path: "/dashboard",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "robots",
    label: "Robot Management",
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
      </svg>
    ),
    items: [
      {
        label: "Fleet",
        path: "/fleet",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        ),
      },
      {
        label: "Control Center",
        path: "/control-center",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "Agent Mode",
        path: "/agent",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-4l-3 4-3-4z" />
          </svg>
        ),
      },
      {
        label: "Digital Twin",
        path: "/sites",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11l-7-4-7 4m14 0l-7 4m7-4v6l-7 4m0-10L5 11m7 4v10M5 11v6l7 4" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
    items: [
      {
        label: "Alerts",
        path: "/alerts",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        ),
      },
      {
        label: "Patrol",
        path: "/patrol",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7M12 11.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
          </svg>
        ),
      },
      {
        // Host mode (TASK-213) — the robot with a person in front of it, next
        // to Patrol, which is the robot alone. Icon is lucide's `speech`
        // geometry drawn inline: every entry here is an inline stroke SVG, and
        // importing one lucide component would make this the only odd one out.
        label: "Guide",
        path: "/tour",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.164-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.85 4.7 3 6.3v5.15" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.8 17.8a7.5 7.5 0 0 0 .003-10.603" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 15a3.5 3.5 0 0 0-.025-4.975" />
          </svg>
        ),
      },
      {
        label: "Automations",
        path: "/processes",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "ai",
    label: "Training",
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
    items: [
      // Pipeline overview (entry point) — TASK-143: now framed as the training workflow
      {
        label: "Skill Training",
        path: "/pipeline",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        ),
      },
      // Pipeline stages in order: collect → dataset → train → models → simulate → evaluate → deploy
      {
        label: "Data Collection",
        path: "/data-collection",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "Datasets",
        path: "/datasets",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
        ),
      },
      {
        label: "Training",
        path: "/training",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "Deployments",
        path: "/deployments",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        ),
      },
      {
        label: "Fleet Learning",
        path: "/fleet-learning",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "marketplace",
    label: "Marketplace",
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    ),
    items: [
      {
        label: "Marketplace",
        path: "/marketplace",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    items: [
      {
        label: "Compliance",
        path: "/compliance",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    items: [
      {
        label: "Updates",
        path: "/updates",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        ),
      },
      {
        label: "Docs",
        path: "/docs",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        ),
      },
      {
        label: "Settings",
        path: "/settings",
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
  // Admin group — only visible when multi-tenancy is enabled AND the
  // user is an owner or platform super-admin. Members + viewers don't
  // see this group at all.
  {
    id: "admin",
    label: "Admin",
    requiresFeature: "multiTenancyEnabled",
    requiresRole: ["super-admin", "owner"],
    icon: (
      <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    items: [
      {
        label: "Organizations",
        path: "/organizations",
        // Platform-level cross-tenant view — super-admin only.
        requiresRole: ["super-admin"],
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        ),
      },
      {
        label: "Team",
        path: "/team",
        // Tenant-level team management — owners manage their own tenant;
        // super-admins can reach any team via impersonation.
        requiresRole: ["super-admin", "owner"],
        icon: (
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
    ],
  },
];

// ============================================================================
// PROPS
// ============================================================================

export interface SidebarProps {
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function Sidebar({ className }: SidebarProps) {
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const location = useLocation();
  const features = useFeatures();
  const role = useAuthStore(selectUserRole);

  // Filter out categories gated behind features that are currently off.
  // Then drop categories + per-item entries the user doesn't have the
  // role for. A category with no visible items is dropped entirely.
  const visibleCategories = NAV_CATEGORIES.filter((c) =>
    c.requiresFeature ? features[c.requiresFeature] === true : true
  )
    .filter((c) => !c.requiresRole || (role !== null && c.requiresRole.includes(role)))
    .map((c) => ({
      ...c,
      items: c.items.filter(
        (i) => !i.requiresRole || (role !== null && i.requiresRole.includes(role))
      ),
    }))
    .filter((c) => c.items.length > 0);

  // Track expanded categories - all expanded by default
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(NAV_CATEGORIES.map((c) => c.id))
  );

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  // Check if any item in a category is active
  const isCategoryActive = (category: NavCategory) => {
    return category.items.some((item) => location.pathname === item.path);
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-14 bottom-0",
        "section-secondary border-r border-theme overflow-y-auto",
        "transition-[width] duration-200 ease-in-out",
        "hidden md:block",
        collapsed ? "w-16" : "w-56",
        className
      )}
    >
      <nav className={cn("py-3", collapsed ? "px-2" : "px-3")}>
        {visibleCategories.map((category) => {
          const isExpanded = expandedCategories.has(category.id);
          const hasActiveItem = isCategoryActive(category);
          const isSingleton = category.items.length === 1;

          // Single-item categories render as a flat nav link — no
          // collapsible header. Prevents "Robot Management > Fleet"
          // style redundancy when there's only one child.
          if (isSingleton) {
            const item = category.items[0];
            return (
              <div key={category.id} className="mb-1">
                <NavLink
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      collapsed
                        ? "flex items-center justify-center p-2.5 rounded-brand"
                        : "flex items-center gap-3 px-3 py-2 rounded-brand text-sm",
                      "transition-colors",
                      isActive
                        ? "bg-cobalt text-white"
                        : "text-theme-secondary hover:text-theme-primary hover:bg-theme-hover"
                    )
                  }
                >
                  {item.icon}
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              </div>
            );
          }

          return (
            <div key={category.id} className="mb-1">
              {/* Category Header */}
              {collapsed ? (
                // Collapsed: Show only category icon with tooltip
                <div
                  title={category.label}
                  className={cn(
                    "flex items-center justify-center p-2.5 rounded-brand mb-1",
                    "text-theme-tertiary",
                    hasActiveItem && "text-cobalt"
                  )}
                >
                  {category.icon}
                </div>
              ) : (
                // Expanded: Show clickable category header
                <button
                  onClick={() => toggleCategory(category.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-brand",
                    "text-xs font-semibold uppercase tracking-wider",
                    "text-theme-tertiary hover:text-theme-secondary",
                    "transition-colors",
                    hasActiveItem && "text-cobalt"
                  )}
                >
                  <ChevronIcon expanded={isExpanded} />
                  <span>{category.label}</span>
                </button>
              )}

              {/* Category Items */}
              {!collapsed && (
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-200",
                    isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                  )}
                >
                  <div className="ml-2 space-y-0.5">
                    {category.items.map((item) => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-3 px-3 py-2 rounded-brand",
                            "transition-colors text-sm",
                            isActive
                              ? "bg-cobalt text-white"
                              : "text-theme-secondary hover:text-theme-primary hover:bg-theme-hover"
                          )
                        }
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              )}

              {/* Collapsed: Show items directly */}
              {collapsed && (
                <div className="space-y-0.5">
                  {category.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      title={item.label}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center justify-center p-2.5 rounded-brand",
                          "transition-colors",
                          isActive
                            ? "bg-cobalt text-white"
                            : "text-theme-secondary hover:text-theme-primary hover:bg-theme-hover"
                        )
                      }
                    >
                      {item.icon}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

// Export for backwards compatibility
export const NAV_ITEMS = NAV_CATEGORIES.flatMap((c) => c.items);

/**
 * Return the flattened list of nav items visible to the current user.
 * Same filter rules as the desktop sidebar — feature flags first, then
 * category-level role, then per-item role. Used by MobileNav so mobile
 * and desktop can't drift out of sync.
 */
export function useVisibleNavItems(): NavItem[] {
  const features = useFeatures();
  const role = useAuthStore(selectUserRole);

  return NAV_CATEGORIES.filter((c) =>
    c.requiresFeature ? features[c.requiresFeature] === true : true
  )
    .filter((c) => !c.requiresRole || (role !== null && c.requiresRole.includes(role)))
    .flatMap((c) =>
      c.items.filter(
        (i) => !i.requiresRole || (role !== null && i.requiresRole.includes(role))
      )
    );
}
