/**
 * @file AgentCard.tsx
 * @description Agent card display component
 * @feature a2a
 */

import { memo } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Card } from '@/shared/components/ui/Card';
import type { A2AAgentCard } from '../types';

interface AgentCardProps {
  agent: A2AAgentCard;
  className?: string;
  onSelect?: () => void;
  onRemove?: () => void;
  isSelected?: boolean;
}

/**
 * Agent card component
 */
export const AgentCard = memo(function AgentCard({
  agent,
  className,
  onSelect,
  onRemove,
  isSelected,
}: AgentCardProps) {
  return (
    <Card
      variant="glass"
      interactive={!!onSelect}
      noPadding
      className={cn(
        'p-4 transition-all duration-300',
        isSelected && 'ring-2 ring-primary-500',
        onSelect && 'cursor-pointer',
        className
      )}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {agent.name}
          </h3>
          {agent.provider && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              by {agent.provider.organization}
            </p>
          )}
        </div>

        {/* Version badge */}
        {agent.version && (
          <span className="text-xs glass-subtle px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-400">
            v{agent.version}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2">
        {agent.description}
      </p>

      {/* Capabilities */}
      {agent.capabilities && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {agent.capabilities.streaming && (
            <span className="text-xs bg-primary-50/50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 px-2 py-0.5 rounded-full">
              Streaming
            </span>
          )}
          {agent.capabilities.pushNotifications && (
            <span className="text-xs bg-accent-50/50 dark:bg-accent-900/20 text-accent-600 dark:text-accent-400 px-2 py-0.5 rounded-full">
              Push
            </span>
          )}
          {agent.capabilities.stateTransitionHistory && (
            <span className="text-xs bg-purple-50/50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full">
              History
            </span>
          )}
        </div>
      )}

      {/* Skills */}
      {agent.skills && agent.skills.length > 0 && (
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">Skills</p>
          <div className="flex flex-wrap gap-1.5">
            {agent.skills.slice(0, 3).map((skill) => (
              <span
                key={skill.id}
                className="text-xs glass-subtle text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full"
                title={skill.description}
              >
                {skill.name}
              </span>
            ))}
            {agent.skills.length > 3 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                +{agent.skills.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* URL */}
      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate mb-3">
        {agent.url}
      </p>

      {/* Actions */}
      {onRemove && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Remove
          </Button>
        </div>
      )}
    </Card>
  );
});

/**
 * Compact agent list item
 */
export const AgentListItem = memo(function AgentListItem({
  agent,
  onSelect,
  isSelected,
}: {
  agent: A2AAgentCard;
  onSelect?: () => void;
  isSelected?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200',
        'hover:bg-gray-50/50 dark:hover:bg-gray-700/50',
        isSelected && 'glass-subtle ring-1 ring-primary-500/50'
      )}
      onClick={onSelect}
    >
      {/* Avatar/Icon */}
      <div
        className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium',
          isSelected
            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
            : 'glass-subtle text-gray-600 dark:text-gray-400'
        )}
      >
        {agent.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
          {agent.name}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
          {agent.description}
        </p>
      </div>

      {/* Status indicator */}
      <div className="w-2 h-2 rounded-full bg-accent-500" title="Online" />
    </div>
  );
});
