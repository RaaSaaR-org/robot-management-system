/**
 * @file ContributionDetail.tsx
 * @description Detail view component for a single contribution
 * @feature contributions
 */

import { useState, useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import {
  ArrowLeft,
  Calendar,
  Database,
  FileStack,
  Award,
  AlertTriangle,
  Ban,
  Loader2,
  Info,
} from 'lucide-react';
import { ContributionStatusBadge } from './ContributionStatusBadge';
import { ImpactVisualization } from './ImpactVisualization';
import type {
  DataContribution,
  ImpactSummary,
} from '../types/contributions.types';
import {
  LICENSE_TYPE_LABELS,
  formatCredits,
  canSubmitContribution,
  canRevokeContribution,
} from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ContributionDetailProps {
  contribution: DataContribution;
  onBack: () => void;
  onSubmit?: () => Promise<void>;
  onRevoke?: (reason: string) => Promise<void>;
  fetchImpact?: () => Promise<ImpactSummary>;
  isLoading?: boolean;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionDetail({
  contribution,
  onBack,
  onSubmit,
  onRevoke,
  fetchImpact,
  isLoading,
  className,
}: ContributionDetailProps) {
  const [impact, setImpact] = useState<ImpactSummary | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (fetchImpact && contribution.status === 'accepted') {
      setImpactLoading(true);
      fetchImpact()
        .then(setImpact)
        .catch(console.error)
        .finally(() => setImpactLoading(false));
    }
  }, [fetchImpact, contribution.status]);

  const handleSubmit = async () => {
    if (!onSubmit) return;
    setActionLoading(true);
    try {
      await onSubmit();
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!onRevoke || !revokeReason.trim()) return;
    setActionLoading(true);
    try {
      await onRevoke(revokeReason);
      setShowRevokeModal(false);
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {contribution.metadata.description}
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              {contribution.metadata.robotType}
            </p>
          </div>
        </div>
        <ContributionStatusBadge status={contribution.status} size="lg" />
      </div>

      {/* Rejection Notice */}
      {contribution.status === 'rejected' && contribution.rejectionReason && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">
                Contribution Rejected
              </p>
              <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                {contribution.rejectionReason}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Revocation Notice */}
      {contribution.status === 'revoked' && (
        <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
          <div className="flex items-start gap-3">
            <Ban className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5" />
            <div>
              <p className="font-medium text-orange-800 dark:text-orange-200">
                Contribution Revoked
              </p>
              <p className="text-sm text-orange-600 dark:text-orange-400 mt-1">
                {contribution.revocationReason || 'Your data has been excluded from future training.'}
              </p>
              {contribution.revokedAt && (
                <p className="text-xs text-orange-500 mt-1">
                  Revoked on {formatDate(contribution.revokedAt)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FileStack className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Trajectories</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {contribution.trajectoryCount.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Database className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">License</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {LICENSE_TYPE_LABELS[contribution.licenseType].replace(' License', '')}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
              <Award className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Credits</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {contribution.creditsAwarded
                  ? formatCredits(contribution.creditsAwarded)
                  : 'Pending'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
              <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Created</p>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {formatDate(contribution.createdAt)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Info className="w-5 h-5 text-gray-400" />
          Contribution Details
        </h2>

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-gray-500 dark:text-gray-400">Collection Method</dt>
            <dd className="text-gray-900 dark:text-gray-100 capitalize">
              {contribution.metadata.collectionMethod}
            </dd>
          </div>
          {contribution.metadata.environment && (
            <div>
              <dt className="text-sm text-gray-500 dark:text-gray-400">Environment</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {contribution.metadata.environment}
              </dd>
            </div>
          )}
          {contribution.qualityScore && (
            <div>
              <dt className="text-sm text-gray-500 dark:text-gray-400">Quality Score</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {contribution.qualityScore}%
              </dd>
            </div>
          )}
          <div className="md:col-span-2">
            <dt className="text-sm text-gray-500 dark:text-gray-400 mb-1">Task Categories</dt>
            <dd className="flex flex-wrap gap-2">
              {contribution.metadata.taskCategories.map((cat) => (
                <span
                  key={cat}
                  className="px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded"
                >
                  {cat}
                </span>
              ))}
            </dd>
          </div>
          {contribution.metadata.notes && (
            <div className="md:col-span-2">
              <dt className="text-sm text-gray-500 dark:text-gray-400">Notes</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {contribution.metadata.notes}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Impact (for accepted contributions) */}
      {contribution.status === 'accepted' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Impact Report
          </h2>
          <ImpactVisualization impact={impact} isLoading={impactLoading} />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        {canSubmitContribution(contribution) && onSubmit && (
          <button
            onClick={handleSubmit}
            disabled={actionLoading}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {actionLoading ? 'Submitting...' : 'Submit for Review'}
          </button>
        )}
        {canRevokeContribution(contribution) && onRevoke && (
          <button
            onClick={() => setShowRevokeModal(true)}
            className="px-4 py-2 text-red-600 hover:text-red-700 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Revoke Contribution
          </button>
        )}
      </div>

      {/* Revoke Modal */}
      {showRevokeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Revoke Contribution
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This will withdraw your consent and exclude your data from future training.
              This action cannot be undone.
            </p>
            <textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Please provide a reason for revoking..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRevokeModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={!revokeReason.trim() || actionLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Revoking...' : 'Confirm Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
