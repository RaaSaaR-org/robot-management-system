/**
 * @file RollbackModal.tsx
 * @description Modal dialog for confirming a rollback
 * @feature updates
 */

import { useState } from 'react';
import type { UpdatePackage } from '../types/updates.types';

export interface RollbackModalProps {
  pkg: UpdatePackage;
  onRollback: (packageId: string, robotId: string, targetVersion: string) => void;
  onClose: () => void;
}

export function RollbackModal({ pkg, onRollback, onClose }: RollbackModalProps) {
  const [robotId, setRobotId] = useState('');
  const [targetVersion, setTargetVersion] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (robotId.trim() && targetVersion.trim()) {
      onRollback(pkg.id, robotId.trim(), targetVersion.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="section-primary border border-theme rounded-brand p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-red-500 mb-4">Rollback Update v{pkg.version}</h2>

        <p className="text-sm text-theme-secondary mb-4">
          This will rollback the deployed update and restore a previous version. This action is logged for compliance.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-theme-secondary mb-1">Robot ID</label>
          <input
            type="text"
            value={robotId}
            onChange={(e) => setRobotId(e.target.value)}
            placeholder="Robot to rollback"
            className="w-full px-3 py-2 text-sm border border-theme rounded-brand section-secondary text-theme-primary mb-3"
          />

          <label className="block text-sm font-medium text-theme-secondary mb-1">Target Version</label>
          <input
            type="text"
            value={targetVersion}
            onChange={(e) => setTargetVersion(e.target.value)}
            placeholder="e.g. 1.0.0"
            className="w-full px-3 py-2 text-sm border border-theme rounded-brand section-secondary text-theme-primary mb-4"
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-theme-secondary hover:text-theme-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!robotId.trim() || !targetVersion.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-brand hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Confirm Rollback
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
