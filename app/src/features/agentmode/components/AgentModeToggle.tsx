/**
 * @file AgentModeToggle.tsx
 * @description Per-robot Agent Mode on/off switch
 * @feature agentmode
 */

import { memo, useMemo } from 'react';
import { cn } from '@/shared/utils';
import {
  useAgentModeStore,
  selectEnabled,
  selectControlOwner,
  selectEstopActive,
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

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        data-testid="agent-control-owner"
        className="glass-subtle px-2 py-0.5 rounded-full text-[10px] font-medium text-theme-tertiary whitespace-nowrap"
      >
        {OWNER_LABEL[controlOwner] ?? controlOwner}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Agent Mode"
        data-testid="agent-mode-toggle"
        data-enabled={enabled}
        disabled={!robotId || estopActive}
        onClick={() => robotId && void actions.toggle(robotId, !enabled)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200',
          'focus:outline-none focus:ring-2 focus:ring-cobalt-500/40',
          enabled ? 'bg-cobalt-500' : 'bg-gray-300 dark:bg-gray-700',
          (!robotId || estopActive) && 'opacity-40 cursor-not-allowed'
        )}
      >
        <span
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
            enabled ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </button>

      <span className="text-xs font-medium text-theme-secondary whitespace-nowrap">
        Agent Mode {enabled ? 'on' : 'off'}
      </span>
    </div>
  );
});
