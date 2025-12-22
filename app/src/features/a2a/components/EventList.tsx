/**
 * @file EventList.tsx
 * @description Table display of A2A events for debugging and monitoring
 * @feature a2a
 */

import { memo, useMemo } from 'react';
import { cn } from '@/shared/utils';
import type { A2AEvent } from '../types';
import { getMessageText } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface EventListProps {
  events: A2AEvent[];
  className?: string;
  onEventClick?: (event: A2AEvent) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Table display of A2A events
 */
export const EventList = memo(function EventList({
  events,
  className,
  onEventClick,
}: EventListProps) {
  // Sort events by timestamp (newest first)
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => b.timestamp - a.timestamp),
    [events]
  );

  if (events.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-20', className)}>
        <div className="glass-subtle w-16 h-16 rounded-full flex items-center justify-center mb-4">
          <EventIcon className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">No events recorded</p>
        <p className="text-gray-500 dark:text-gray-500 text-xs mt-1">Events will appear when agents communicate</p>
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto p-4', className)}>
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-glass-subtle text-left">
              <th className="px-4 py-3 text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                Time
              </th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                Conversation
              </th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                Actor
              </th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                Role
              </th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                ID
              </th>
              <th className="px-4 py-3 text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">
                Content
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-glass-subtle">
            {sortedEvents.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                onClick={onEventClick}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface EventRowProps {
  event: A2AEvent;
  onClick?: (event: A2AEvent) => void;
}

function EventRow({ event, onClick }: EventRowProps) {
  const { id, actor, content, timestamp } = event;
  const messageText = getMessageText(content);
  const truncatedContent = messageText.length > 100
    ? messageText.slice(0, 100) + '...'
    : messageText;

  const formattedTime = new Date(timestamp).toLocaleString();

  return (
    <tr
      className={cn(
        'hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors duration-150',
        onClick && 'cursor-pointer'
      )}
      onClick={() => onClick?.(event)}
    >
      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
        {formattedTime}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono text-xs glass-subtle px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">
          {content.contextId ? content.contextId.slice(0, 8) : '-'}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-gray-100">
        {actor}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={cn(
          'px-2.5 py-1 rounded-full text-xs font-medium',
          content.role === 'user'
            ? 'bg-primary-100/50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
            : 'bg-accent-100/50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400'
        )}>
          {content.role}
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono text-xs glass-subtle px-2 py-0.5 rounded text-gray-600 dark:text-gray-300">
          {id.slice(0, 8)}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
        {truncatedContent || (
          <span className="text-gray-400 italic">
            {content.parts.length > 0 ? `[${content.parts[0].kind} content]` : 'No content'}
          </span>
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// ICONS
// ============================================================================

function EventIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
