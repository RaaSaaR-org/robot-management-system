/**
 * @file ApproveUpdateModal.tsx
 * @description Modal dialog for approving an update package
 * @feature updates
 */

import { useState } from 'react';
import type { UpdatePackage } from '../types/updates.types';

export interface ApproveUpdateModalProps {
  pkg: UpdatePackage;
  onApprove: (id: string, approverId: string) => void;
  onClose: () => void;
}

export function ApproveUpdateModal({ pkg, onApprove, onClose }: ApproveUpdateModalProps) {
  const [approverId, setApproverId] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (approverId.trim()) {
      onApprove(pkg.id, approverId.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="section-primary border border-theme rounded-brand p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-theme-primary mb-4">Approve Update v{pkg.version}</h2>

        <div className="mb-4">
          <h3 className="text-sm font-medium text-theme-secondary mb-1">Changelog</h3>
          <p className="text-sm text-theme-tertiary">{pkg.changelog}</p>
        </div>

        <div className="mb-4">
          <h3 className="text-sm font-medium text-theme-secondary mb-1">Signature Verification</h3>
          <p className="text-xs text-green-500 font-mono">Ed25519 signature: {pkg.signature.slice(0, 24)}...</p>
          <p className="text-xs text-theme-tertiary font-mono">SHA-256: {pkg.checksum}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-theme-secondary mb-1">
            Approver ID
          </label>
          <input
            type="text"
            value={approverId}
            onChange={(e) => setApproverId(e.target.value)}
            placeholder="Enter your user ID"
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
              disabled={!approverId.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-brand hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Approve
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
