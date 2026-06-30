/**
 * @file CockpitCommandDock.tsx
 * @description The cockpit's action surface: one-tap quick commands, a natural-
 *   language command bar (interpret → review → execute), and an always-visible
 *   emergency stop. All actions hit the real robot command API, so they drive the
 *   simulator today and a physical G1 once its hardware bridge is brought up.
 * @feature robots
 */

import { memo, useState, useCallback } from 'react';
import { Home, Zap, Square, Send, CornerDownLeft, ShieldAlert } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui';
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

const SAFETY_STYLE: Record<SafetyClassification, string> = {
  safe: 'bg-[#18E4C3]/10 text-[#18E4C3] border-[#18E4C3]/30',
  caution: 'bg-amber-400/10 text-amber-400 border-amber-400/30',
  dangerous: 'bg-red-500/10 text-red-400 border-red-500/30',
};

export const CockpitCommandDock = memo(function CockpitCommandDock({
  robotId,
  robotName,
  canExecute,
  className,
}: CockpitCommandDockProps) {
  const [pending, setPending] = useState<CommandType | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

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

  const announce = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2600);
  }, []);

  const quick = useCallback(
    async (type: CommandType, label: string) => {
      setPending(type);
      try {
        await robotsApi.sendCommand(robotId, { type, priority: type === 'stop' ? 'high' : 'normal' });
        announce(`${label} sent`);
      } catch {
        announce(`${label} failed`);
      } finally {
        setPending(null);
      }
    },
    [robotId, announce],
  );

  const onInterpret = useCallback(() => {
    if (currentText.trim()) void interpretCommand(robotId);
  }, [currentText, interpretCommand, robotId]);

  const onExecute = useCallback(async () => {
    try {
      await executeCommand(robotId);
      announce('Command executed');
    } catch {
      announce('Execution failed');
    }
  }, [executeCommand, robotId, announce]);

  return (
    <div className={cn('rounded-2xl border border-theme bg-theme-card/40 p-4', className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <QuickButton icon={<Home className="h-4 w-4" />} label="Return Home" loading={pending === 'return_home'} disabled={!canExecute || pending !== null} onClick={() => quick('return_home', 'Return home')} />
          <QuickButton icon={<Zap className="h-4 w-4" />} label="Charge" loading={pending === 'charge'} disabled={!canExecute || pending !== null} onClick={() => quick('charge', 'Go charge')} />
          <QuickButton icon={<Square className="h-4 w-4" />} label="Stop" loading={pending === 'stop'} disabled={!canExecute || pending !== null} onClick={() => quick('stop', 'Stop')} />
        </div>

        {/* NL command bar */}
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1">
            <input
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onInterpret()}
              placeholder={`Tell ${robotName} what to do…  e.g. "walk to the kitchen"`}
              className="w-full rounded-xl border border-theme bg-theme-primary/60 py-2.5 pl-3 pr-10 text-sm text-theme-primary placeholder:text-theme-tertiary focus:border-[#2A5FFF]/60 focus:outline-none focus:ring-1 focus:ring-[#2A5FFF]/40"
            />
            <CornerDownLeft className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-tertiary" />
          </div>
          <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} isLoading={isInterpreting} disabled={!currentText.trim()} onClick={onInterpret}>
            Interpret
          </Button>
        </div>

        {/* Emergency stop */}
        <div className="flex items-center justify-end">
          <EmergencyStopButton robotId={robotId} robotName={robotName} size="lg" />
        </div>
      </div>

      {/* Interpretation review */}
      {interpretation && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[#2A5FFF]/25 bg-[#2A5FFF]/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ShieldAlert className="h-4 w-4 text-[#2A5FFF]" />
            <span className="text-theme-secondary">Interpreted as</span>
            <span className="font-mono font-semibold text-theme-primary">{interpretation.commandType}</span>
            <span className="text-theme-tertiary">·</span>
            <span className="font-mono text-theme-secondary">{Math.round(interpretation.confidence * 100)}% conf.</span>
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SAFETY_STYLE[interpretation.safetyClassification])}>
              {interpretation.safetyClassification}
            </span>
            {interpretation.warnings?.map((w) => (
              <span key={w} className="text-[11px] text-amber-400">⚠ {w}</span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearInterpretation}>Dismiss</Button>
            <Button variant="primary" size="sm" isLoading={isExecuting} disabled={!canRunInterpretation || !canExecute} onClick={onExecute}>
              Execute
            </Button>
          </div>
        </div>
      )}

      {(flash || error) && (
        <p className={cn('mt-2 font-mono text-xs', error ? 'text-red-400' : 'text-[#18E4C3]')}>
          {error ?? flash}
        </p>
      )}
    </div>
  );
});

function QuickButton({
  icon,
  label,
  onClick,
  loading,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button variant="secondary" size="md" leftIcon={icon} isLoading={loading} disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}
