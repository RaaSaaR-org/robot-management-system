/**
 * @file UpdateCard.tsx
 * @description Card component for displaying a single update package
 * @feature updates
 */

import { cn } from '@/shared/utils/cn';
import type { UpdatePackage } from '../types/updates.types';
import { UPDATE_STATUS_LABELS, UPDATE_STATUS_COLORS } from '../types/updates.types';

export interface UpdateCardProps {
  pkg: UpdatePackage;
  onApprove?: (id: string) => void;
  onDeploy?: (id: string) => void;
  onRollback?: (id: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UpdateCard({ pkg, onApprove, onDeploy, onRollback }: UpdateCardProps) {
  return (
    <div className="section-primary border border-theme rounded-brand p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-lg font-semibold text-theme-primary">v{pkg.version}</h3>
          <span className={cn('text-sm font-medium', UPDATE_STATUS_COLORS[pkg.status])}>
            {UPDATE_STATUS_LABELS[pkg.status]}
          </span>
        </div>
        <div className="flex gap-2">
          {pkg.status === 'pending' && onApprove && (
            <button
              onClick={() => onApprove(pkg.id)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-brand hover:bg-blue-700 transition-colors"
            >
              Approve
            </button>
          )}
          {pkg.status === 'approved' && onDeploy && (
            <button
              onClick={() => onDeploy(pkg.id)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-brand hover:bg-green-700 transition-colors"
            >
              Deploy
            </button>
          )}
          {pkg.status === 'deployed' && onRollback && (
            <button
              onClick={() => onRollback(pkg.id)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-brand hover:bg-red-700 transition-colors"
            >
              Rollback
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-theme-secondary mb-3">{pkg.changelog}</p>

      <div className="flex flex-wrap gap-4 text-xs text-theme-tertiary">
        <span>Checksum: {pkg.checksum.slice(0, 12)}...</span>
        <span>Size: {(pkg.fileSize / 1024).toFixed(1)} KB</span>
        <span>Created: {formatDate(pkg.createdAt)}</span>
        {pkg.approvedBy && <span>Approved by: {pkg.approvedBy}</span>}
      </div>
    </div>
  );
}
