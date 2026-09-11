/**
 * @file AgentCard.tsx
 * @description Card of one registered A2A agent for the agents grid
 * @feature a2a
 */

import { Badge, Panel, RowActions, type RowActionItem } from '@/shared/components/ui';
import type { A2AAgentCard } from '../types';

interface AgentCardProps {
  agent: A2AAgentCard;
  onOpen: () => void;
  actions: RowActionItem[];
}

const MAX_SKILLS = 3;

/**
 * Interactive agent card: name, URL, description, version and the first skills.
 */
export function AgentCard({ agent, onOpen, actions }: AgentCardProps) {
  const skills = agent.skills ?? [];

  return (
    <Panel interactive onClick={onOpen} padding="sm" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-primary">{agent.name}</div>
          <code className="block truncate font-mono text-xs text-ink-tertiary" title={agent.url}>
            {agent.url}
          </code>
        </div>
        <RowActions items={actions} label={`Actions for ${agent.name}`} />
      </div>

      <p className="line-clamp-2 min-h-[2.5rem] text-[13px] text-ink-secondary">
        {agent.description || 'No description.'}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {agent.version && (
          <Badge variant="neutral" size="sm">
            v{agent.version}
          </Badge>
        )}
        {skills.slice(0, MAX_SKILLS).map((skill) => (
          <Badge key={skill.id} variant="default" size="sm" title={skill.description}>
            {skill.name}
          </Badge>
        ))}
        {skills.length > MAX_SKILLS && (
          <span className="text-xs text-ink-muted">+{skills.length - MAX_SKILLS}</span>
        )}
      </div>
    </Panel>
  );
}
