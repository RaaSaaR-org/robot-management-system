/**
 * @file DocumentExpiryList.tsx
 * @description List of expiring compliance documents
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';

export interface DocumentExpiryListProps {
  className?: string;
}

/**
 * Document Expiry List component
 */
export function DocumentExpiryList({ className }: DocumentExpiryListProps) {
  const { expiringDocuments, isLoadingDocuments, fetchExpiringDocuments } =
    useComplianceTrackerStore();

  const [withinDays, setWithinDays] = useState(90);

  useEffect(() => {
    fetchExpiringDocuments(withinDays);
  }, [fetchExpiringDocuments, withinDays]);

  const getStatusConfig = (status: 'valid' | 'expiring_soon' | 'expired') => {
    switch (status) {
      case 'valid':
        return { bgColor: 'bg-green-900/20', textColor: 'text-green-400', label: 'Valid' };
      case 'expiring_soon':
        return { bgColor: 'bg-yellow-900/20', textColor: 'text-yellow-400', label: 'Expiring Soon' };
      case 'expired':
        return { bgColor: 'bg-red-900/20', textColor: 'text-red-400', label: 'Expired' };
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getDaysLabel = (days: number | null) => {
    if (days === null) return 'No expiry';
    if (days < 0) return `${Math.abs(days)} days ago`;
    if (days === 0) return 'Expires today';
    if (days === 1) return '1 day';
    return `${days} days`;
  };

  if (isLoadingDocuments) {
    return (
      <Card className={cn('glass-card p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-700 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header with filter */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-theme-primary">Expiring Documents</h3>
        <div className="flex gap-2">
          {[30, 60, 90, 180].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => setWithinDays(days)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg transition-colors',
                withinDays === days
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-800 text-theme-secondary hover:bg-gray-700'
              )}
            >
              {days} days
            </button>
          ))}
        </div>
      </div>

      {/* Document list */}
      {expiringDocuments.length > 0 ? (
        <div className="space-y-2">
          {expiringDocuments.map((doc) => {
            const statusConfig = getStatusConfig(doc.status);
            return (
              <Card
                key={doc.id}
                className={cn(
                  'p-4 flex items-center justify-between',
                  doc.status === 'expired'
                    ? 'border-red-500/30'
                    : doc.status === 'expiring_soon'
                      ? 'border-yellow-500/30'
                      : ''
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-theme-primary truncate">
                      {doc.providerName}
                    </span>
                    <span className="text-xs text-theme-tertiary">v{doc.modelVersion}</span>
                  </div>
                  <div className="text-sm text-theme-tertiary">{doc.documentType}</div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right">
                    <div className="text-sm text-theme-primary">
                      {formatDate(doc.validTo)}
                    </div>
                    <div
                      className={cn(
                        'text-xs',
                        doc.daysUntilExpiry !== null && doc.daysUntilExpiry < 0
                          ? 'text-red-400'
                          : doc.daysUntilExpiry !== null && doc.daysUntilExpiry < 30
                            ? 'text-yellow-400'
                            : 'text-theme-tertiary'
                      )}
                    >
                      {getDaysLabel(doc.daysUntilExpiry)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'px-2 py-1 rounded text-xs font-medium',
                      statusConfig.bgColor,
                      statusConfig.textColor
                    )}
                  >
                    {statusConfig.label}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="glass-card p-6 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-900/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-theme-secondary">No documents expiring within {withinDays} days</p>
        </Card>
      )}
    </div>
  );
}
