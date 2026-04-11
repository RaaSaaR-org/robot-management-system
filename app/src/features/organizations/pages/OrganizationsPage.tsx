/**
 * @file OrganizationsPage.tsx
 * @description Customer organizations management page. Lists all tenants
 * and lets the platform operator create/delete them. Visible only when
 * `multiTenancyEnabled` is true — the sidebar entry is gated, but the
 * route is deliberately still mounted so direct navigation works.
 * @feature organizations
 */

import { useEffect, useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { useFeatures } from '@/shared/hooks';
import { useOrganizationsStore } from '../store/organizationsStore';
import { OrganizationCard } from '../components/OrganizationCard';
import { OrganizationsEmptyState } from '../components/OrganizationsEmptyState';
import { CreateOrganizationModal } from '../components/CreateOrganizationModal';

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const SAMPLE_ORG = { name: 'Acme Robotics', slug: 'acme' };

export function OrganizationsPage() {
  const { multiTenancyEnabled } = useFeatures();

  const list = useOrganizationsStore((s) => s.list);
  const listLoaded = useOrganizationsStore((s) => s.listLoaded);
  const listLoading = useOrganizationsStore((s) => s.listLoading);
  const error = useOrganizationsStore((s) => s.error);
  const fetchList = useOrganizationsStore((s) => s.fetchList);
  const remove = useOrganizationsStore((s) => s.remove);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalPrefill, setModalPrefill] = useState<{ name: string; slug: string } | undefined>();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!listLoaded && !listLoading) {
      void fetchList();
    }
  }, [listLoaded, listLoading, fetchList]);

  // Auto-dismiss toast after 2.5s
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const handleCreate = () => {
    setModalPrefill(undefined);
    setModalOpen(true);
  };

  const handleLoadSample = () => {
    setModalPrefill(SAMPLE_ORG);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await remove(id);
      setToast('Organization deleted');
    } catch (err) {
      setToast(
        err instanceof Error ? err.message : 'Failed to delete organization'
      );
    }
  };

  const handleCreated = (name: string) => {
    setToast(`${name} created`);
  };

  // Show everything except DEFAULT in the "customer" list; DEFAULT always
  // renders first so the operator has an anchor.
  const ordered = [...list].sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const customerCount = list.filter((o) => !o.isDefault).length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
      {/* Disabled-mode banner */}
      {!multiTenancyEnabled && (
        <div className="mb-6 rounded-brand border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <strong className="font-semibold">Multi-tenancy is disabled.</strong> Set{' '}
          <code className="font-mono">MULTI_TENANCY_ENABLED=true</code> in{' '}
          <code className="font-mono">server/.env</code> and restart to activate
          row-level isolation.
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-theme-primary">Organizations</h1>
          <p className="text-sm text-theme-secondary mt-1">
            Customer tenants on this NeoDEM instance. Each organization sees only
            its own robots, datasets, and training jobs.
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={handleCreate}
          leftIcon={<PlusIcon />}
        >
          Create organization
        </Button>
      </div>

      {/* Summary strip */}
      {listLoaded && (
        <div className="mb-6 flex items-center gap-6 text-sm text-theme-tertiary">
          <span>
            <span className="text-theme-primary font-semibold tabular-nums">
              {list.length}
            </span>{' '}
            total
          </span>
          <span>
            <span className="text-theme-primary font-semibold tabular-nums">
              {customerCount}
            </span>{' '}
            customer
            {customerCount === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-brand border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Content */}
      {!listLoaded && listLoading ? (
        <div className="text-sm text-theme-tertiary">Loading organizations…</div>
      ) : customerCount === 0 && list.length > 0 ? (
        <div className="space-y-4">
          {ordered.map((org) => (
            <OrganizationCard
              key={org.id}
              organization={org}
              onDelete={handleDelete}
            />
          ))}
          <OrganizationsEmptyState
            onCreate={handleCreate}
            onLoadSample={handleLoadSample}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {ordered.map((org) => (
            <OrganizationCard
              key={org.id}
              organization={org}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-brand border border-theme bg-theme-card px-4 py-3 text-sm text-theme-primary shadow-xl animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}

      {/* Create modal */}
      <CreateOrganizationModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        prefill={modalPrefill}
        onCreated={handleCreated}
      />
    </div>
  );
}
