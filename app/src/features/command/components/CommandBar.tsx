/**
 * @file CommandBar.tsx
 * @description Natural-language command input: interpret a sentence, preview
 *              what the robot will do, then execute it through a confirm dialog.
 *              Renders no heading and no outer Panel — the host wraps it.
 * @feature command
 */

import { useCallback, useId, useState, type FormEvent } from 'react';
import { Send, Sparkles, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button, Input, ToggleChip, errorMessage, toast } from '@/shared/components/ui';
import { useCommand, useSimulation } from '../hooks';
import { CommandPreview } from './CommandPreview';
import { CommandConfirmation } from './CommandConfirmation';
import { SafetySimulationPreview } from './SafetySimulationPreview';

export interface CommandBarProps {
  /** Target robot ID */
  robotId: string;
  /** Robot name for display in confirmation */
  robotName: string;
  /** Additional class names */
  className?: string;
}

const EXAMPLES = ['Move to Warehouse A', 'Go to the charging station', 'Return home'];

/**
 * Natural language command bar: text → VLA interpretation → preview → confirm → execute.
 *
 * @example
 * ```tsx
 * <Panel><Panel.Header title="Command" /><Panel.Body><CommandBar robotId={r.id} robotName={r.name} /></Panel.Body></Panel>
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

  const { canvasRobotPosition, canvasDestination, canvasObstacles, shouldShowSimulation } =
    useSimulation(robotId, interpretation);

  const [showConfirmation, setShowConfirmation] = useState(false);
  const errorId = useId();
  const busy = isInterpreting || isExecuting;

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!currentText.trim() || isInterpreting) return;
      try {
        await interpretCommand(robotId);
      } catch {
        // The store keeps the error; it renders under the input.
      }
    },
    [currentText, isInterpreting, interpretCommand, robotId]
  );

  const handleConfirm = useCallback(async () => {
    try {
      await executeCommand(robotId);
      setShowConfirmation(false);
      toast.success('Command sent', { description: `${robotName} received the command.` });
    } catch (err) {
      setShowConfirmation(false);
      toast.error("Couldn't send command", {
        description: errorMessage(err),
      });
    }
  }, [executeCommand, robotId, robotName]);

  const handleClear = useCallback(() => {
    setCurrentText('');
    clearInterpretation();
    clearError();
  }, [setCurrentText, clearInterpretation, clearError]);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <Input
            className="min-w-0 flex-1"
            fullWidth
            value={currentText}
            onChange={(e) => setCurrentText(e.target.value)}
            placeholder={`Tell ${robotName} what to do`}
            aria-label={`Command for ${robotName}`}
            disabled={busy}
            invalid={Boolean(error)}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId : undefined}
            leftIcon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}
          />
          <Button
            type="submit"
            iconOnly
            aria-label="Interpret command"
            title="Interpret command"
            isLoading={isInterpreting}
            disabled={!currentText.trim() || busy}
          >
            <Send className="h-4 w-4" strokeWidth={1.75} />
          </Button>
          {(currentText || interpretation) && (
            <Button variant="ghost" iconOnly aria-label="Clear command" onClick={handleClear} disabled={busy}>
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          )}
        </div>

        {error ? (
          <p id={errorId} role="alert" className="text-[13px] text-signal-stopped">
            {error}
          </p>
        ) : (
          !interpretation && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-ink-tertiary">Try</span>
              {EXAMPLES.map((example) => (
                <ToggleChip
                  key={example}
                  size="sm"
                  active={currentText === example}
                  onClick={() => setCurrentText(example)}
                  disabled={busy}
                >
                  {example}
                </ToggleChip>
              ))}
            </div>
          )
        )}
      </form>

      {interpretation && (
        <div className="flex flex-col gap-3">
          <CommandPreview interpretation={interpretation} />
          {shouldShowSimulation && (
            <SafetySimulationPreview
              robotPosition={canvasRobotPosition}
              destination={canvasDestination}
              obstacles={canvasObstacles}
              safetyClassification={interpretation.safetyClassification}
              commandType={interpretation.commandType}
              isVisible
            />
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={handleClear} disabled={isExecuting}>
              Discard
            </Button>
            <Button
              onClick={() => canExecute && setShowConfirmation(true)}
              disabled={!canExecute || isExecuting}
              isLoading={isExecuting}
            >
              Execute command
            </Button>
          </div>
        </div>
      )}

      {interpretation && (
        <CommandConfirmation
          interpretation={interpretation}
          robotId={robotId}
          robotName={robotName}
          isOpen={showConfirmation}
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirmation(false)}
          isExecuting={isExecuting}
        />
      )}
    </div>
  );
}
