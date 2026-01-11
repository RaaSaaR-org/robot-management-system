/**
 * @file IncidentDetailPage.tsx
 * @description Detail page for viewing a single incident
 * @feature incidents
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { SeverityBadge } from '../components/SeverityBadge';
import { StatusBadge } from '../components/StatusBadge';
import { NotificationTimeline } from '../components/NotificationTimeline';
import { useIncident } from '../hooks/useIncidents';
import {
  INCIDENT_TYPE_LABELS,
  INCIDENT_STATUS_LABELS,
} from '../types/incidents.types';
import type { IncidentStatus } from '../types/incidents.types';

// ============================================================================
// CONSTANTS
// ============================================================================

const STATUS_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  detected: ['investigating'],
  investigating: ['contained', 'resolved'],
  contained: ['resolved'],
  resolved: ['closed', 'investigating'],
  closed: [],
};

// ============================================================================
// HELPERS
// ============================================================================

function formatDate(isoString: string | null): string {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Detail page for viewing and managing a single incident.
 */
export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    incident,
    isLoading,
    fetchIncident,
    update,
    markNotificationSent,
    generateNotificationContent,
  } = useIncident(id);

  const [isUpdating, setIsUpdating] = useState(false);

  // Fetch incident on mount
  useEffect(() => {
    if (id) {
      fetchIncident(id);
    }
  }, [id, fetchIncident]);

  const handleStatusChange = async (newStatus: IncidentStatus) => {
    setIsUpdating(true);
    try {
      await update({ status: newStatus });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMarkNotificationSent = async (notificationId: string) => {
    await markNotificationSent(notificationId);
  };

  const handleGenerateContent = async (notificationId: string) => {
    const content = await generateNotificationContent(notificationId);
    if (content) {
      // For now, just log it - a modal editor would be better UX
      console.log('Generated content:', content);
      alert('Content generated. Check console for output.');
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <p className="text-theme-secondary mb-4">Incident not found</p>
        <Button variant="secondary" onClick={() => navigate('/incidents')}>
          Back to Incidents
        </Button>
      </div>
    );
  }

  const availableTransitions = STATUS_TRANSITIONS[incident.status];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 px-6 py-4 border-b border-gray-700/50">
        <div className="flex items-center gap-4 mb-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/incidents')}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-1"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </Button>
          <span className="text-sm font-mono text-theme-tertiary">
            {incident.incidentNumber}
          </span>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
              <span className="text-sm text-theme-tertiary">
                {INCIDENT_TYPE_LABELS[incident.type]}
              </span>
            </div>
            <h1 className="text-xl font-bold text-theme-primary">{incident.title}</h1>
          </div>

          {/* Status Actions */}
          {availableTransitions.length > 0 && (
            <div className="flex items-center gap-2">
              {availableTransitions.map((nextStatus) => (
                <Button
                  key={nextStatus}
                  variant="secondary"
                  size="sm"
                  onClick={() => handleStatusChange(nextStatus)}
                  isLoading={isUpdating}
                >
                  Mark as {INCIDENT_STATUS_LABELS[nextStatus]}
                </Button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
              <h3 className="font-medium text-theme-primary mb-2">Description</h3>
              <p className="text-theme-secondary whitespace-pre-wrap">
                {incident.description}
              </p>
            </div>

            {/* Root Cause & Resolution */}
            {(incident.rootCause || incident.resolution) && (
              <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
                {incident.rootCause && (
                  <div className="mb-4">
                    <h3 className="font-medium text-theme-primary mb-2">Root Cause</h3>
                    <p className="text-theme-secondary whitespace-pre-wrap">
                      {incident.rootCause}
                    </p>
                  </div>
                )}
                {incident.resolution && (
                  <div>
                    <h3 className="font-medium text-theme-primary mb-2">Resolution</h3>
                    <p className="text-theme-secondary whitespace-pre-wrap">
                      {incident.resolution}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Risk Assessment */}
            {incident.riskScore !== null && (
              <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
                <h3 className="font-medium text-theme-primary mb-3">Risk Assessment</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-theme-tertiary mb-1">Risk Score</p>
                    <p className="text-2xl font-bold text-theme-primary">
                      {incident.riskScore}/100
                    </p>
                  </div>
                  {incident.affectedDataSubjects !== null && (
                    <div>
                      <p className="text-xs text-theme-tertiary mb-1">Affected Data Subjects</p>
                      <p className="text-2xl font-bold text-theme-primary">
                        {incident.affectedDataSubjects.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
                {incident.dataCategories.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-theme-tertiary mb-2">Data Categories</p>
                    <div className="flex flex-wrap gap-2">
                      {incident.dataCategories.map((cat) => (
                        <span
                          key={cat}
                          className="px-2 py-1 text-xs bg-theme-base rounded text-theme-secondary"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Notification Timeline */}
            <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
              <h3 className="font-medium text-theme-primary mb-4">Notification Timeline</h3>
              <NotificationTimeline
                notifications={incident.notifications || []}
                onMarkSent={handleMarkNotificationSent}
                onGenerateContent={handleGenerateContent}
              />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Timestamps */}
            <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
              <h3 className="font-medium text-theme-primary mb-3">Timeline</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-theme-tertiary">Detected</p>
                  <p className="text-sm text-theme-primary">{formatDate(incident.detectedAt)}</p>
                </div>
                {incident.containedAt && (
                  <div>
                    <p className="text-xs text-theme-tertiary">Contained</p>
                    <p className="text-sm text-theme-primary">{formatDate(incident.containedAt)}</p>
                  </div>
                )}
                {incident.resolvedAt && (
                  <div>
                    <p className="text-xs text-theme-tertiary">Resolved</p>
                    <p className="text-sm text-theme-primary">{formatDate(incident.resolvedAt)}</p>
                  </div>
                )}
                {incident.closedAt && (
                  <div>
                    <p className="text-xs text-theme-tertiary">Closed</p>
                    <p className="text-sm text-theme-primary">{formatDate(incident.closedAt)}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata */}
            <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
              <h3 className="font-medium text-theme-primary mb-3">Details</h3>
              <div className="space-y-3">
                {incident.robotId && (
                  <div>
                    <p className="text-xs text-theme-tertiary">Associated Robot</p>
                    <p className="text-sm text-theme-primary font-mono">{incident.robotId}</p>
                  </div>
                )}
                {incident.createdBy && (
                  <div>
                    <p className="text-xs text-theme-tertiary">Created By</p>
                    <p className="text-sm text-theme-primary">{incident.createdBy}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-theme-tertiary">Last Updated</p>
                  <p className="text-sm text-theme-primary">{formatDate(incident.updatedAt)}</p>
                </div>
              </div>
            </div>

            {/* Evidence Links */}
            {(incident.complianceLogIds.length > 0 || incident.alertIds.length > 0) && (
              <div className="bg-theme-elevated rounded-lg p-4 border border-theme-base">
                <h3 className="font-medium text-theme-primary mb-3">Linked Evidence</h3>
                {incident.complianceLogIds.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-theme-tertiary mb-1">Compliance Logs</p>
                    <p className="text-sm text-theme-secondary">
                      {incident.complianceLogIds.length} log{incident.complianceLogIds.length !== 1 ? 's' : ''} linked
                    </p>
                  </div>
                )}
                {incident.alertIds.length > 0 && (
                  <div>
                    <p className="text-xs text-theme-tertiary mb-1">Alerts</p>
                    <p className="text-sm text-theme-secondary">
                      {incident.alertIds.length} alert{incident.alertIds.length !== 1 ? 's' : ''} linked
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
