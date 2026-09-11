/**
 * @file CommandPreview.tsx
 * @description What the VLA made of a command: action, safety class,
 *              confidence, parameters, warnings and alternatives, as an inset panel.
 * @feature command
 */

import { AlertTriangle } from 'lucide-react';
import { KeyValueList, Panel, ProgressBar, StatusTag, type KeyValueItem } from '@/shared/components/ui';
import type { CommandInterpretation } from '../types/command.types';
import {
  SAFETY_CLASSIFICATION_LABELS,
  SAFETY_CLASSIFICATION_TONE,
  commandTypeLabel,
  getConfidenceLevel,
} from '../types/command.types';
import { COMMAND_TYPE_LABELS } from '@/features/robots/types';

export interface CommandPreviewProps {
  /** VLA interpretation to display */
  interpretation: CommandInterpretation;
  /** Additional class names */
  className?: string;
}

const CONFIDENCE_VARIANT = { high: 'success', medium: 'warning', low: 'error' } as const;

/**
 * Preview of a VLA interpretation.
 *
 * @example
 * ```tsx
 * <CommandPreview interpretation={interpretation} />
 * ```
 */
export function CommandPreview({ interpretation, className }: CommandPreviewProps) {
  const { commandType, parameters, confidence, safetyClassification, warnings, suggestedAlternatives } =
    interpretation;
  const commandLabel = commandTypeLabel(commandType, COMMAND_TYPE_LABELS);

  const items: (KeyValueItem | null)[] = [
    {
      label: 'Confidence',
      value: (
        <ProgressBar
          value={Math.round(confidence * 100)}
          size="sm"
          variant={CONFIDENCE_VARIANT[getConfidenceLevel(confidence)]}
          aria-label="Confidence"
        />
      ),
    },
    parameters?.target ? { label: 'Target', value: parameters.target } : null,
    parameters?.destination
      ? {
          label: 'Destination',
          value: (
            <span className="tabular-nums">
              {parameters.destination.x.toFixed(1)}, {parameters.destination.y.toFixed(1)}
            </span>
          ),
        }
      : null,
    parameters?.objects?.length ? { label: 'Objects', value: parameters.objects.join(', ') } : null,
    parameters?.quantity ? { label: 'Quantity', value: parameters.quantity } : null,
  ];
  const rows = items.filter((item): item is KeyValueItem => item !== null);

  return (
    <Panel variant="inset" padding="sm" className={className}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] text-ink-tertiary">Interpreted as</div>
            <div className="text-sm font-semibold text-ink-primary">{commandLabel}</div>
          </div>
          <StatusTag tone={SAFETY_CLASSIFICATION_TONE[safetyClassification]} dot>
            {SAFETY_CLASSIFICATION_LABELS[safetyClassification]}
          </StatusTag>
        </div>

        <KeyValueList columns={2} items={rows} />

        {warnings && warnings.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {warnings.map((warning, idx) => (
              <li key={idx} className="flex items-start gap-2 text-[13px] text-ink-secondary">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-signal-unknown" strokeWidth={1.75} />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}

        {suggestedAlternatives && suggestedAlternatives.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-tertiary">Did you mean</span>
            {suggestedAlternatives.map((alt, idx) => (
              <span
                key={idx}
                className="rounded-tag border border-line px-2 py-0.5 text-[13px] text-ink-secondary"
              >
                {alt}
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
