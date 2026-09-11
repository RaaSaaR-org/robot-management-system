/**
 * @file CommandConfirmation.tsx
 * @description Confirm dialog before a command runs: it moves a robot, so the
 *              consequence ("{robot} will …") is spelled out, with the safety
 *              class and any warnings.
 * @feature command
 */

import { AlertTriangle } from 'lucide-react';
import { ConfirmDialog, KeyValueList, StatusTag } from '@/shared/components/ui';
import type { CommandInterpretation } from '../types/command.types';
import {
  SAFETY_CLASSIFICATION_LABELS,
  SAFETY_CLASSIFICATION_TONE,
  commandTypeLabel,
  formatConfidence,
} from '../types/command.types';
import { COMMAND_TYPE_LABELS } from '@/features/robots/types';

export interface CommandConfirmationProps {
  /** VLA interpretation to confirm */
  interpretation: CommandInterpretation;
  /** Target robot ID */
  robotId: string;
  /** Robot name for display */
  robotName: string;
  /** Whether modal is open */
  isOpen: boolean;
  /** Callback when user confirms (a returned promise shows loading) */
  onConfirm: () => void | Promise<void>;
  /** Callback when user cancels */
  onCancel: () => void;
  /** Whether command is currently executing */
  isExecuting: boolean;
}

/** "Atlas will move to Warehouse A." — the consequence in one sentence */
export function describeConsequence(interpretation: CommandInterpretation, robotName: string): string {
  const { commandType, parameters, originalText } = interpretation;
  const where =
    parameters?.target ??
    (parameters?.destination
      ? `${parameters.destination.x.toFixed(1)}, ${parameters.destination.y.toFixed(1)}`
      : null);
  const what = parameters?.objects?.length ? parameters.objects.join(', ') : parameters?.target;
  // Some interpreters answer with types outside the union ("navigation"), so switch on the string.
  switch (commandType as string) {
    case 'move':
    case 'navigation':
      return `${robotName} will move to ${where ?? 'the target'}.`;
    case 'pickup':
      return `${robotName} will pick up ${what ?? 'the object'}.`;
    case 'drop':
      return `${robotName} will put down ${what ?? 'what it carries'}.`;
    case 'charge':
      return `${robotName} will drive to its charger.`;
    case 'return_home':
      return `${robotName} will return home.`;
    case 'stop':
    case 'emergency_stop':
      return `${robotName} will stop.`;
    default:
      return `${robotName} will act on “${originalText}”.`;
  }
}

/**
 * Confirmation before executing a command.
 *
 * @example
 * ```tsx
 * <CommandConfirmation interpretation={i} robotId="r1" robotName="Atlas-01" isOpen={open}
 *   onConfirm={execute} onCancel={() => setOpen(false)} isExecuting={executing} />
 * ```
 */
export function CommandConfirmation({
  interpretation,
  robotName,
  isOpen,
  onConfirm,
  onCancel,
  isExecuting,
}: CommandConfirmationProps) {
  const { commandType, originalText, safetyClassification, confidence, warnings } = interpretation;
  const isDangerous = safetyClassification === 'dangerous';

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onCancel}
      onConfirm={onConfirm}
      isLoading={isExecuting}
      tone={isDangerous ? 'danger' : 'default'}
      title={`Run this command on ${robotName}?`}
      description={describeConsequence(interpretation, robotName)}
      confirmLabel={isDangerous ? 'Execute anyway' : 'Execute command'}
    >
      <div className="flex flex-col gap-4">
        <KeyValueList
          columns={2}
          items={[
            { label: 'Command', value: originalText },
            { label: 'Action', value: commandTypeLabel(commandType, COMMAND_TYPE_LABELS) },
            { label: 'Confidence', value: <span className="tabular-nums">{formatConfidence(confidence)}</span> },
            {
              label: 'Safety',
              value: (
                <StatusTag tone={SAFETY_CLASSIFICATION_TONE[safetyClassification]} dot>
                  {SAFETY_CLASSIFICATION_LABELS[safetyClassification]}
                </StatusTag>
              ),
            },
          ]}
        />
        {isDangerous && (
          <p className="text-[13px] text-signal-stopped">
            This command is classified as dangerous. Make sure nobody is in the robot's path.
          </p>
        )}
        {safetyClassification === 'caution' && (
          <p className="text-[13px] text-signal-unknown">
            Check that the robot and its surroundings are ready before it moves.
          </p>
        )}
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
      </div>
    </ConfirmDialog>
  );
}
