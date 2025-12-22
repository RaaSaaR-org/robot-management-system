/**
 * @file CommandBar.tsx
 * @description Natural language command input bar with interpretation and execution
 * @feature command
 * @dependencies @/shared/utils/cn, @/shared/components/ui, @/features/command/hooks
 */

import { useState, useCallback, type KeyboardEvent, type FormEvent } from 'react';
import { cn } from '@/shared/utils/cn';
import { Input } from '@/shared/components/ui/Input';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { useCommand, useSimulation } from '../hooks';
import { CommandPreview } from './CommandPreview';
import { CommandConfirmation } from './CommandConfirmation';
import { SafetySimulationPreview } from './SafetySimulationPreview';

// ============================================================================
// TYPES
// ============================================================================

export interface CommandBarProps {
  /** Target robot ID */
  robotId: string;
  /** Robot name for display in confirmation */
  robotName: string;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Natural language command input bar.
 * Provides text input for commands, sends to VLA for interpretation,
 * shows preview, and handles execution with confirmation.
 *
 * @example
 * ```tsx
 * function RobotControl({ robot }: { robot: Robot }) {
 *   return (
 *     <CommandBar robotId={robot.id} robotName={robot.name} />
 *   );
 * }
 * ```
 */
export function CommandBar({ robotId, robotName, className }: CommandBarProps) {
  const {
    currentText,
    setCurrentText,
    interpretation,
    interpretCommand,
    executeCommand,
    clearInterpretation,
    isInterpreting,
    isExecuting,
    canExecute,
    error,
    clearError,
  } = useCommand();

  // Get simulation data for safety preview
  const {
    canvasRobotPosition,
    canvasDestination,
    canvasObstacles,
    shouldShowSimulation,
  } = useSimulation(robotId, interpretation);

  const [showConfirmation, setShowConfirmation] = useState(false);

  // Handle form submission (interpret command)
  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!currentText.trim() || isInterpreting) return;

      try {
        await interpretCommand(robotId);
      } catch {
        // Error is handled in store
      }
    },
    [currentText, isInterpreting, interpretCommand, robotId]
  );

  // Handle Enter key to submit
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (currentText.trim() && !isInterpreting) {
          handleSubmit(e as unknown as FormEvent);
        }
      }
    },
    [currentText, isInterpreting, handleSubmit]
  );

  // Handle execute button click
  const handleExecuteClick = useCallback(() => {
    if (canExecute) {
      setShowConfirmation(true);
    }
  }, [canExecute]);

  // Handle confirmation
  const handleConfirm = useCallback(async () => {
    try {
      await executeCommand(robotId);
      setShowConfirmation(false);
    } catch {
      // Error is handled in store
    }
  }, [executeCommand, robotId]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setShowConfirmation(false);
  }, []);

  // Handle clear
  const handleClear = useCallback(() => {
    setCurrentText('');
    clearInterpretation();
    clearError();
  }, [setCurrentText, clearInterpretation, clearError]);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Input form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter a command in natural language (e.g., 'Move to Warehouse B')"
              disabled={isInterpreting || isExecuting}
              error={error ?? undefined}
              fullWidth
              leftIcon={
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                  />
                </svg>
              }
            />
          </div>

          {/* Interpret button */}
          <Button
            type="submit"
            variant="primary"
            disabled={!currentText.trim() || isInterpreting || isExecuting}
          >
            {isInterpreting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Interpreting...
              </>
            ) : (
              'Interpret'
            )}
          </Button>

          {/* Clear button */}
          {(currentText || interpretation) && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleClear}
              disabled={isInterpreting || isExecuting}
              aria-label="Clear command"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </Button>
          )}
        </div>

        {/* Hint text */}
        {!interpretation && !error && (
          <p className="text-xs text-theme-tertiary">
            Press Enter or click Interpret to analyze command. Examples: "Pick up the box", "Go to
            charging station", "Return home"
          </p>
        )}
      </form>

      {/* Interpretation preview */}
      {interpretation && (
        <div className="space-y-3">
          <CommandPreview interpretation={interpretation} />

          {/* Safety simulation preview */}
          {shouldShowSimulation && (
            <SafetySimulationPreview
              robotPosition={canvasRobotPosition}
              destination={canvasDestination}
              obstacles={canvasObstacles}
              safetyClassification={interpretation.safetyClassification}
              isVisible={true}
            />
          )}

          {/* Execute button */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleClear} disabled={isExecuting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleExecuteClick}
              disabled={!canExecute || isExecuting}
            >
              {isExecuting ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Executing...
                </>
              ) : (
                'Execute Command'
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {interpretation && (
        <CommandConfirmation
          interpretation={interpretation}
          robotId={robotId}
          robotName={robotName}
          isOpen={showConfirmation}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          isExecuting={isExecuting}
        />
      )}
    </div>
  );
}
