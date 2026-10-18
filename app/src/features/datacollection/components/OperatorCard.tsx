/**
 * @file OperatorCard.tsx
 * @description What the operator in the headset sees and does, for the
 *              desktop assistant (TASK-414): "In VR · link live 38 ms", grip
 *              bars per hand, the headset's why line (amber / red) and what the
 *              robot held. Without an operator it says how to bring the headset
 *              in, with the Quest buttons (TASK-412). Display only.
 * @feature datacollection
 */

import { Glasses } from 'lucide-react';
import { Panel, StatusTag, type StatusTagTone } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { QuestControls } from '../../robots/components/readiness/QuestControls';
import { questLivePath } from '../../robots/api/readinessApi';
import { useReadinessStore } from '../../robots/store/readinessStore';
import type { OperatorState, PresenceViewer } from '../types/datacollection.types';

export interface OperatorCardProps {
  robotId: string;
  sessionId: string;
  /** The operator's fresh state, or null when none arrived for 2 s. */
  operator: OperatorState | null;
  /** The headset watching the session, from presence (it may not be in VR yet). */
  operatorViewer: PresenceViewer | null;
  className?: string;
}

const LINK_TONE: Record<OperatorState['link'], StatusTagTone> = { live: 'live', stale: 'warning', lost: 'danger' };

const WHY_CLASS: Record<OperatorState['why']['severity'], string> = {
  block: 'text-signal-stopped',
  warn: 'text-signal-estimated',
  ok: 'text-ink-secondary',
};

/** "In VR · link live 38 ms" / "Headset open, not in VR". */
export function operatorStatusLine(op: OperatorState): string {
  if (!op.inVr) return 'Headset open, not in VR';
  const rtt = op.rttMs === null ? '' : ` ${Math.round(op.rttMs)} ms`;
  return `In VR · link ${op.link}${rtt}`;
}

function GripBar({ side, value, clutched }: { side: 'L' | 'R'; value: number; clutched: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex items-center gap-2" data-testid={`operator-grip-${side === 'L' ? 'left' : 'right'}`} data-value={pct}>
      <span className="w-3 text-[12px] font-medium text-ink-tertiary">{side}</span>
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-inset"
        role="meter"
        aria-label={`${side === 'L' ? 'Left' : 'Right'} grip`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-150', clutched ? 'bg-primary' : 'bg-ink-muted')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-right text-[12px] tabular-nums text-ink-tertiary">{pct}%</span>
    </div>
  );
}

export function OperatorCard({ robotId, sessionId, operator, operatorViewer, className }: OperatorCardProps) {
  const quest = useReadinessStore((s) => s.byRobot[robotId]?.readiness.quest ?? null);
  const name = operatorViewer?.displayName;

  if (!operator) {
    const livePath = questLivePath(robotId) ?? `/data-collection/live?robot=${robotId}`;
    return (
      <Panel className={className} data-testid="operator-card" data-state={operatorViewer ? 'connected' : 'waiting'}>
        <Panel.Header title="Operator" description={name ? `${name} · headset` : undefined} />
        <Panel.Body className="flex flex-col gap-3">
          {operatorViewer ? (
            <p className="text-[13px] text-ink-secondary" data-testid="operator-status">
              The headset has the session open. Waiting for it to enter VR.
            </p>
          ) : (
            <p className="text-[13px] text-ink-secondary" data-testid="operator-status">
              Waiting for the headset — open <code className="select-all font-mono text-[12px] text-ink-primary">{livePath}</code> on the Quest.
            </p>
          )}
          {quest && <QuestControls robotId={robotId} quest={quest} sessionId={sessionId} />}
        </Panel.Body>
      </Panel>
    );
  }

  return (
    <Panel className={className} data-testid="operator-card" data-state={operator.inVr ? 'in-vr' : 'connected'}>
      <Panel.Header
        title="Operator"
        description={name ? `${name} · headset` : undefined}
        actions={<Glasses className="h-4 w-4 text-ink-tertiary" strokeWidth={1.75} aria-hidden />}
      />
      <Panel.Body className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusTag
            tone={operator.inVr ? LINK_TONE[operator.link] : 'neutral'}
            dot
            pulse={operator.inVr && operator.link === 'live'}
            data-testid="operator-status"
          >
            {operatorStatusLine(operator)}
          </StatusTag>
        </div>
        <div className="flex flex-col gap-1.5">
          <GripBar side="L" value={operator.grip.left} clutched={operator.clutch.left} />
          <GripBar side="R" value={operator.grip.right} clutched={operator.clutch.right} />
        </div>
        <p
          className={cn('text-[13px] font-medium', WHY_CLASS[operator.why.severity])}
          data-testid="operator-why"
          data-severity={operator.why.severity}
          data-code={operator.why.code}
        >
          {operator.why.text}
        </p>
        {operator.held && (
          <p className="text-[12px] text-ink-tertiary" data-testid="operator-held">
            held: {operator.held.reason}
            {operator.held.side !== 'both' ? ` (${operator.held.side})` : ''}
          </p>
        )}
      </Panel.Body>
    </Panel>
  );
}
