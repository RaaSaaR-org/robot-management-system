/**
 * @file RequestDetail.tsx
 * @description Detailed view of a GDPR request
 * @feature gdpr
 */

import type { GDPRRequest, GDPRRequestStatusHistory } from '../types';
import { REQUEST_TYPE_LABELS, formatDateTime } from '../types';
import { StatusBadge } from './StatusBadge';
import { SLABadge } from './SLABadge';

export interface RequestDetailProps {
  request: GDPRRequest;
  history: GDPRRequestStatusHistory[];
  onCancel?: () => void;
  onDownload?: () => void;
  onClose: () => void;
  isLoading?: boolean;
  className?: string;
}

export function RequestDetail({
  request,
  history,
  onCancel,
  onDownload,
  onClose,
  isLoading = false,
  className = '',
}: RequestDetailProps) {
  const canCancel = ['pending', 'acknowledged'].includes(request.status);
  const canDownload =
    request.status === 'completed' &&
    (request.requestType === 'access' || request.requestType === 'portability');

  return (
    <div className={`section-secondary rounded-lg shadow-lg border border-theme ${className}`}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-theme">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-theme-primary">
              {REQUEST_TYPE_LABELS[request.requestType]}
            </h2>
            <p className="text-sm text-theme-secondary mt-1">Request ID: {request.id}</p>
          </div>
          <button
            onClick={onClose}
            className="text-theme-tertiary hover:text-theme-primary"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-4 space-y-6">
        {/* Status Section */}
        <div className="flex items-center gap-4">
          <StatusBadge status={request.status} />
          <SLABadge request={request} />
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm font-medium text-theme-secondary">Submitted</dt>
            <dd className="text-sm text-theme-primary">{formatDateTime(request.submittedAt)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-theme-secondary">SLA Deadline</dt>
            <dd className="text-sm text-theme-primary">{formatDateTime(request.slaDeadline)}</dd>
          </div>
          {request.acknowledgedAt && (
            <div>
              <dt className="text-sm font-medium text-theme-secondary">Acknowledged</dt>
              <dd className="text-sm text-theme-primary">{formatDateTime(request.acknowledgedAt)}</dd>
            </div>
          )}
          {request.completedAt && (
            <div>
              <dt className="text-sm font-medium text-theme-secondary">Completed</dt>
              <dd className="text-sm text-theme-primary">{formatDateTime(request.completedAt)}</dd>
            </div>
          )}
        </div>

        {/* Rejection Reason */}
        {request.rejectionReason && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <h4 className="text-sm font-medium text-red-500">Rejection Reason</h4>
            <p className="text-sm text-red-400 mt-1">{request.rejectionReason}</p>
          </div>
        )}

        {/* Request Data */}
        {request.requestData && Object.keys(request.requestData).length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-theme-secondary mb-2">Request Details</h4>
            <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <pre className="text-xs text-theme-secondary overflow-x-auto">
                {JSON.stringify(request.requestData, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Status History */}
        {history.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-theme-secondary mb-3">Status History</h4>
            <div className="space-y-3">
              {history.map((entry, index) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3"
                >
                  <div className="relative">
                    <div className="w-3 h-3 bg-cobalt rounded-full" />
                    {index < history.length - 1 && (
                      <div className="absolute top-3 left-1.5 w-px h-full bg-gray-300 dark:bg-gray-600 -translate-x-1/2" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-theme-primary">
                      {entry.fromStatus ? (
                        <>
                          <span className="capitalize">{entry.fromStatus}</span>
                          {' → '}
                          <span className="capitalize font-medium">{entry.toStatus}</span>
                        </>
                      ) : (
                        <span className="capitalize font-medium">{entry.toStatus}</span>
                      )}
                    </p>
                    {entry.reason && (
                      <p className="text-sm text-theme-secondary">{entry.reason}</p>
                    )}
                    <p className="text-xs text-theme-tertiary mt-1">
                      {formatDateTime(entry.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-6 py-4 border-t border-theme flex justify-end gap-3">
        {canDownload && onDownload && (
          <button
            onClick={onDownload}
            disabled={isLoading}
            className="px-4 py-2 bg-cobalt text-white rounded-lg hover:bg-cobalt-dark disabled:opacity-50"
          >
            Download Export
          </button>
        )}
        {canCancel && onCancel && (
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 disabled:opacity-50"
          >
            Cancel Request
          </button>
        )}
        <button
          onClick={onClose}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-theme-primary rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
        >
          Close
        </button>
      </div>
    </div>
  );
}
