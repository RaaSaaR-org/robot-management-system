/**
 * @file RegulatoryTimeline.tsx
 * @description Visual timeline of regulatory deadlines
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { useComplianceTrackerStore } from '../store/complianceTrackerStore';
import {
  REGULATORY_FRAMEWORK_LABELS,
  COMPLIANCE_STATUS_CONFIG,
  type RegulatoryFramework,
  type ComplianceStatus,
} from '../types';

export interface RegulatoryTimelineProps {
  className?: string;
}

interface DeadlineWithStatus {
  id: string;
  framework: RegulatoryFramework;
  name: string;
  deadline: string;
  description: string;
  status: ComplianceStatus;
  requirements: string[];
  completedRequirements: string[];
  daysUntilDeadline: number;
}

/**
 * Deadline item on the timeline
 */
function DeadlineItem({
  deadline,
  isExpanded,
  onToggle,
  onUpdateProgress,
}: {
  deadline: DeadlineWithStatus;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateProgress: (completedRequirements: string[]) => void;
}) {
  const statusConfig = COMPLIANCE_STATUS_CONFIG[deadline.status];
  const completionPercent =
    deadline.requirements.length > 0
      ? Math.round((deadline.completedRequirements.length / deadline.requirements.length) * 100)
      : 0;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getDaysLabel = (days: number) => {
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    if (days === 1) return '1 day left';
    if (days < 30) return `${days} days left`;
    if (days < 365) return `${Math.floor(days / 30)} months left`;
    return `${Math.floor(days / 365)} years left`;
  };

  const handleToggleRequirement = (req: string) => {
    const isCompleted = deadline.completedRequirements.includes(req);
    const newCompleted = isCompleted
      ? deadline.completedRequirements.filter((r) => r !== req)
      : [...deadline.completedRequirements, req];
    onUpdateProgress(newCompleted);
  };

  return (
    <div className="relative pl-8">
      {/* Timeline dot */}
      <div
        className={cn(
          'absolute left-0 top-2 w-4 h-4 rounded-full border-2 bg-gray-900',
          deadline.status === 'compliant'
            ? 'border-green-500'
            : deadline.status === 'at_risk' || deadline.status === 'overdue'
              ? 'border-red-500'
              : 'border-yellow-500'
        )}
      />

      {/* Content card */}
      <Card
        className={cn(
          'glass-card p-4 cursor-pointer transition-all',
          isExpanded && 'ring-1 ring-primary-500/50'
        )}
        onClick={onToggle}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-primary-400 uppercase">
                {REGULATORY_FRAMEWORK_LABELS[deadline.framework]}
              </span>
              <span
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium',
                  statusConfig.bgColor,
                  statusConfig.textColor
                )}
              >
                {statusConfig.label}
              </span>
            </div>
            <h4 className="font-semibold text-theme-primary">{deadline.name}</h4>
            <p className="text-sm text-theme-tertiary mt-1">{deadline.description}</p>
          </div>
          <div className="text-right flex-shrink-0 ml-4">
            <div className="text-sm font-medium text-theme-primary">
              {formatDate(deadline.deadline)}
            </div>
            <div
              className={cn(
                'text-xs',
                deadline.daysUntilDeadline < 0
                  ? 'text-red-400'
                  : deadline.daysUntilDeadline < 90
                    ? 'text-yellow-400'
                    : 'text-theme-tertiary'
              )}
            >
              {getDaysLabel(deadline.daysUntilDeadline)}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-theme-tertiary mb-1">
            <span>Progress</span>
            <span>
              {deadline.completedRequirements.length} / {deadline.requirements.length} requirements
            </span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                completionPercent >= 100
                  ? 'bg-green-500'
                  : completionPercent >= 50
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              )}
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>

        {/* Expanded requirements */}
        {isExpanded && deadline.requirements.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-700/50" onClick={(e) => e.stopPropagation()}>
            <h5 className="text-sm font-medium text-theme-secondary mb-3">Requirements Checklist</h5>
            <div className="space-y-2">
              {deadline.requirements.map((req, idx) => {
                const isCompleted = deadline.completedRequirements.includes(req);
                return (
                  <label
                    key={idx}
                    className="flex items-start gap-3 p-2 rounded hover:bg-gray-800/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      onChange={() => handleToggleRequirement(req)}
                      className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-800 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                    />
                    <span
                      className={cn(
                        'text-sm',
                        isCompleted ? 'text-theme-tertiary line-through' : 'text-theme-secondary'
                      )}
                    >
                      {req}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Expand/collapse indicator */}
        <div className="flex justify-center mt-2">
          <svg
            className={cn(
              'w-5 h-5 text-theme-tertiary transition-transform',
              isExpanded && 'rotate-180'
            )}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </Card>
    </div>
  );
}

/**
 * Regulatory Timeline component showing all upcoming deadlines
 */
export function RegulatoryTimeline({ className }: RegulatoryTimelineProps) {
  const {
    deadlines,
    isLoadingDeadlines,
    error,
    fetchRegulatoryDeadlines,
    updateDeadlineProgress,
  } = useComplianceTrackerStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'overdue'>('all');

  useEffect(() => {
    fetchRegulatoryDeadlines();
  }, [fetchRegulatoryDeadlines]);

  const handleToggle = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleUpdateProgress = async (id: string, completedRequirements: string[]) => {
    await updateDeadlineProgress(id, completedRequirements);
  };

  // Filter deadlines
  const filteredDeadlines = deadlines.filter((d) => {
    if (filter === 'upcoming') return d.daysUntilDeadline > 0 && d.daysUntilDeadline <= 365;
    if (filter === 'overdue') return d.daysUntilDeadline < 0;
    return true;
  });

  // Sort by deadline date
  const sortedDeadlines = [...filteredDeadlines].sort((a, b) => {
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  if (isLoadingDeadlines) {
    return (
      <Card className={cn('glass-card p-6', className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-700 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn('glass-card p-6', className)}>
        <div className="text-center">
          <p className="text-red-400">{error}</p>
          <Button variant="secondary" className="mt-4" onClick={fetchRegulatoryDeadlines}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-theme-primary">Regulatory Deadlines</h3>
        <div className="flex gap-2">
          {(['all', 'upcoming', 'overdue'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg transition-colors',
                filter === f
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-800 text-theme-secondary hover:bg-gray-700'
              )}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {sortedDeadlines.length > 0 ? (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-gray-700" />

          {/* Deadline items */}
          <div className="space-y-4">
            {sortedDeadlines.map((deadline) => (
              <DeadlineItem
                key={deadline.id}
                deadline={deadline as DeadlineWithStatus}
                isExpanded={expandedId === deadline.id}
                onToggle={() => handleToggle(deadline.id)}
                onUpdateProgress={(completed) => handleUpdateProgress(deadline.id, completed)}
              />
            ))}
          </div>
        </div>
      ) : (
        <Card className="glass-card p-6 text-center">
          <p className="text-theme-tertiary">
            {filter === 'overdue'
              ? 'No overdue deadlines'
              : filter === 'upcoming'
                ? 'No upcoming deadlines within the next year'
                : 'No regulatory deadlines configured'}
          </p>
        </Card>
      )}
    </div>
  );
}
