/**
 * @file AgentList.tsx
 * @description List of registered agents
 * @feature a2a
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { AgentCard, AgentListItem } from './AgentCard';
import type { A2AAgentCard } from '../types';

interface AgentListProps {
  agents: A2AAgentCard[];
  selectedAgent?: A2AAgentCard;
  onSelect?: (agent: A2AAgentCard) => void;
  onRemove?: (agent: A2AAgentCard) => void;
  onRegister?: () => void;
  className?: string;
  variant?: 'grid' | 'list';
}

/**
 * Agent list component
 */
export const AgentList = memo(function AgentList({
  agents,
  selectedAgent,
  onSelect,
  onRemove,
  onRegister,
  className,
  variant = 'list',
}: AgentListProps) {
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
          Registered Agents
        </h3>
        {onRegister && (
          <Button size="sm" onClick={onRegister}>
            Register
          </Button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {agents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
            <div className="text-center">
              <p className="mb-2">No agents registered</p>
              {onRegister && (
                <Button variant="ghost" onClick={onRegister}>
                  Register an agent
                </Button>
              )}
            </div>
          </div>
        ) : variant === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                onSelect={onSelect ? () => onSelect(agent) : undefined}
                onRemove={onRemove ? () => onRemove(agent) : undefined}
                isSelected={selectedAgent?.name === agent.name}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {agents.map((agent) => (
              <AgentListItem
                key={agent.name}
                agent={agent}
                onSelect={onSelect ? () => onSelect(agent) : undefined}
                isSelected={selectedAgent?.name === agent.name}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
