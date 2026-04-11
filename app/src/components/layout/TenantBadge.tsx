/**
 * @file TenantBadge.tsx
 * @description Small pill shown in the TopBar that displays the current
 * tenant's name when multi-tenancy is enabled. Renders nothing otherwise
 * (zero visual noise for single-tenant deployments). Lazily triggers a
 * `fetchCurrent()` on first mount so it doesn't block app boot.
 * @feature layout
 */

import { useEffect } from 'react';
import { useFeatures } from '@/shared/hooks';
import { useOrganizationsStore } from '@/features/organizations';

const BuildingIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);

export function TenantBadge() {
  const { multiTenancyEnabled } = useFeatures();
  const current = useOrganizationsStore((s) => s.current);
  const loaded = useOrganizationsStore((s) => s.currentLoaded);
  const loading = useOrganizationsStore((s) => s.currentLoading);
  const fetchCurrent = useOrganizationsStore((s) => s.fetchCurrent);

  useEffect(() => {
    if (!multiTenancyEnabled) return;
    if (!loaded && !loading) void fetchCurrent();
  }, [multiTenancyEnabled, loaded, loading, fetchCurrent]);

  if (!multiTenancyEnabled || !current) return null;

  return (
    <span
      className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-theme-elevated border border-theme text-xs text-theme-secondary"
      title={`Current organization: ${current.name}`}
    >
      <span className="text-cobalt">
        <BuildingIcon />
      </span>
      <span className="font-medium text-theme-primary">{current.name}</span>
    </span>
  );
}
