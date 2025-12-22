/**
 * @file CommandConfirmation.tsx
 * @description Modal for confirming command execution
 * @feature command
 * @dependencies @/shared/utils/cn, @/shared/components/ui, @/features/command/types
 */

import { cn } from '@/shared/utils/cn';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import type { CommandInterpretation } from '../types/command.types';
import { SAFETY_CLASSIFICATION_LABELS, SAFETY_CLASSIFICATION_COLORS } from '../types/command.types';
import { COMMAND_TYPE_LABELS } from '@/features/robots/types';

// ============================================================================
// TYPES
// ============================================================================

export interface CommandConfirmationProps {
  /** VLA interpretation to confirm */
  interpretation: CommandInterpretation;
  /** Target robot ID */
  robotId: string;
  /** Robot name for display */
  robotName: string;
  /** Whether modal is open */
  isOpen: boolean;
  /** Callback when user confirms */
  onConfirm: () => void;
  /** Callback when user cancels */
  onCancel: () => void;
  /** Whether command is currently executing */
  isExecuting: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Confirmation modal before executing a command.
 * Shows command details and safety warnings.
 *
 * @example
 * ```tsx
 * function CommandExecutor() {
 *   const [showConfirm, setShowConfirm] = useState(false);
 *
 *   return (
 *     <CommandConfirmation
 *       interpretation={interpretation}
 *       robotId="robot-001"
 *       robotName="Atlas-01"
 *       isOpen={showConfirm}
 *       onConfirm={handleExecute}
 *       onCancel={() => setShowConfirm(false)}
 *       isExecuting={isExecuting}
 *     />
 *   );
 * }
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
  const commandLabel = COMMAND_TYPE_LABELS[commandType] || commandType;
  const safetyColors = SAFETY_CLASSIFICATION_COLORS[safetyClassification];
  const safetyLabel = SAFETY_CLASSIFICATION_LABELS[safetyClassification];

  const isDangerous = safetyClassification === 'dangerous';
  const isCaution = safetyClassification === 'caution';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Confirm Command Execution"
      size="md"
    >
      <div className="space-y-4">
        {/* Command summary */}
        <div className="p-4 rounded-lg bg-theme-elevated">
          <p className="text-sm text-theme-secondary mb-1">Command</p>
          <p className="text-lg font-medium text-theme-primary">{originalText}</p>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-theme-elevated">
            <p className="text-xs text-theme-tertiary mb-1">Robot</p>
            <p className="font-medium text-theme-primary">{robotName}</p>
          </div>
          <div className="p-3 rounded-lg bg-theme-elevated">
            <p className="text-xs text-theme-tertiary mb-1">Action</p>
            <p className="font-medium text-theme-primary">{commandLabel}</p>
          </div>
          <div className="p-3 rounded-lg bg-theme-elevated">
            <p className="text-xs text-theme-tertiary mb-1">Confidence</p>
            <p className="font-medium text-theme-primary">{Math.round(confidence * 100)}%</p>
          </div>
          <div className={cn('p-3 rounded-lg', safetyColors.bg)}>
            <p className={cn('text-xs mb-1', safetyColors.text, 'opacity-70')}>Safety</p>
            <p className={cn('font-medium', safetyColors.text)}>{safetyLabel}</p>
          </div>
        </div>

        {/* Warning banner for dangerous actions */}
        {isDangerous && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <svg
              className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="font-medium text-red-800 dark:text-red-200">Dangerous Action</p>
              <p className="text-sm text-red-700 dark:text-red-300">
                This command has been classified as potentially dangerous. Please confirm you want
                to proceed.
              </p>
            </div>
          </div>
        )}

        {/* Caution banner */}
        {isCaution && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <svg
              className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">Proceed with Caution</p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                This command requires careful execution. Verify the robot and environment are ready.
              </p>
            </div>
          </div>
        )}

        {/* Additional warnings */}
        {warnings && warnings.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-theme-secondary">Warnings</p>
            <ul className="space-y-1">
              {warnings.map((warning, idx) => (
                <li
                  key={idx}
                  className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01"
                    />
                  </svg>
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-theme">
          <Button variant="outline" onClick={onCancel} disabled={isExecuting}>
            Cancel
          </Button>
          <Button
            variant={isDangerous ? 'destructive' : 'primary'}
            onClick={onConfirm}
            disabled={isExecuting}
          >
            {isExecuting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Executing...
              </>
            ) : (
              <>
                {isDangerous ? 'Execute Anyway' : 'Execute Command'}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
