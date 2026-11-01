/**
 * @file OperatorChip.tsx
 * @description The operator in the headset, as one chip on the Record live
 *              view's bottom-left (TASK-428): the avatar, the link latency in
 *              mint (amber when stale, red when lost) and the grip bars L and
 *              R, each filled in mint while that grip clutches the arm. The
 *              status line rides along for screen readers. Display only; it
 *              keeps the old card's ids (`operator-card`, `operator-status`,
 *              `operator-grip-left`, `operator-grip-right`).
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import type { OperatorState, PresenceViewer } from '../../types/datacollection.types';
import { viewerInitials } from '../../utils/presenceFormat';
import { LINK_CLASS, gripPercent, operatorLatency, operatorStatusLine } from '../OperatorCard';

export interface OperatorChipProps {
  /** The operator's fresh state, or null when none arrived for 2 s. */
  operator: OperatorState | null;
  /** The headset watching the session, from presence. */
  operatorViewer: PresenceViewer | null;
  className?: string;
}

function Grip({ side, value, clutched }: { side: 'L' | 'R'; value: number; clutched: boolean }) {
  const pct = gripPercent(value);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-tertiary"
      data-testid={`operator-grip-${side === 'L' ? 'left' : 'right'}`}
      data-value={pct}
      data-clutched={clutched ? 'true' : 'false'}
    >
      {side}
      <span
        className="relative h-[5px] w-11 overflow-hidden rounded-full bg-line max-sm:w-[26px]"
        role="meter"
        aria-label={`${side === 'L' ? 'Left' : 'Right'} grip`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span
          className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-150', clutched ? 'bg-signal-measured' : 'bg-ink-muted')}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

export function OperatorChip({ operator, operatorViewer, className }: OperatorChipProps) {
  if (!operator && !operatorViewer) return null;
  const name = operatorViewer?.displayName ?? 'Operator';
  const inVr = operator?.inVr === true;
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center gap-2.5 rounded-tag border border-line-subtle bg-canvas/80 pl-1 pr-2.5 text-[12px]',
        className,
      )}
      data-testid="operator-card"
      data-state={!operator ? 'connected' : inVr ? 'in-vr' : 'connected'}
      title={operator ? `${name}: ${operatorStatusLine(operator)}. A grip bar fills while that grip clutches the arm.` : `${name}: headset open, not in VR`}
    >
      <span
        aria-hidden
        className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-signal-measured/15 text-[10px] font-semibold text-signal-measured"
      >
        {viewerInitials(name)}
      </span>
      {operator && inVr ? (
        <>
          <span className={cn('tabular-nums', LINK_CLASS[operator.link])} data-testid="operator-status">
            <span className="sr-only">In VR · link {operator.link} · </span>
            {operatorLatency(operator)}
          </span>
          <Grip side="L" value={operator.grip.left} clutched={operator.clutch.left} />
          <Grip side="R" value={operator.grip.right} clutched={operator.clutch.right} />
        </>
      ) : (
        <span className="text-signal-unknown" data-testid="operator-status">Headset open, not in VR</span>
      )}
    </span>
  );
}
