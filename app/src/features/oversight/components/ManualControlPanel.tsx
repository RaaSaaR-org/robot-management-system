/**
 * @file ManualControlPanel.tsx
 * @description Manual control of the selected robot: take control, hand it back, list active sessions
 * @feature oversight
 */

import { useState } from 'react';
import { Hand, Power } from 'lucide-react';
import { Button, EmptyState, KeyValueList, Panel, StatusTag, confirm, toast } from '@/shared/components/ui';
import type { ActivateManualModeInput, ManualControlSession } from '../types';
import { ManualModeFormModal } from './ManualModeFormModal';
import { errorMessage, formatDuration } from './oversightFormat';

export interface ManualControlPanelProps {
  /** The robot picked in the toolbar; null for "All robots". */
  robot: { id: string; name: string; status: string } | null;
  activeSessions: ManualControlSession[];
  operatorId?: string;
  onActivate: (input: ActivateManualModeInput) => Promise<unknown>;
  onDeactivate: (robotId: string) => Promise<void>;
  isDeactivating?: boolean;
  /** Resolves a robot id to its display name (sessions often carry only the id). */
  robotName?: (id: string) => string;
  className?: string;
}

export function ManualControlPanel({
  robot,
  activeSessions,
  operatorId,
  onActivate,
  onDeactivate,
  isDeactivating,
  robotName,
  className,
}: ManualControlPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const session = robot ? activeSessions.find((s) => s.robotId === robot.id && s.isActive) : undefined;
  const nameOf = (s: ManualControlSession) => s.robotName ?? robotName?.(s.robotId) ?? s.robotId;

  const handBack = async (s: ManualControlSession) => {
    const name = nameOf(s);
    const ok = await confirm({
      title: `Hand back control of ${name}?`,
      description: `${name} resumes autonomous work with its normal speed and force limits.`,
      confirmLabel: 'Hand back control',
    });
    if (!ok) return;
    try {
      await onDeactivate(s.robotId);
      toast.success('Manual mode ended', { description: name });
    } catch (err) {
      toast.error("Couldn't end manual mode", { description: errorMessage(err) });
    }
  };

  const others = activeSessions.filter((s) => s.isActive && s.robotId !== robot?.id);

  return (
    <Panel className={className}>
      <Panel.Header
        title="Manual control"
        description="Take a robot out of autonomy and drive it yourself."
        actions={session ? <StatusTag tone="gated" dot>Manual</StatusTag> : robot ? <StatusTag status={robot.status} dot /> : undefined}
      />
      <Panel.Body className="flex flex-col gap-4">
        {!robot ? (
          <EmptyState size="sm" icon={<Hand />} title="Pick a robot to take manual control" description="Choose one in the robot filter above." />
        ) : session ? (
          <>
            <p className="text-sm text-ink-secondary">{session.reason}</p>
            <KeyValueList
              items={[
                { label: 'Operator', value: session.operatorName ?? session.operatorId },
                { label: 'Duration', value: formatDuration(session.startedAt) },
                { label: 'Speed limit', value: `${session.speedLimitMmPerSec} mm/s` },
                { label: 'Force limit', value: `${session.forceLimitN} N` },
              ]}
            />
            <div>
              <Button
                variant="secondary"
                leftIcon={<Power className="h-4 w-4" strokeWidth={1.75} />}
                onClick={() => void handBack(session)}
                isLoading={isDeactivating}
              >
                Hand back control
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-secondary">
              {robot.name} runs autonomously. Taking control stops its current work until you hand it back.
            </p>
            <div>
              <Button variant="secondary" leftIcon={<Hand className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setFormOpen(true)}>
                Take manual control
              </Button>
            </div>
          </>
        )}

        {others.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line-subtle pt-4">
            <div className="text-[13px] text-ink-tertiary">Other robots under manual control</div>
            <ul className="flex flex-col gap-2">
              {others.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink-primary">{nameOf(s)}</span>
                  <Button variant="ghost" size="sm" onClick={() => void handBack(s)}>Hand back</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel.Body>

      <ManualModeFormModal
        isOpen={formOpen}
        robot={robot}
        operatorId={operatorId}
        onClose={() => setFormOpen(false)}
        onActivate={onActivate}
      />
    </Panel>
  );
}
