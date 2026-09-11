/**
 * @file ImpersonationBanner.tsx
 * @description Warning-tone strip at the top of the content column while a
 * super-admin is impersonating another tenant. Non-dismissable — the only way
 * to remove it is to stop impersonating.
 * @feature layout
 */

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { impersonationStorage } from '@/api/client';
import { useOrganizationsStore } from '@/features/organizations';
import { Button } from '@/shared/components/ui/Button';

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
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-control border border-signal-unknown/30 bg-signal-unknown/10 px-4 py-2.5 text-sm"
    >
      <div className="flex min-w-0 items-center gap-2.5 text-ink-secondary">
        <Eye className="h-4 w-4 shrink-0 text-signal-unknown" strokeWidth={1.75} aria-hidden="true" />
        <span>
          Viewing as <strong className="font-semibold text-ink-primary">{tenantName}</strong> — all data shown
          belongs to this organization
        </span>
      </div>
      <Button variant="secondary" size="sm" onClick={handleStop}>
        Stop impersonating
      </Button>
    </div>
  );
}
