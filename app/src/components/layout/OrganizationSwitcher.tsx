/**
 * @file OrganizationSwitcher.tsx
 * @description Compact pill + dropdown in the TopBar showing the
 * current organization. For super-admins it expands into a picker of
 * every organization on the platform with a one-click "view as"
 * action; the choice is persisted in localStorage and every API
 * request then carries an `X-Impersonate-Tenant` header.
 *
 * Non-super-admin roles see the same pill but without the dropdown —
 * they can only ever be in their own organization. Hidden entirely
 * when multi-tenancy is off.
 * @feature layout
 */

import { useEffect, useRef, useState } from 'react';
import { useFeatures } from '@/shared/hooks';
import { useOrganizationsStore } from '@/features/organizations';
import { useAuthStore, selectUserRole } from '@/features/auth/store/authStore';
import { impersonationStorage } from '@/api/client';

const BuildingIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);

const ChevronIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4 text-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

export function OrganizationSwitcher() {
  const { multiTenancyEnabled } = useFeatures();
  const role = useAuthStore(selectUserRole);
  const isSuperAdmin = role === 'super-admin';

  const current = useOrganizationsStore((s) => s.current);
  const currentLoaded = useOrganizationsStore((s) => s.currentLoaded);
  const currentLoading = useOrganizationsStore((s) => s.currentLoading);
  const fetchCurrent = useOrganizationsStore((s) => s.fetchCurrent);
  const list = useOrganizationsStore((s) => s.list);
  const listLoaded = useOrganizationsStore((s) => s.listLoaded);
  const listLoading = useOrganizationsStore((s) => s.listLoading);
  const fetchList = useOrganizationsStore((s) => s.fetchList);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [impersonating, setImpersonating] = useState<string | null>(() => impersonationStorage.get());

  useEffect(() => {
    if (!multiTenancyEnabled) return;
    if (!currentLoaded && !currentLoading) void fetchCurrent();
  }, [multiTenancyEnabled, currentLoaded, currentLoading, fetchCurrent]);

  // Lazy-load the tenant list only when a super-admin opens the menu.
  useEffect(() => {
    if (!open || !isSuperAdmin) return;
    if (!listLoaded && !listLoading) void fetchList();
  }, [open, isSuperAdmin, listLoaded, listLoading, fetchList]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!multiTenancyEnabled || !current) return null;

  const handleSwitch = (tenantId: string) => {
    if (tenantId === current.id && !impersonating) {
      setOpen(false);
      return;
    }
    impersonationStorage.set(tenantId);
    // Force a full reload so every Zustand store rehydrates under the
    // new tenant context — simpler and safer than trying to reset each
    // one manually.
    window.location.reload();
  };

  const handleExitImpersonation = () => {
    impersonationStorage.clear();
    setImpersonating(null);
    window.location.reload();
  };

  const label = current.name;

  if (!isSuperAdmin) {
    return (
      <span
        className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-theme-elevated border border-theme text-xs text-theme-secondary"
        title={`Current organization: ${label}`}
      >
        <span className="text-cobalt">
          <BuildingIcon />
        </span>
        <span className="font-medium text-theme-primary">{label}</span>
      </span>
    );
  }

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors ${
          impersonating
            ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
            : 'bg-theme-elevated border-theme text-theme-secondary hover:text-theme-primary'
        }`}
        title={impersonating ? `Impersonating ${label}` : `Current organization: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className={impersonating ? 'text-amber-200' : 'text-cobalt'}>
          <BuildingIcon />
        </span>
        <span className="font-medium">{label}</span>
        <ChevronIcon />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-72 rounded-brand border border-theme bg-theme-card shadow-xl z-50"
          role="menu"
        >
          <div className="px-3 py-2 border-b border-theme">
            <div className="text-xs uppercase tracking-wider text-theme-tertiary">
              View as organization
            </div>
            <div className="text-xs text-theme-tertiary mt-1">
              Super-admin troubleshooting. Every API request scopes to the
              selected organization until you exit.
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto py-1">
            {!listLoaded && listLoading && (
              <div className="px-3 py-2 text-xs text-theme-tertiary">Loading…</div>
            )}
            {listLoaded && list.length === 0 && (
              <div className="px-3 py-2 text-xs text-theme-tertiary">
                No organizations.
              </div>
            )}
            {list.map((org) => {
              const isActive = org.id === current.id;
              return (
                <button
                  key={org.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSwitch(org.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-theme-primary hover:bg-theme-hover text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{org.name}</div>
                    <div className="text-xs text-theme-tertiary truncate">
                      {org.slug}
                      {org.isDefault && ' · default'}
                    </div>
                  </div>
                  {isActive && <CheckIcon />}
                </button>
              );
            })}
          </div>

          {impersonating && (
            <div className="border-t border-theme px-3 py-2">
              <button
                type="button"
                onClick={handleExitImpersonation}
                className="w-full text-left text-xs text-amber-300 hover:text-amber-200"
              >
                Exit impersonation (return to your own organization)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
