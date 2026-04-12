/**
 * @file ImpersonationBanner.tsx
 * @description Prominent amber banner shown below TopBar when a super-admin
 * is impersonating another tenant. Non-dismissable — the only way to remove
 * it is to stop impersonating.
 * @feature layout
 */

import { useEffect, useState } from 'react';
import { impersonationStorage } from '@/api/client';
import { useOrganizationsStore } from '@/features/organizations';

export function ImpersonationBanner() {
  const [impersonatedTenantId, setImpersonatedTenantId] = useState<string | null>(
    () => impersonationStorage.get()
  );
  const current = useOrganizationsStore((s) => s.current);

  // Re-check on mount (storage may change across navigations)
  useEffect(() => {
    setImpersonatedTenantId(impersonationStorage.get());
  }, []);

  if (!impersonatedTenantId) return null;

  const tenantName = current?.name ?? impersonatedTenantId;

  const handleStop = () => {
    impersonationStorage.clear();
    window.location.reload();
  };

  return (
    <div className="fixed top-14 left-0 right-0 z-40 bg-amber-500/15 border-b border-amber-500/30 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-2 text-sm">
        <div className="flex items-center gap-2 text-amber-200">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>
            Viewing as <strong className="text-amber-100">{tenantName}</strong> — all data shown belongs to this organization
          </span>
        </div>
        <button
          onClick={handleStop}
          className="flex-shrink-0 px-3 py-1 text-xs font-medium rounded bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 border border-amber-500/30 transition-colors"
        >
          Stop impersonating
        </button>
      </div>
    </div>
  );
}
