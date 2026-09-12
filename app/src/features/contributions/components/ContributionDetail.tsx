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
import { UI_DATE_LOCALE } from '@/shared/utils/format';

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
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
            className="p-2 hover:bg-inset rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-ink-tertiary" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-ink-primary">
              {contribution.metadata.description}
            </h1>
            <p className="text-ink-tertiary">
              {contribution.metadata.robotType}
            </p>
          </div>
        </div>
        <ContributionStatusBadge status={contribution.status} size="lg" />
      </div>

      {/* Rejection Notice */}
      {contribution.status === 'rejected' && contribution.rejectionReason && (
        <div className="p-4 bg-signal-stopped/10 border border-signal-stopped/30 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-signal-stopped mt-0.5" />
            <div>
              <p className="font-medium text-signal-stopped">
                Contribution Rejected
              </p>
              <p className="text-sm text-signal-stopped mt-1">
                {contribution.rejectionReason}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Revocation Notice */}
      {contribution.status === 'revoked' && (
        <div className="p-4 bg-signal-unknown/10 border border-signal-unknown/30 rounded-lg">
          <div className="flex items-start gap-3">
            <Ban className="w-5 h-5 text-signal-unknown mt-0.5" />
            <div>
              <p className="font-medium text-signal-unknown">
                Contribution Revoked
              </p>
              <p className="text-sm text-signal-unknown mt-1">
                {contribution.revocationReason || 'Your data has been excluded from future training.'}
              </p>
              {contribution.revokedAt && (
                <p className="text-xs text-signal-unknown mt-1">
                  Revoked on {formatDate(contribution.revokedAt)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-panel rounded-lg border border-line p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-signal-estimated/10 rounded-lg">
              <FileStack className="w-5 h-5 text-signal-estimated" />
            </div>
            <div>
              <p className="text-sm text-ink-tertiary">Trajectories</p>
              <p className="text-xl font-semibold text-ink-primary">
                {contribution.trajectoryCount.toLocaleString(UI_DATE_LOCALE)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-panel rounded-lg border border-line p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Database className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-ink-tertiary">License</p>
              <p className="text-lg font-semibold text-ink-primary">
                {LICENSE_TYPE_LABELS[contribution.licenseType].replace(' License', '')}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-panel rounded-lg border border-line p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-signal-measured/10 rounded-lg">
              <Award className="w-5 h-5 text-signal-measured" />
            </div>
            <div>
              <p className="text-sm text-ink-tertiary">Credits</p>
              <p className="text-xl font-semibold text-ink-primary">
                {contribution.creditsAwarded
                  ? formatCredits(contribution.creditsAwarded)
                  : 'Pending'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-panel rounded-lg border border-line p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-inset rounded-lg">
              <Calendar className="w-5 h-5 text-ink-secondary" />
            </div>
            <div>
              <p className="text-sm text-ink-tertiary">Created</p>
              <p className="text-sm font-medium text-ink-primary">
                {formatDate(contribution.createdAt)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-panel rounded-lg border border-line p-6">
        <h2 className="text-lg font-semibold text-ink-primary mb-4 flex items-center gap-2">
          <Info className="w-5 h-5 text-ink-muted" />
          Contribution Details
        </h2>

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-ink-tertiary">Collection Method</dt>
            <dd className="text-ink-primary capitalize">
              {contribution.metadata.collectionMethod}
            </dd>
          </div>
          {contribution.metadata.environment && (
            <div>
              <dt className="text-sm text-ink-tertiary">Environment</dt>
              <dd className="text-ink-primary">
                {contribution.metadata.environment}
              </dd>
            </div>
          )}
          {contribution.qualityScore && (
            <div>
              <dt className="text-sm text-ink-tertiary">Quality Score</dt>
              <dd className="text-ink-primary">
                {contribution.qualityScore}%
              </dd>
            </div>
          )}
          <div className="md:col-span-2">
            <dt className="text-sm text-ink-tertiary mb-1">Task Categories</dt>
            <dd className="flex flex-wrap gap-2">
              {contribution.metadata.taskCategories.map((cat) => (
                <span
                  key={cat}
                  className="px-2 py-1 text-sm bg-inset text-ink-primary rounded"
                >
                  {cat}
                </span>
              ))}
            </dd>
          </div>
          {contribution.metadata.notes && (
            <div className="md:col-span-2">
              <dt className="text-sm text-ink-tertiary">Notes</dt>
              <dd className="text-ink-primary">
                {contribution.metadata.notes}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Impact (for accepted contributions) */}
      {contribution.status === 'accepted' && (
        <div className="bg-panel rounded-lg border border-line p-6">
          <h2 className="text-lg font-semibold text-ink-primary mb-4">
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
            className="px-4 py-2 bg-primary text-on-primary rounded-lg hover:bg-primary-hover disabled:opacity-50"
          >
            {actionLoading ? 'Submitting...' : 'Submit for Review'}
          </button>
        )}
        {canRevokeContribution(contribution) && onRevoke && (
          <button
            onClick={() => setShowRevokeModal(true)}
            className="px-4 py-2 text-signal-stopped hover:text-signal-stopped border border-signal-stopped/30 rounded-lg hover:bg-signal-stopped/10"
          >
            Revoke Contribution
          </button>
        )}
      </div>

      {/* Revoke Modal */}
      {showRevokeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80">
          <div className="bg-panel rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-ink-primary mb-2">
              Revoke Contribution
            </h3>
            <p className="text-sm text-ink-secondary mb-4">
              This will withdraw your consent and exclude your data from future training.
              This action cannot be undone.
            </p>
            <textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Please provide a reason for revoking..."
              rows={3}
              className="w-full px-3 py-2 border border-line-strong rounded-lg bg-panel text-ink-primary mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRevokeModal(false)}
                className="px-4 py-2 text-ink-secondary hover:text-ink-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={!revokeReason.trim() || actionLoading}
                className="px-4 py-2 bg-stop text-on-stop rounded-lg hover:bg-stop/90 disabled:opacity-50"
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
