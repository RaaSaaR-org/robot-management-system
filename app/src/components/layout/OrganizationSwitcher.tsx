/**
 * @file OrganizationSwitcher.tsx
 * @description Compact pill + menu in the top bar showing the current
 * organization. For super-admins it expands into a picker of every
 * organization on the platform with a one-click "view as" action; the
 * choice is persisted in localStorage and every API request then carries
 * an `X-Impersonate-Tenant` header.
 *
 * Non-super-admin roles see the same pill but without the menu — they can
 * only ever be in their own organization. Hidden entirely when
 * multi-tenancy is off.
 * @feature layout
 */

import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, ChevronDown, LogOut } from 'lucide-react';
import { useFeatures } from '@/shared/hooks';
import { useOrganizationsStore } from '@/features/organizations';
import { useAuthStore, selectUserRole } from '@/features/auth/store/authStore';
import { impersonationStorage } from '@/api/client';
import type { TenantSettings } from '@/features/organizations/types/organizations.types';
import { focusRing, labelCaps, toneTag } from '@/shared/components/ui/styles';
import { cn } from '@/shared/utils/cn';
import { topBarMenuItem, topBarMenuPanel, useTopBarMenu } from './useTopBarMenu';

const pill =
  'inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-control border px-2.5 text-[13px] transition-colors duration-150';

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

  const menu = useTopBarMenu();
  const [impersonating, setImpersonating] = useState<string | null>(() => impersonationStorage.get());

  useEffect(() => {
    if (!multiTenancyEnabled) return;
    if (!currentLoaded && !currentLoading) void fetchCurrent();
  }, [multiTenancyEnabled, currentLoaded, currentLoading, fetchCurrent]);

  // Lazy-load the tenant list only when a super-admin opens the menu.
  useEffect(() => {
    if (!menu.open || !isSuperAdmin) return;
    if (!listLoaded && !listLoading) void fetchList();
  }, [menu.open, isSuperAdmin, listLoaded, listLoading, fetchList]);

  const brandColor = useMemo(() => {
    if (!current?.settings) return undefined;
    try {
      return (JSON.parse(current.settings) as TenantSettings).brandColor;
    } catch {
      return undefined;
    }
  }, [current?.settings]);

  if (!multiTenancyEnabled || !current) return null;

  const handleSwitch = (tenantId: string) => {
    if (tenantId === current.id && !impersonating) {
      menu.close();
      return;
    }
    impersonationStorage.set(tenantId);
    window.location.reload();
  };

  const handleExitImpersonation = () => {
    impersonationStorage.clear();
    setImpersonating(null);
    window.location.reload();
  };

  const label = current.name;
  // A tenant's brand colour tints only the pill's border — never a fill.
  const brandStyle = !impersonating && brandColor ? { borderColor: `${brandColor}80` } : undefined;
  const mark = current.logoUrl ? (
    <img src={current.logoUrl} alt="" className="h-4 w-4 rounded-sm object-contain" />
  ) : (
    <Building2 className={cn('h-4 w-4 shrink-0', impersonating ? 'text-signal-unknown' : 'text-accent')} strokeWidth={1.75} aria-hidden="true" />
  );

  if (!isSuperAdmin) {
    return (
      <span
        className={cn(pill, 'hidden sm:inline-flex border-line bg-panel text-ink-secondary')}
        style={brandStyle}
        title={`Current organization: ${label}`}
      >
        {mark}
        <span className="truncate font-medium text-ink-primary">{label}</span>
      </span>
    );
  }

  return (
    <div className="relative hidden sm:block" ref={menu.rootRef}>
      <button
        ref={menu.triggerRef}
        type="button"
        onClick={menu.toggle}
        className={cn(
          pill,
          focusRing,
          impersonating
            ? toneTag.warning
            : 'border-line bg-panel text-ink-secondary hover:border-line-strong hover:text-ink-primary',
        )}
        style={brandStyle}
        title={impersonating ? `Impersonating ${label}` : `Current organization: ${label}`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
      >
        {mark}
        <span className="truncate font-medium">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" strokeWidth={1.75} aria-hidden="true" />
      </button>

      {menu.open && (
        <div
          ref={menu.menuRef}
          role="menu"
          aria-label="View as organization"
          onKeyDown={menu.onMenuKeyDown}
          className={cn(topBarMenuPanel, 'w-72')}
        >
          <div className="border-b border-line-subtle px-3.5 py-3">
            <div className={labelCaps}>View as organization</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-tertiary">
              Super-admin troubleshooting. Every API request scopes to the selected organization until you exit.
            </p>
          </div>

          <div className="max-h-80 overflow-y-auto p-1">
            {!listLoaded && listLoading && <div className="px-2.5 py-2 text-xs text-ink-tertiary">Loading…</div>}
            {listLoaded && list.length === 0 && (
              <div className="px-2.5 py-2 text-xs text-ink-tertiary">No organizations.</div>
            )}
            {list.map((org) => {
              const isActive = org.id === current.id;
              return (
                <button
                  key={org.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  tabIndex={-1}
                  onClick={() => handleSwitch(org.id)}
                  className={cn(topBarMenuItem, 'justify-between py-2')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink-primary">{org.name}</span>
                    <span className="block truncate text-xs text-ink-tertiary">
                      {org.slug}
                      {org.isDefault && ' · default'}
                    </span>
                  </span>
                  {isActive && <Check className="text-primary" strokeWidth={1.75} aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          {impersonating && (
            <div className="border-t border-line-subtle p-1">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={handleExitImpersonation}
                className={cn(topBarMenuItem, 'h-9 text-signal-unknown hover:text-signal-unknown focus:text-signal-unknown')}
              >
                <LogOut strokeWidth={1.75} aria-hidden="true" />
                <span>Exit impersonation</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
