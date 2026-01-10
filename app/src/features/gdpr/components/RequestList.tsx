/**
 * @file RequestList.tsx
 * @description List component displaying GDPR requests
 * @feature gdpr
 */

import type { GDPRRequest } from '../types';
import { REQUEST_TYPE_LABELS, formatDate } from '../types';
import { StatusBadge } from './StatusBadge';
import { SLABadge } from './SLABadge';

export interface RequestListProps {
  requests: GDPRRequest[];
  onSelect: (request: GDPRRequest) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function RequestList({
  requests,
  onSelect,
  isLoading = false,
  emptyMessage = 'No requests found',
  className = '',
}: RequestListProps) {
  if (isLoading) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-4 section-secondary rounded-lg border border-theme animate-pulse"
          >
            <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/4 mb-2" />
            <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className={`text-center py-12 ${className}`}>
        <svg
          className="mx-auto h-12 w-12 text-theme-tertiary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="mt-2 text-sm text-theme-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {requests.map((request) => (
        <button
          key={request.id}
          onClick={() => onSelect(request)}
          className="w-full p-4 section-secondary rounded-lg border border-theme hover:border-cobalt hover:shadow-sm transition-all text-left"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-theme-primary">
                  {REQUEST_TYPE_LABELS[request.requestType]}
                </span>
                <StatusBadge status={request.status} />
              </div>
              <p className="text-sm text-theme-secondary">
                Submitted on {formatDate(request.submittedAt)}
              </p>
              {request.completedAt && (
                <p className="text-sm text-theme-secondary">
                  Completed on {formatDate(request.completedAt)}
                </p>
              )}
              {request.rejectionReason && (
                <p className="text-sm text-red-500 mt-1">
                  Reason: {request.rejectionReason}
                </p>
              )}
            </div>
            <div className="flex-shrink-0">
              <SLABadge request={request} />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
