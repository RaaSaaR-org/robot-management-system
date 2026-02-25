/**
 * @file UpdatesPage.tsx
 * @description Main page for managing secure OTA updates
 * @feature updates
 * @regulatory CRA Art. 13, MR Art. 10
 */

import { useEffect, useState, useCallback } from 'react';
import { useUpdatesStore, selectPackages, selectIsLoading, selectError } from '../store/updatesStore';
import { UpdateCard } from '../components/UpdateCard';
import { ApproveUpdateModal } from '../components/ApproveUpdateModal';
import { RollbackModal } from '../components/RollbackModal';
import type { UpdatePackage } from '../types/updates.types';

export function UpdatesPage() {
  const packages = useUpdatesStore(selectPackages);
  const isLoading = useUpdatesStore(selectIsLoading);
  const error = useUpdatesStore(selectError);
  const fetchPackages = useUpdatesStore((s) => s.fetchPackages);
  const approvePackage = useUpdatesStore((s) => s.approvePackage);
  const deployPackage = useUpdatesStore((s) => s.deployPackage);
  const triggerRollback = useUpdatesStore((s) => s.triggerRollback);

  const [approveModal, setApproveModal] = useState<UpdatePackage | null>(null);
  const [rollbackModal, setRollbackModal] = useState<UpdatePackage | null>(null);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  const handleApprove = useCallback(
    (id: string, approverId: string) => {
      approvePackage(id, approverId);
    },
    [approvePackage]
  );

  const handleDeploy = useCallback(
    (id: string) => {
      // Deploy to a default robot (in production, this would open a robot selector)
      deployPackage(id, 'default-robot');
    },
    [deployPackage]
  );

  const handleRollback = useCallback(
    (packageId: string, robotId: string, targetVersion: string) => {
      triggerRollback(packageId, robotId, targetVersion);
    },
    [triggerRollback]
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Secure Updates</h1>
          <p className="text-sm text-theme-tertiary mt-1">
            OTA update management with Ed25519 signing (CRA Art. 13, MR Art. 10)
          </p>
        </div>
        <button
          onClick={() => fetchPackages()}
          className="px-4 py-2 text-sm font-medium text-theme-secondary border border-theme rounded-brand hover:bg-theme-hover transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-brand">
          {error}
        </div>
      )}

      {isLoading && packages.length === 0 ? (
        <div className="text-center py-12 text-theme-tertiary">Loading updates...</div>
      ) : packages.length === 0 ? (
        <div className="text-center py-12 text-theme-tertiary">
          No update packages found.
        </div>
      ) : (
        <div className="space-y-4">
          {packages.map((pkg) => (
            <UpdateCard
              key={pkg.id}
              pkg={pkg}
              onApprove={() => setApproveModal(pkg)}
              onDeploy={() => handleDeploy(pkg.id)}
              onRollback={() => setRollbackModal(pkg)}
            />
          ))}
        </div>
      )}

      {approveModal && (
        <ApproveUpdateModal
          pkg={approveModal}
          onApprove={handleApprove}
          onClose={() => setApproveModal(null)}
        />
      )}

      {rollbackModal && (
        <RollbackModal
          pkg={rollbackModal}
          onRollback={handleRollback}
          onClose={() => setRollbackModal(null)}
        />
      )}
    </div>
  );
}
