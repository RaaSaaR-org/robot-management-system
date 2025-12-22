/**
 * @file EventsPage.tsx
 * @description A2A Events viewer page for debugging and monitoring
 * @feature a2a
 */

import { memo, useEffect, useState } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Spinner } from '@/shared/components/ui/Spinner';
import { EventList } from '../components/EventList';
import { A2ALayout } from '../components/A2ALayout';
import { useA2AStore } from '../store';
import type { A2AEvent } from '../types';

// ============================================================================
// ICONS
// ============================================================================

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

// ============================================================================
// EVENT DETAIL MODAL
// ============================================================================

interface EventDetailProps {
  event: A2AEvent | null;
  onClose: () => void;
}

function EventDetail({ event, onClose }: EventDetailProps) {
  if (!event) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative glass-elevated rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-glass-subtle">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Event Details
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <XIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          <dl className="space-y-4">
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">Event ID</dt>
              <dd className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">{event.id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">Timestamp</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                {new Date(event.timestamp).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">Actor</dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100">{event.actor}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">Role</dt>
              <dd className="mt-1">
                <span className={cn(
                  'inline-flex px-2.5 py-1 rounded-full text-xs font-medium',
                  event.content.role === 'user'
                    ? 'bg-primary-100/50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                    : 'bg-accent-100/50 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400'
                )}>
                  {event.content.role}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">Message ID</dt>
              <dd className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                {event.content.messageId}
              </dd>
            </div>
            {event.content.contextId && (
              <div>
                <dt className="text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">Context ID</dt>
                <dd className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                  {event.content.contextId}
                </dd>
              </div>
            )}
            {event.content.taskId && (
              <div>
                <dt className="text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">Task ID</dt>
                <dd className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
                  {event.content.taskId}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">Content</dt>
              <dd className="mt-1">
                <pre className="p-3 glass-subtle rounded-lg text-xs overflow-x-auto text-gray-700 dark:text-gray-300">
                  {JSON.stringify(event.content.parts, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ============================================================================
// EVENTS PAGE
// ============================================================================

/**
 * A2A Events viewer page
 */
export const EventsPage = memo(function EventsPage() {
  const { events, isLoading, fetchEvents } = useA2AStore();
  const [selectedEvent, setSelectedEvent] = useState<A2AEvent | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch events on mount
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchEvents();
    setIsRefreshing(false);
  };

  return (
    <A2ALayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between h-14 px-4 md:px-6 border-b border-glass-subtle glass-elevated">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Events
            </h1>
            <Badge variant="default" size="sm">
              {events.length}
            </Badge>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-1.5"
          >
            <RefreshIcon className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoading && events.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Spinner size="lg" />
            </div>
          ) : (
            <EventList
              events={events}
              onEventClick={setSelectedEvent}
              className="min-h-full"
            />
          )}
        </div>

        {/* Event detail modal */}
        {selectedEvent && (
          <EventDetail
            event={selectedEvent}
            onClose={() => setSelectedEvent(null)}
          />
        )}
      </div>
    </A2ALayout>
  );
});
