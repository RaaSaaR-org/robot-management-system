/**
 * @file CockpitCommandDock.tsx
 * @description The control center's sticky command dock: a natural-language command
 *   bar (interpret → review → run), quick commands (home, charge, stop task) and the
 *   always-reachable emergency stop. Robot-moving acts confirm first; results toast.
 * @feature robots
 */

import { memo, useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { Home, Send, Square, Zap } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Badge, Button, Input, StatusTag, confirm, toast, type Tone } from '@/shared/components/ui';
import { EmergencyStopButton } from '../EmergencyStopButton';
import { robotsApi } from '../../api/robotsApi';
import { useCommand } from '@/features/command/hooks';
import type { CommandType } from '../../types/robots.types';
import type { SafetyClassification } from '@/features/command/types';

export interface CockpitCommandDockProps {
  robotId: string;
  robotName: string;
  /** Whether the robot is in a state that accepts commands. */
  canExecute: boolean;
  className?: string;
}

const SAFETY_TONE: Record<SafetyClassification, Tone> = {
  safe: 'success',
  caution: 'warning',
  dangerous: 'danger',
};

interface QuickAct {
  type: CommandType;
  label: string;
  icon: ReactNode;
  title: (name: string) => string;
  description: (name: string) => string;
  confirmLabel: string;
  done: string;
  failed: string;
}

const ICON = 'h-4 w-4';

const QUICK_ACTS: QuickAct[] = [
  {
    type: 'return_home', label: 'Return home', icon: <Home className={ICON} strokeWidth={1.75} />,
    title: (n) => `Send ${n} home?`,
    description: (n) => `${n} leaves its current task and walks back to its home position.`,
    confirmLabel: 'Send home', done: 'Sent home', failed: "Couldn't send home",
  },
  {
    type: 'charge', label: 'Charge', icon: <Zap className={ICON} strokeWidth={1.75} />,
    title: (n) => `Send ${n} to charge?`,
    description: (n) => `${n} leaves its current task and drives to the nearest dock.`,
    confirmLabel: 'Send to charge', done: 'Sent to charge', failed: "Couldn't send to charge",
  },
  {
    type: 'stop', label: 'Stop task', icon: <Square className={ICON} strokeWidth={1.75} />,
    title: (n) => `Stop ${n}'s current task?`,
    description: () => 'The robot halts in place and drops the task it is running.',
    confirmLabel: 'Stop task', done: 'Task stopped', failed: "Couldn't stop the task",
  },
];

/** Readable text for an API rejection (ApiError objects are not Error instances). */
const errorText = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
};

export const CockpitCommandDock = memo(function CockpitCommandDock({
  robotId,
  robotName,
  canExecute,
  className,
}: CockpitCommandDockProps) {
  const [pending, setPending] = useState<CommandType | null>(null);
  const {
    currentText,
    interpretation,
    isInterpreting,
    isExecuting,
    canExecute: canRunInterpretation,
    error,
    setCurrentText,
    interpretCommand,
    executeCommand,
    clearInterpretation,
  } = useCommand();

  const runQuick = useCallback(
    async (act: QuickAct) => {
      const ok = await confirm({
        title: act.title(robotName),
        description: act.description(robotName),
        confirmLabel: act.confirmLabel,
      });
      if (!ok) return;
      setPending(act.type);
      try {
        await robotsApi.sendCommand(robotId, { type: act.type, priority: act.type === 'stop' ? 'high' : 'normal' });
        toast.success(act.done, { description: robotName });
      } catch (err) {
        toast.error(act.failed, { description: errorText(err) });
      } finally {
        setPending(null);
      }
    },
    [robotId, robotName],
  );

  const onSend = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (currentText.trim()) void interpretCommand(robotId);
    },
    [currentText, interpretCommand, robotId],
  );

  const onRun = useCallback(async () => {
    if (!interpretation) return;
    const ok = await confirm({
      title: `Run this command on ${robotName}?`,
      description: `“${interpretation.originalText || currentText}” — ${robotName} starts moving right away.`,
      confirmLabel: 'Run command',
    });
    if (!ok) return;
    try {
      await executeCommand(robotId);
      toast.success('Command sent', { description: robotName });
    } catch (err) {
      toast.error("Couldn't send the command", { description: errorText(err) });
    }
  }, [interpretation, robotName, currentText, executeCommand, robotId]);

  const offlineHint = canExecute ? undefined : `${robotName} is not accepting commands right now.`;

  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-line bg-canvas px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
        className,
      )}
    >
      {interpretation && (
        <div className="flex flex-col gap-2 rounded-control border border-line bg-panel px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-ink-secondary">
            <span>Interpreted as</span>
            <code className="font-mono text-[13px] text-ink-primary">{interpretation.commandType}</code>
            <Badge variant="neutral" size="sm">{Math.round(interpretation.confidence * 100)}% confidence</Badge>
            <StatusTag tone={SAFETY_TONE[interpretation.safetyClassification] ?? 'neutral'}>
              {interpretation.safetyClassification}
            </StatusTag>
            {interpretation.warnings?.map((w) => (
              <span key={w} className="text-xs text-signal-estimated">{w}</span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearInterpretation}>Dismiss</Button>
            <Button
              variant="secondary"
              size="sm"
              isLoading={isExecuting}
              disabled={!canRunInterpretation || !canExecute}
              title={offlineHint}
              onClick={() => void onRun()}
            >
              Run
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <form onSubmit={onSend} className="flex min-w-0 flex-1 items-center gap-2 lg:order-2">
          <div className="min-w-0 flex-1">
            <Input
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              placeholder={`Tell ${robotName} what to do…`}
              aria-label={`Command for ${robotName}`}
            />
          </div>
          <Button
            type="submit"
            leftIcon={<Send className={ICON} strokeWidth={1.75} />}
            isLoading={isInterpreting}
            disabled={!currentText.trim()}
          >
            Send
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-2 lg:contents">
          <div className="flex items-center gap-2 lg:order-1">
            {QUICK_ACTS.map((act) => (
              <Button
                key={act.type}
                variant="secondary"
                leftIcon={act.icon}
                isLoading={pending === act.type}
                disabled={!canExecute || pending !== null}
                title={offlineHint ?? act.label}
                aria-label={act.label}
                onClick={() => void runQuick(act)}
              >
                <span className="hidden xl:inline">{act.label}</span>
              </Button>
            ))}
          </div>
          <EmergencyStopButton robotId={robotId} robotName={robotName} className="ml-auto shrink-0 lg:order-3 lg:ml-0" />
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-signal-stopped">{error}</p>}
    </div>
  );
});
