/**
 * @file ComplianceLogViewer.tsx
 * @description Component for viewing compliance log details
 * @feature compliance
 */

import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import type { ComplianceLog, ComplianceEventType, ComplianceSeverity } from '../types';

// Event type labels
const EVENT_TYPE_LABELS: Record<ComplianceEventType, string> = {
  ai_decision: 'AI Decision',
  safety_action: 'Safety Action',
  command_execution: 'Command Execution',
  system_event: 'System Event',
  access_audit: 'Access Audit',
};

// Severity colors
const SEVERITY_COLORS: Record<ComplianceSeverity, string> = {
  debug: 'text-gray-400 bg-gray-500/20',
  info: 'text-blue-400 bg-blue-500/20',
  warning: 'text-yellow-400 bg-yellow-500/20',
  error: 'text-red-400 bg-red-500/20',
  critical: 'text-red-500 bg-red-600/30 font-semibold',
};

// Event type colors
const EVENT_TYPE_COLORS: Record<ComplianceEventType, string> = {
  ai_decision: 'text-purple-400 bg-purple-500/20',
  safety_action: 'text-orange-400 bg-orange-500/20',
  command_execution: 'text-green-400 bg-green-500/20',
  system_event: 'text-cyan-400 bg-cyan-500/20',
  access_audit: 'text-pink-400 bg-pink-500/20',
};

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toISOString();
}

export interface ComplianceLogViewerProps {
  log: ComplianceLog;
  onViewDecision?: (decisionId: string) => void;
  className?: string;
}

/**
 * Detailed viewer for compliance logs
 */
export function ComplianceLogViewer({
  log,
  onViewDecision,
  className,
}: ComplianceLogViewerProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <Card className="glass-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                className={cn(
                  'text-sm px-3 py-1 rounded-full',
                  EVENT_TYPE_COLORS[log.eventType]
                )}
              >
                {EVENT_TYPE_LABELS[log.eventType]}
              </span>
              <span
                className={cn(
                  'text-sm px-3 py-1 rounded-full uppercase',
                  SEVERITY_COLORS[log.severity]
                )}
              >
                {log.severity}
              </span>
            </div>
            <h3 className="text-lg font-semibold text-theme-primary">
              {log.payload.description || 'Compliance Log Entry'}
            </h3>
            <p className="text-sm text-theme-tertiary mt-1">{formatDate(log.timestamp)}</p>
          </div>
          {log.immutable && (
            <div className="flex items-center gap-1 text-green-400 text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              <span>Immutable</span>
            </div>
          )}
        </div>
      </Card>

      {/* Payload Details */}
      <Card className="glass-card p-4">
        <h4 className="font-medium text-theme-primary mb-3">Event Details</h4>
        <div className="bg-gray-900/50 rounded-lg p-3 overflow-x-auto">
          <pre className="text-sm text-theme-secondary font-mono whitespace-pre-wrap">
            {JSON.stringify(log.payload, null, 2)}
          </pre>
        </div>
      </Card>

      {/* Hash Chain Info */}
      <Card className="glass-card p-4">
        <h4 className="font-medium text-theme-primary mb-3">Hash Chain (Tamper-Evident)</h4>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-theme-tertiary mb-1">Previous Hash</dt>
            <dd className="font-mono text-theme-secondary bg-gray-900/50 p-2 rounded break-all">
              {log.previousHash}
            </dd>
          </div>
          <div>
            <dt className="text-theme-tertiary mb-1">Current Hash</dt>
            <dd className="font-mono text-theme-secondary bg-gray-900/50 p-2 rounded break-all">
              {log.currentHash}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Model Info (if AI decision) */}
      {log.modelVersion && (
        <Card className="glass-card p-4">
          <h4 className="font-medium text-theme-primary mb-3">AI Model Information</h4>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-theme-tertiary">Model Version</dt>
              <dd className="text-theme-secondary font-mono">{log.modelVersion}</dd>
            </div>
            {log.modelHash && (
              <div>
                <dt className="text-theme-tertiary">Model Hash</dt>
                <dd className="text-theme-secondary font-mono truncate">{log.modelHash}</dd>
              </div>
            )}
            {log.inputHash && (
              <div>
                <dt className="text-theme-tertiary">Input Hash</dt>
                <dd className="text-theme-secondary font-mono truncate">{log.inputHash}</dd>
              </div>
            )}
            {log.outputHash && (
              <div>
                <dt className="text-theme-tertiary">Output Hash</dt>
                <dd className="text-theme-secondary font-mono truncate">{log.outputHash}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {/* Metadata */}
      <Card className="glass-card p-4">
        <h4 className="font-medium text-theme-primary mb-3">Metadata</h4>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-theme-tertiary">Log ID</dt>
            <dd className="text-theme-secondary font-mono text-xs">{log.id}</dd>
          </div>
          <div>
            <dt className="text-theme-tertiary">Session ID</dt>
            <dd className="text-theme-secondary font-mono text-xs">{log.sessionId}</dd>
          </div>
          <div>
            <dt className="text-theme-tertiary">Robot ID</dt>
            <dd className="text-theme-secondary font-mono text-xs">{log.robotId}</dd>
          </div>
          {log.operatorId && (
            <div>
              <dt className="text-theme-tertiary">Operator ID</dt>
              <dd className="text-theme-secondary font-mono text-xs">{log.operatorId}</dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Link to Decision */}
      {log.decisionId && onViewDecision && (
        <Card className="glass-card p-4">
          <h4 className="font-medium text-theme-primary mb-2">Related Decision</h4>
          <p className="text-theme-tertiary text-sm mb-3">
            This log is linked to an AI decision in the Explainability system.
          </p>
          <button
            type="button"
            className="text-sm text-primary-400 hover:text-primary-300 underline"
            onClick={() => onViewDecision(log.decisionId!)}
          >
            View Decision Details
          </button>
        </Card>
      )}
    </div>
  );
}
