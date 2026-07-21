/**
 * @file EventsPage.tsx
 * @description A2A Events viewer page for debugging and monitoring
 * @feature a2a
 */

import { memo, useEffect, useState } from 'react';
import { UI_DATE_LOCALE, cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Badge } from '@/shared/components/ui/Badge';
import { Spinner } from '@/shared/components/ui/Spinner';
import { PageHeader } from '@/shared/components/ui/PageHeader';
import { EventList } from '../components/EventList';
import { A2ALayout } from '../components/A2ALayout';
import { useA2AStore } from '../store';
import { isTextPart, isFilePart, isFileWithBytes } from '../types';
import type { A2AEvent, A2APart } from '../types';

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

/** Short label for a non-text message part, rendered as a chip */
function getPartChipLabel(part: A2APart): string {
  if (isFilePart(part)) {
    const name = part.file.name || (isFileWithBytes(part.file) ? 'embedded file' : part.file.uri);
    return `File: ${name} (${part.file.mimeType})`;
  }
  return `Data: ${Object.keys(part.kind === 'data' ? part.data : {}).join(', ') || 'structured payload'}`;
}

/** Renders message parts as readable text plus labeled chips for non-text parts */
function MessageContent({ parts }: { parts: A2APart[] }) {
  const textParts = parts.filter(isTextPart);
  const otherParts = parts.filter((p) => !isTextPart(p));

  return (
    <div className="space-y-2">
      {textParts.length > 0 && (
        <p className="text-sm text-theme-primary whitespace-pre-wrap break-words">
          {textParts.map((p) => p.text).join('\n')}
        </p>
      )}
      {otherParts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {otherParts.map((part, i) => (
            <span
              key={i}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium glass-subtle text-theme-secondary"
            >
              {getPartChipLabel(part)}
            </span>
          ))}
        </div>
      )}
      {textParts.length === 0 && otherParts.length === 0 && (
        <p className="text-sm text-theme-muted italic">No content</p>
      )}
    </div>
  );
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
          <h2 className="text-lg font-semibold text-theme-primary">
            Event Details
          </h2>
          <button
            onClick={onClose}
            aria-label="Close event details"
            className="p-2 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <XIcon className="w-5 h-5 text-theme-tertiary" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          <dl className="space-y-4">
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-theme-tertiary">Event ID</dt>
              <dd className="mt-1 font-mono text-sm text-theme-primary">{event.id}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-theme-tertiary">Timestamp</dt>
              <dd className="mt-1 text-sm text-theme-primary">
                {new Date(event.timestamp).toLocaleString(UI_DATE_LOCALE)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-theme-tertiary">Actor</dt>
              <dd className="mt-1 text-sm text-theme-primary">{event.actor}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-theme-tertiary">Role</dt>
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
              <dt className="text-xs uppercase tracking-wider font-medium text-theme-tertiary">Message ID</dt>
              <dd className="mt-1 font-mono text-sm text-theme-primary">
                {event.content.messageId}
              </dd>
            </div>
            {event.content.contextId && (
              <div>
                <dt className="text-xs uppercase tracking-wider font-medium text-theme-tertiary">Context ID</dt>
                <dd className="mt-1 font-mono text-sm text-theme-primary">
                  {event.content.contextId}
                </dd>
              </div>
            )}
            {event.content.taskId && (
              <div>
                <dt className="text-xs uppercase tracking-wider font-medium text-theme-tertiary">Task ID</dt>
                <dd className="mt-1 font-mono text-sm text-theme-primary">
                  {event.content.taskId}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wider font-medium text-theme-tertiary">Content</dt>
              <dd className="mt-1 p-3 glass-subtle rounded-lg">
                <MessageContent parts={event.content.parts} />
              </dd>
            </div>
            <div>
              <details className="group">
                <summary className="cursor-pointer text-xs uppercase tracking-wider font-medium text-theme-tertiary hover:text-theme-secondary transition-colors select-none">
                  Raw JSON
                </summary>
                <pre className="mt-2 p-3 glass-subtle rounded-lg text-xs overflow-x-auto font-mono text-theme-secondary">
                  {JSON.stringify(event.content.parts, null, 2)}
                </pre>
              </details>
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
        <div className="flex-shrink-0 px-4 md:px-6 py-4 border-b border-glass-subtle">
          <PageHeader
            title="Events"
            meta={
              <Badge variant="default" size="sm">
                {events.length}
              </Badge>
            }
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                aria-label="Refresh events"
                className="gap-1.5"
              >
                <RefreshIcon className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            }
          />
        </div>

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
