/**
 * @file AgentModeToggle.tsx
 * @description Per-robot Agent Mode on/off switch — with an explicit third
 *              rendering for "the robot could not be asked", because a switch
 *              has no honest position for a state nobody knows.
 * @feature agentmode
 */

import { memo, useMemo } from 'react';
import { cn } from '@/shared/utils';
import {
  useAgentModeStore,
  selectEnabled,
  selectControlOwner,
  selectEstopActive,
  selectStateUnknown,
} from '../store/agentmodeStore';

export interface AgentModeToggleProps {
  robotId: string | null;
  className?: string;
}

/** Owner of the robot's motion, shown next to the switch. */
const OWNER_LABEL: Record<string, string> = {
  idle: 'Idle',
  teleop: 'Teleop',
  vla: 'VLA',
  agent: 'Agent',
};

/**
 * Turns Agent Mode on/off for one robot. With the mode off the robot-agent's
 * behaviour is byte-identical to the plain A2A path.
 *
 * When the robot cannot be reached the switch is DISABLED rather than
 * try-and-report, which is the opposite of the choice made for STOPP. Two
 * reasons, both about honesty rather than caution:
 *
 * 1. A switch's rendered position *is* a claim — "Agent Mode is off" — and
 *    there is no position that means "unknown". The control is replaced by a
 *    dead, visibly indeterminate one instead, and `aria-checked` is dropped so
 *    a screen reader is not told `false` either.
 * 2. Clicking it flips `enabled` optimistically. That is exactly the false
 *    display this whole change removes, re-introduced by the operator's own
 *    hand — and the write cannot land anyway while the server cannot reach the
 *    robot.
 *
 * STOPP stays live for the mirror-image reason: refusing to even *try* to stop
 * a robot is never the safe default, and the store already reports honestly
 * when a stop does not land.
 */
export const AgentModeToggle = memo(function AgentModeToggle({
  robotId,
  className,
}: AgentModeToggleProps) {
  const actions = useMemo(() => {
    const store = useAgentModeStore.getState();
    return { toggle: store.toggle };
  }, []);

  const enabled = useAgentModeStore(selectEnabled);
  const controlOwner = useAgentModeStore(selectControlOwner);
  const estopActive = useAgentModeStore(selectEstopActive);
  const stateUnknown = useAgentModeStore(selectStateUnknown);

  // The latch is only a reason to lock the switch when we know there is one.
  const disabled = !robotId || stateUnknown || estopActive;

  // Who owns the robot's motion is only news when it is NOT this page. `idle`
  // is the resting value, and a pill that is present on every calm page is a
  // pill people stop reading — which is precisely how `teleop` and `vla`, the
  // two values that mean someone else can move this robot right now, would get
  // missed. So the pill appears only when there is something to say.
  const showOwner = stateUnknown || controlOwner !== 'idle';

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {showOwner && (
        <span
          data-testid="agent-control-owner"
          className={cn(
            'glass-subtle px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap',
            stateUnknown ? 'text-amber-600 dark:text-amber-400' : 'text-theme-tertiary'
          )}
        >
          {stateUnknown ? 'Unknown' : (OWNER_LABEL[controlOwner] ?? controlOwner)}
        </span>
      )}

      <button
        type="button"
        // No `role="switch"` while the state is unknown: ARIA switches are
        // two-state, so any `aria-checked` here would announce a position this
        // console does not know. A plain disabled button announces nothing.
        role={stateUnknown ? undefined : 'switch'}
        aria-checked={stateUnknown ? undefined : enabled}
        aria-label={
          stateUnknown
            ? 'Agent Mode — state unknown, the robot could not be reached'
            : 'Agent Mode'
        }
        title={
          stateUnknown
            ? 'The robot could not be reached, so its Agent Mode state is unknown. ' +
              'Switching it is disabled until it answers again.'
            : undefined
        }
        data-testid="agent-mode-toggle"
        data-enabled={stateUnknown ? 'unknown' : enabled}
        data-state-unknown={stateUnknown}
        disabled={disabled}
        onClick={() => robotId && void actions.toggle(robotId, !enabled)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
          'focus:outline-none focus:ring-2 focus:ring-cobalt-500/40',
          stateUnknown
            ? 'bg-amber-500/15 border border-dashed border-amber-500/60'
            : enabled
              ? 'bg-cobalt-500'
              : 'bg-gray-300 dark:bg-gray-700',
          disabled && 'opacity-60 cursor-not-allowed'
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full shadow transition-transform duration-200',
            // Parked mid-track and amber: neither end of the switch, which is
            // the point — it reads as "no answer", not as "off".
            stateUnknown
              ? 'bg-amber-500 translate-x-3'
              : cn('bg-white', enabled ? 'translate-x-6' : 'translate-x-1')
          )}
        />
      </button>

      {/* The switch's position already states on/off, one pixel to the left, on a
          page whose h1 is "Agent Mode" — so sighted users are told three times.
          The text stays in the DOM for screen readers (the switch carries
          aria-checked, but the word is what tests and non-visual users read) and
          only becomes VISIBLE for `unknown`, which is the one value a switch
          cannot render a position for and which nobody should have to infer from
          a dashed track. */}
      <span
        data-testid="agent-mode-label"
        className={cn(
          'text-xs font-medium whitespace-nowrap',
          stateUnknown ? 'text-amber-600 dark:text-amber-400' : 'sr-only'
        )}
      >
        Agent Mode {stateUnknown ? 'unknown' : enabled ? 'on' : 'off'}
      </span>
    </div>
  );
});
