/**
 * @file CommandPreview.tsx
 * @description Preview component for VLA command interpretation
 * @feature command
 * @dependencies @/shared/utils/cn, @/shared/components/ui, @/features/command/types
 */

import { cn } from '@/shared/utils/cn';
import { Badge } from '@/shared/components/ui/Badge';
import { Card } from '@/shared/components/ui/Card';
import type { CommandInterpretation } from '../types/command.types';
import {
  SAFETY_CLASSIFICATION_LABELS,
  SAFETY_CLASSIFICATION_COLORS,
  formatConfidence,
  getConfidenceLevel,
  getConfidenceColors,
} from '../types/command.types';
import { COMMAND_TYPE_LABELS } from '@/features/robots/types';

// ============================================================================
// TYPES
// ============================================================================

export interface CommandPreviewProps {
  /** VLA interpretation to display */
  interpretation: CommandInterpretation;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Confidence indicator with visual bar */
function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const level = getConfidenceLevel(confidence);
  const colors = getConfidenceColors(confidence);
  const percentage = Math.round(confidence * 100);

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="h-2 rounded-full bg-theme-elevated overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              level === 'high' && 'bg-green-500',
              level === 'medium' && 'bg-yellow-500',
              level === 'low' && 'bg-red-500'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <span className={cn('text-sm font-medium min-w-[3rem] text-right', colors.text)}>
        {formatConfidence(confidence)}
      </span>
    </div>
  );
}

/** Safety classification badge */
function SafetyBadge({ classification }: { classification: CommandInterpretation['safetyClassification'] }) {
  const colors = SAFETY_CLASSIFICATION_COLORS[classification];
  const label = SAFETY_CLASSIFICATION_LABELS[classification];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        colors.bg,
        colors.text,
        colors.border,
        'border'
      )}
    >
      {classification === 'safe' && (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )}
      {classification === 'caution' && (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      )}
      {classification === 'dangerous' && (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}
      {label}
    </span>
  );
}

/** Command type icon */
function CommandTypeIcon({ type }: { type: CommandInterpretation['commandType'] }) {
  const iconPaths: Record<string, string> = {
    move: 'M13 5l7 7-7 7M5 5l7 7-7 7',
    stop: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z',
    pickup: 'M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11',
    drop: 'M19 14l-7 7m0 0l-7-7m7 7V3',
    charge: 'M13 10V3L4 14h7v7l9-11h-7z',
    return_home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    emergency_stop: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
    custom: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  };

  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPaths[type] || iconPaths.custom} />
    </svg>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Preview component showing VLA interpretation details.
 * Displays command type, confidence score, parameters, and safety classification.
 *
 * @example
 * ```tsx
 * function InterpretationDisplay({ interpretation }: { interpretation: CommandInterpretation }) {
 *   return <CommandPreview interpretation={interpretation} />;
 * }
 * ```
 */
export function CommandPreview({ interpretation, className }: CommandPreviewProps) {
  const { commandType, parameters, confidence, safetyClassification, warnings, suggestedAlternatives } =
    interpretation;

  const commandLabel = COMMAND_TYPE_LABELS[commandType] || commandType;

  return (
    <Card className={cn('p-4 space-y-4', className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cobalt-100 dark:bg-cobalt-900/30 text-cobalt-600 dark:text-cobalt-400">
            <CommandTypeIcon type={commandType} />
          </div>
          <div>
            <h4 className="font-medium text-theme-primary">Interpreted Command</h4>
            <p className="text-lg font-semibold text-cobalt-600 dark:text-cobalt-400">
              {commandLabel}
            </p>
          </div>
        </div>
        <SafetyBadge classification={safetyClassification} />
      </div>

      {/* Confidence */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-theme-secondary">Confidence</label>
        <ConfidenceIndicator confidence={confidence} />
      </div>

      {/* Parameters */}
      {parameters && Object.keys(parameters).length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-theme-secondary">Parameters</label>
          <div className="grid grid-cols-2 gap-2">
            {parameters.target && (
              <div className="p-2 rounded bg-theme-elevated">
                <span className="text-xs text-theme-tertiary">Target</span>
                <p className="font-medium text-theme-primary">{parameters.target}</p>
              </div>
            )}
            {parameters.destination && (
              <div className="p-2 rounded bg-theme-elevated">
                <span className="text-xs text-theme-tertiary">Destination</span>
                <p className="font-medium text-theme-primary">
                  ({parameters.destination.x.toFixed(1)}, {parameters.destination.y.toFixed(1)})
                </p>
              </div>
            )}
            {parameters.objects && parameters.objects.length > 0 && (
              <div className="p-2 rounded bg-theme-elevated">
                <span className="text-xs text-theme-tertiary">Objects</span>
                <p className="font-medium text-theme-primary">{parameters.objects.join(', ')}</p>
              </div>
            )}
            {parameters.quantity && (
              <div className="p-2 rounded bg-theme-elevated">
                <span className="text-xs text-theme-tertiary">Quantity</span>
                <p className="font-medium text-theme-primary">{parameters.quantity}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-theme-secondary">Warnings</label>
          <div className="space-y-1">
            {warnings.map((warning, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 rounded bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span className="text-sm">{warning}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested alternatives for low confidence */}
      {suggestedAlternatives && suggestedAlternatives.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-theme-secondary">Did you mean?</label>
          <div className="flex flex-wrap gap-2">
            {suggestedAlternatives.map((alt, idx) => (
              <Badge key={idx} variant="info">
                {alt}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
