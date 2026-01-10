/**
 * @file DecisionViewer.tsx
 * @description Component for viewing AI decision details and explanations
 * @feature explainability
 */

import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { ConfidenceGauge } from './ConfidenceGauge';
import { SafetyBadge } from './SafetyBadge';
import {
  type FormattedExplanation,
  type DecisionExplanation,
  DECISION_TYPE_LABELS,
  formatDate,
} from '../types';

export interface DecisionViewerProps {
  decision: DecisionExplanation;
  explanation?: FormattedExplanation | null;
  onLoadExplanation?: () => void;
  isLoadingExplanation?: boolean;
  className?: string;
}

/**
 * Detailed viewer for AI decisions and explanations
 *
 * @example
 * ```tsx
 * <DecisionViewer
 *   decision={decision}
 *   explanation={explanation}
 *   onLoadExplanation={() => fetchExplanation(decision.id)}
 * />
 * ```
 */
export function DecisionViewer({
  decision,
  explanation,
  onLoadExplanation,
  isLoadingExplanation,
  className,
}: DecisionViewerProps) {
  const [showAlternatives, setShowAlternatives] = useState(false);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <Card className="glass-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm text-theme-secondary">
                {DECISION_TYPE_LABELS[decision.decisionType]}
              </span>
              <SafetyBadge classification={decision.safetyFactors.classification} size="sm" />
            </div>
            <h3 className="text-lg font-semibold text-theme-primary">
              {decision.inputFactors.userCommand || 'Unknown Command'}
            </h3>
            <p className="text-sm text-theme-tertiary mt-1">{formatDate(decision.createdAt)}</p>
          </div>
          <div className="text-right">
            <ConfidenceGauge confidence={decision.confidence} showLabel />
          </div>
        </div>
      </Card>

      {/* Formatted Explanation */}
      {explanation ? (
        <>
          {/* Summary */}
          <Card className="glass-card p-4">
            <h4 className="font-medium text-theme-primary mb-2">Summary</h4>
            <p className="text-theme-secondary">{explanation.summary}</p>
          </Card>

          {/* Input Factors */}
          <Card className="glass-card p-4">
            <h4 className="font-medium text-theme-primary mb-1">{explanation.inputFactors.title}</h4>
            <p className="text-theme-tertiary text-xs mb-3">What the AI knew when making this decision</p>
            <dl className="space-y-2">
              {explanation.inputFactors.items.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <dt className="text-theme-secondary min-w-[120px]">{item.label}:</dt>
                  <dd className="text-theme-primary">{item.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {/* Reasoning Steps */}
          <Card className="glass-card p-4">
            <h4 className="font-medium text-theme-primary mb-1">{explanation.reasoning.title}</h4>
            <p className="text-theme-tertiary text-xs mb-3">The AI's thought process, step by step</p>
            <ol className="space-y-2 list-decimal list-inside">
              {explanation.reasoning.steps.map((step, index) => (
                <li key={index} className="text-theme-secondary">
                  {step}
                </li>
              ))}
            </ol>
          </Card>

          {/* Confidence Details */}
          <Card className="glass-card p-4">
            <h4 className="font-medium text-theme-primary mb-1">Confidence Analysis</h4>
            <p className="text-theme-tertiary text-xs mb-3">How certain the AI is about this decision</p>
            <ConfidenceGauge confidence={explanation.confidence.score} size="lg" />
            <p className="text-theme-secondary mt-2">{explanation.confidence.description}</p>
          </Card>

          {/* Safety Assessment */}
          {(explanation.safety.warnings.length > 0 ||
            explanation.safety.constraints.length > 0) && (
            <Card className="glass-card p-4">
              <h4 className="font-medium text-theme-primary mb-1">Safety Assessment</h4>
              <p className="text-theme-tertiary text-xs mb-3">Risk evaluation and constraints applied</p>
              <div className="flex items-center gap-2 mb-3">
                <SafetyBadge classification={explanation.safety.classification} />
              </div>
              {explanation.safety.warnings.length > 0 && (
                <div className="mb-2">
                  <span className="text-sm text-yellow-400">Warnings:</span>
                  <ul className="list-disc list-inside text-theme-secondary text-sm mt-1">
                    {explanation.safety.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              {explanation.safety.constraints.length > 0 && (
                <div>
                  <span className="text-sm text-theme-tertiary">Constraints:</span>
                  <ul className="list-disc list-inside text-theme-secondary text-sm mt-1">
                    {explanation.safety.constraints.map((constraint, index) => (
                      <li key={index}>{constraint}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* Alternatives */}
          {explanation.alternatives.items.length > 0 && (
            <Card className="glass-card p-4">
              <button
                type="button"
                className="flex items-center justify-between w-full text-left"
                onClick={() => setShowAlternatives(!showAlternatives)}
              >
                <div>
                  <h4 className="font-medium text-theme-primary">{explanation.alternatives.title}</h4>
                  <p className="text-theme-tertiary text-xs">Other options the AI considered</p>
                </div>
                <span className="text-theme-tertiary">{showAlternatives ? '-' : '+'}</span>
              </button>
              {showAlternatives && (
                <div className="mt-3 space-y-2">
                  {explanation.alternatives.items.map((alt, index) => (
                    <div key={index} className="p-2 rounded bg-gray-800/50">
                      <p className="text-theme-primary font-medium">{alt.action}</p>
                      <p className="text-theme-secondary text-sm">{alt.reason}</p>
                      {alt.rejected && (
                        <p className="text-red-400 text-sm mt-1">Rejected: {alt.rejected}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Metadata */}
          <Card className="glass-card p-4">
            <h4 className="font-medium text-theme-primary mb-2">Technical Details</h4>
            <dl className="text-sm space-y-1">
              <div className="flex gap-2">
                <dt className="text-theme-tertiary">Model:</dt>
                <dd className="text-theme-secondary">{explanation.metadata.modelUsed}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-theme-tertiary">Robot ID:</dt>
                <dd className="text-theme-secondary font-mono">{explanation.metadata.robotId}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-theme-tertiary">Timestamp:</dt>
                <dd className="text-theme-secondary">{formatDate(explanation.metadata.timestamp)}</dd>
              </div>
            </dl>
          </Card>
        </>
      ) : (
        /* Load Explanation Button */
        <Card className="glass-card p-4 text-center">
          <p className="text-theme-secondary mb-3">
            Load detailed explanation to see step-by-step reasoning
          </p>
          <Button onClick={onLoadExplanation} disabled={isLoadingExplanation} variant="primary">
            {isLoadingExplanation ? 'Loading...' : 'Load Explanation'}
          </Button>
        </Card>
      )}
    </div>
  );
}
