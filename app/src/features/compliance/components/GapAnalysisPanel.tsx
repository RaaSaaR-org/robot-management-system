/**
 * @file GapAnalysisPanel.tsx
 * @description Panel displaying compliance gaps with filtering and remediation
 * @feature compliance
 */

import { useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import {
  REGULATORY_FRAMEWORK_LABELS,
  GAP_SEVERITY_CONFIG,
  type RegulatoryFramework,
  type GapSeverity,
} from '../types';

export interface GapAnalysisPanelProps {
  className?: string;
}

/**
 * Individual gap card
 */
function GapCard({
  gap,
  onClose,
}: {
  gap: {
    id: string;
    framework: RegulatoryFramework;
    requirement: string;
    articleReference: string;
    severity: GapSeverity;
    description: string;
    currentState: string;
    targetState: string;
    remediation: string;
    estimatedEffort?: 'low' | 'medium' | 'high';
    dueDate?: string;
    daysUntilDue: number | null;
    status: 'open' | 'in_progress' | 'closed';
    assignedTo?: string;
  };
  onClose: () => void;
}) {
  const severityConfig = GAP_SEVERITY_CONFIG[gap.severity];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const effortLabels = {
    low: { text: 'Low Effort', color: 'text-green-400' },
    medium: { text: 'Medium Effort', color: 'text-yellow-400' },
    high: { text: 'High Effort', color: 'text-red-400' },
  };

  return (
    <Card className="glass-card p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-primary-400 uppercase">
              {REGULATORY_FRAMEWORK_LABELS[gap.framework]}
            </span>
            <span className="text-xs text-theme-tertiary">{gap.articleReference}</span>
          </div>
          <h4 className="font-medium text-theme-primary">{gap.requirement}</h4>
        </div>
        <span
          className={cn(
            'px-2 py-1 rounded text-xs font-medium flex-shrink-0',
            severityConfig.bgColor,
            severityConfig.textColor
          )}
        >
          {severityConfig.label}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-theme-tertiary mb-3">{gap.description}</p>

      {/* Current vs Target State */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-red-900/20 rounded-lg p-3">
          <div className="text-xs text-red-400 font-medium mb-1">Current State</div>
          <p className="text-sm text-theme-secondary">{gap.currentState}</p>
        </div>
        <div className="bg-green-900/20 rounded-lg p-3">
          <div className="text-xs text-green-400 font-medium mb-1">Target State</div>
          <p className="text-sm text-theme-secondary">{gap.targetState}</p>
        </div>
      </div>

      {/* Remediation */}
      <div className="bg-gray-800/50 rounded-lg p-3 mb-3">
        <div className="text-xs text-theme-tertiary font-medium mb-1">Remediation</div>
        <p className="text-sm text-theme-secondary">{gap.remediation}</p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          {gap.estimatedEffort && (
            <span className={effortLabels[gap.estimatedEffort].color}>
              {effortLabels[gap.estimatedEffort].text}
            </span>
          )}
          {gap.dueDate && (
            <span
              className={cn(
                gap.daysUntilDue !== null && gap.daysUntilDue < 0
                  ? 'text-red-400'
                  : gap.daysUntilDue !== null && gap.daysUntilDue < 30
                    ? 'text-yellow-400'
                    : 'text-theme-tertiary'
              )}
            >
              Due: {formatDate(gap.dueDate)}
            </span>
          )}
          {gap.assignedTo && (
            <span className="text-theme-tertiary">Assigned: {gap.assignedTo}</span>
          )}
        </div>
        {gap.status !== 'closed' && (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Mark Closed
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Gap Analysis Panel
 */
export function GapAnalysisPanel({ className }: GapAnalysisPanelProps) {
  const {
    gaps,
    gapSummary,
    gapFilters,
    isLoadingGaps,
    fetchGaps,
    fetchGapSummary,
    setGapFilters,
    closeGap,
  } = useComplianceTrackerStore();

  useEffect(() => {
    fetchGaps();
    fetchGapSummary();
  }, [fetchGaps, fetchGapSummary]);

  const handleCloseGap = async (id: string) => {
    // In production, you'd get the current user
    await closeGap(id, 'system-user');
  };

  const frameworks: RegulatoryFramework[] = [
    'ai_act',
    'machinery_regulation',
    'gdpr',
    'nis2',
    'cra',
    'red',
    'dguv',
  ];

  const severities: GapSeverity[] = ['critical', 'high', 'medium', 'low'];

  // Filter open gaps only
  const openGaps = gaps.filter((g) => g.status !== 'closed');

  if (isLoadingGaps) {
    return (
      <Card className={cn('glass-card p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-gray-700 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Summary by Framework */}
      {gapSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {frameworks.map((fw) => {
            const summary = gapSummary[fw];
            if (!summary || summary.total === 0) return null;
            return (
              <Card
                key={fw}
                className={cn(
                  'p-3 cursor-pointer transition-all',
                  gapFilters.framework === fw
                    ? 'bg-primary-500/20 border-primary-500/50'
                    : 'bg-gray-800/50 hover:bg-gray-800'
                )}
                onClick={() =>
                  setGapFilters({
                    framework: gapFilters.framework === fw ? undefined : fw,
                  })
                }
              >
                <div className="text-xs font-medium text-theme-tertiary mb-1">
                  {REGULATORY_FRAMEWORK_LABELS[fw]}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold text-theme-primary">{summary.total}</span>
                  {summary.critical > 0 && (
                    <span className="text-xs text-red-400">({summary.critical} crit)</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Severity Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-theme-tertiary">Severity:</span>
        <button
          type="button"
          onClick={() => setGapFilters({ severity: undefined })}
          className={cn(
            'px-3 py-1 text-sm rounded-lg transition-colors',
            !gapFilters.severity
              ? 'bg-primary-500 text-white'
              : 'bg-gray-800 text-theme-secondary hover:bg-gray-700'
          )}
        >
          All
        </button>
        {severities.map((sev) => (
          <button
            key={sev}
            type="button"
            onClick={() =>
              setGapFilters({
                severity: gapFilters.severity === sev ? undefined : sev,
              })
            }
            className={cn(
              'px-3 py-1 text-sm rounded-lg transition-colors',
              gapFilters.severity === sev
                ? cn(GAP_SEVERITY_CONFIG[sev].bgColor, GAP_SEVERITY_CONFIG[sev].textColor)
                : 'bg-gray-800 text-theme-secondary hover:bg-gray-700'
            )}
          >
            {GAP_SEVERITY_CONFIG[sev].label}
          </button>
        ))}
      </div>

      {/* Gap List */}
      {openGaps.length > 0 ? (
        <div className="space-y-4">
          {openGaps.map((gap) => (
            <GapCard
              key={gap.id}
              gap={gap as any}
              onClose={() => handleCloseGap(gap.id)}
            />
          ))}
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
          <p className="text-theme-secondary">No open compliance gaps</p>
          <p className="text-sm text-theme-tertiary mt-1">All identified gaps have been addressed</p>
        </Card>
      )}
    </div>
  );
}
