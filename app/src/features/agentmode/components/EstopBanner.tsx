/**
 * @file EstopBanner.tsx
 * @description The E-Stop banner — tells the operator whether the stop was only
 *              requested, actually acknowledged by the robot, or failed, plus
 *              whether the base is still damped and therefore cannot locomote.
 * @feature agentmode
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';
import {
  useAgentModeStore,
  selectDamped,
  selectEstopActive,
  selectEstopStatus,
  selectEstopError,
  selectFsmId,
} from '../store/agentmodeStore';
import type { AgentEstopStatus } from '../types/agentmode.types';

export interface EstopBannerProps {
  /** Clear the latch. Wired to the store's `resetEstop` by the page. */
  onReset: () => void;
  className?: string;
}

interface BannerCopy {
  title: string;
  detail: string;
  /** Ring/dot colour classes — amber while unverified, red once it is real. */
  accent: string;
  dot: string;
  border: string;
}

/**
 * Manual E-Stop is the only safety mechanism in v1, so the banner must never
 * state more than is known. "Stopped and damped" is a claim about the robot and
 * is only allowed once the agent acknowledged the stop.
 */
function copyFor(status: AgentEstopStatus, error: string | null): BannerCopy {
  switch (status) {
    case 'requesting':
      return {
        title: 'E-Stop requested',
        detail:
          'Sent to the robot — not confirmed yet. Do not assume it has stopped. ' +
          'Commands from this console are already refused.',
        accent: 'text-amber-600 dark:text-amber-400',
        dot: 'bg-amber-500',
        border: 'border-amber-500/50',
      };
    case 'failed':
      return {
        title: 'E-Stop NOT confirmed',
        detail: error
          ? `The stop request never reached the robot: ${error} — it may still be moving. ` +
            'Use the hardware E-Stop. This console keeps refusing commands.'
          : 'The stop request never reached the robot — it may still be moving. ' +
            'Use the hardware E-Stop. This console keeps refusing commands.',
        accent: 'text-red-600 dark:text-red-400',
        dot: 'bg-red-500',
        border: 'border-red-500',
      };
    case 'unconfirmed':
      return {
        title: 'E-Stop NOT confirmed by the robot',
        detail: error
          ? `The stop latched in software, but the robot did not confirm it: ${error} — ` +
            'it may still be moving. Use the hardware E-Stop. This console keeps refusing commands.'
          : 'The stop latched in software, but the robot did not confirm StopMove/Damp — ' +
            'it may still be moving. Use the hardware E-Stop. This console keeps refusing commands.',
        accent: 'text-red-600 dark:text-red-400',
        dot: 'bg-red-500',
        border: 'border-red-500',
      };
    // `idle` is unreachable while the latch is set (every path that sets it also
    // sets a status), but a latch reported by the agent is an acknowledged one.
    case 'idle':
    case 'acknowledged':
    default:
      return {
        title: 'E-Stop latched',
        detail:
          'The robot confirmed the stop: it is stopped and damped. ' +
          'Commands are refused until the latch is cleared.',
        accent: 'text-red-600 dark:text-red-400',
        dot: 'bg-red-500',
        border: 'border-red-500/40',
      };
  }
}

/**
 * What the operator needs after an E-Stop: the base is damped and every
 * locomotion block will be accepted and quietly do nothing until it stands up
 * again. Deliberately *not* a button — re-arming the robot is a human action
 * sent as a command, never something this page does on its own.
 */
function DampedNotice({ fsmId }: { fsmId: number | null }) {
  return (
    <div
      data-testid="agent-damped-banner"
      data-fsm-id={fsmId ?? ''}
      role="status"
      className="glass-card border-amber-500/50 bg-amber-500/5 px-4 py-3 flex flex-wrap items-center gap-3"
    >
      <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
      <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
        Base damped — the robot cannot move
      </span>
      <span data-testid="agent-damped-detail" className="card-meta">
        {fsmId === null
          ? 'The base sits in a non-locomoting FSM. '
          : `The base sits in a non-locomoting FSM (FSM ${fsmId}). `}
        Walk, turn and go-to blocks are still accepted and simply do nothing.
        Send a <span className="text-theme-secondary">posture</span> block with pose{' '}
        <span className="text-theme-secondary">stand</span> to bring it back up — clearing
        the E-Stop latch does not re-arm the base.
      </span>
    </div>
  );
}

/**
 * Rendered while the local latch is set or the base is damped. The E-Stop
 * states are visually distinct on purpose — an unverified stop must not look
 * like a finished one — and the damped notice outlives the latch, because
 * resetting the latch is not what makes the robot able to walk again.
 */
export const EstopBanner = memo(function EstopBanner({ onReset, className }: EstopBannerProps) {
  const estopActive = useAgentModeStore(selectEstopActive);
  const status = useAgentModeStore(selectEstopStatus);
  const error = useAgentModeStore(selectEstopError);
  const damped = useAgentModeStore(selectDamped);
  const fsmId = useAgentModeStore(selectFsmId);

  if (!estopActive) return damped ? <DampedNotice fsmId={fsmId} /> : null;

  const copy = copyFor(status, error);
  const unverified =
    status === 'requesting' || status === 'unconfirmed' || status === 'failed';
  // A stop that is not confirmed on the hardware is an alarm, not a status.
  const alarm = status === 'failed' || status === 'unconfirmed';

  return (
    <div className={cn('space-y-3', className)}>
      <div
        data-testid="agent-estop-banner"
        data-estop-status={status}
        role={alarm ? 'alert' : 'status'}
        className={cn(
          'glass-card px-4 py-3 flex flex-wrap items-center gap-3',
          copy.border,
          alarm && 'bg-red-500/10'
        )}
      >
        <span
          className={cn(
            'inline-block w-2 h-2 rounded-full',
            copy.dot,
            status !== 'acknowledged' && 'animate-pulse'
          )}
        />
        <span
          data-testid="agent-estop-title"
          className={cn('text-sm font-semibold', copy.accent, alarm && 'uppercase')}
        >
          {copy.title}
        </span>
        <span
          data-testid="agent-estop-detail"
          className={cn('card-meta', unverified && copy.accent)}
        >
          {copy.detail}
        </span>
        <button
          type="button"
          data-testid="agent-estop-reset"
          onClick={onReset}
          className="ml-auto btn-secondary !px-3 !py-1.5 !text-xs"
        >
          Reset E-Stop
        </button>
      </div>

      {/* Survives the reset above: the latch and the base's arming are two
          different things, and only the operator can re-arm the base. */}
      {damped && <DampedNotice fsmId={fsmId} />}
    </div>
  );
});
