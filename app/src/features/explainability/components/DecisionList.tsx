/**
 * @file DecisionList.tsx
 * @description List component for displaying AI decisions
 * @feature explainability
 */

import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { ConfidenceGauge } from './ConfidenceGauge';
import { SafetyBadge } from './SafetyBadge';
import { type DecisionExplanation, DECISION_TYPE_LABELS, formatDate } from '../types';

export interface DecisionListProps {
  decisions: DecisionExplanation[];
  selectedId?: string;
  onSelect?: (decision: DecisionExplanation) => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * List component for AI decisions
 *
 * @example
 * ```tsx
 * <DecisionList
 *   decisions={decisions}
 *   selectedId={selectedId}
 *   onSelect={(d) => handleSelect(d)}
 * />
 * ```
 */
export function DecisionList({
  decisions,
  selectedId,
  onSelect,
  isLoading,
  className,
}: DecisionListProps) {
  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        {[1, 2, 3].map((i) => (
          <Card key={i} className="glass-card p-4 animate-pulse">
            <div className="h-4 bg-gray-700 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-700 rounded w-1/2" />
          </Card>
        ))}
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <Card className={cn('glass-card p-6 text-center', className)}>
        <p className="text-theme-secondary font-medium">No AI decisions yet</p>
        <p className="text-theme-tertiary text-sm mt-2">
          Send a command to a robot (like "Go to warehouse B") to see how the AI processes it.
        </p>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {decisions.map((decision) => (
        <Card
          key={decision.id}
          className={cn(
            'glass-card p-3 cursor-pointer transition-all hover:border-primary-500/50',
            selectedId === decision.id && 'border-primary-500 bg-primary-500/10'
          )}
          onClick={() => onSelect?.(decision)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-theme-tertiary">
                  {DECISION_TYPE_LABELS[decision.decisionType]}
                </span>
                <SafetyBadge classification={decision.safetyFactors.classification} size="sm" />
              </div>
              <p className="text-theme-primary font-medium truncate">
                {decision.inputFactors.userCommand || 'Unknown Command'}
              </p>
              <p className="text-xs text-theme-tertiary mt-1">{formatDate(decision.createdAt)}</p>
            </div>
            <div className="flex-shrink-0 w-20">
              <ConfidenceGauge confidence={decision.confidence} size="sm" />
              <p className="text-xs text-theme-tertiary text-right mt-1">
                {Math.round(decision.confidence * 100)}%
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
