/**
 * @file EventList.tsx
 * @description DataTable of A2A events, newest first
 * @feature a2a
 */

import type { ReactNode } from 'react';
import { DataTable, StatusTag, type DataTableColumn } from '@/shared/components/ui';
import { UI_DATE_LOCALE, formatTimeAgo } from '@/shared/utils';
import type { A2AEvent } from '../types';
import { getMessageText } from '../types';

interface EventListProps {
  events: A2AEvent[];
  onEventClick?: (event: A2AEvent) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: ReactNode;
}

/** One-line summary of an event's content. */
export function eventSummary(event: A2AEvent): string {
  const text = getMessageText(event.content).replace(/\s+/g, ' ').trim();
  if (text) return text;
  const first = event.content.parts[0];
  return first ? `${first.kind} content` : 'No content';
}

const columns: DataTableColumn<A2AEvent>[] = [
  {
    key: 'timestamp',
    header: 'Time',
    sortable: true,
    sortValue: (e) => e.timestamp,
    width: '120px',
    cell: (e) => (
      <span className="whitespace-nowrap text-ink-tertiary" title={new Date(e.timestamp).toLocaleString(UI_DATE_LOCALE)}>
        {formatTimeAgo(new Date(e.timestamp).toISOString())}
      </span>
    ),
  },
  {
    key: 'role',
    header: 'Type',
    sortable: true,
    sortValue: (e) => e.content.role,
    width: '110px',
    cell: (e) => (
      <StatusTag tone={e.content.role === 'user' ? 'neutral' : 'info'}>
        {e.content.role === 'user' ? 'User' : 'Agent'}
      </StatusTag>
    ),
  },
  {
    key: 'actor',
    header: 'Actor',
    sortable: true,
    hideBelow: 'sm',
    cell: (e) => <span className="whitespace-nowrap">{e.actor}</span>,
  },
  {
    key: 'summary',
    header: 'Summary',
    cell: (e) => (
      <span className="block max-w-[28rem] truncate text-ink-secondary" title={eventSummary(e)}>
        {eventSummary(e)}
      </span>
    ),
  },
];

/**
 * Dense event table; row click opens the event.
 */
export function EventList({ events, onEventClick, isLoading, error, onRetry, empty }: EventListProps) {
  return (
    <DataTable
      caption="Agent events"
      dense
      columns={columns}
      rows={events}
      getRowId={(e) => e.id}
      defaultSort={{ key: 'timestamp', direction: 'desc' }}
      onRowClick={onEventClick}
      isLoading={isLoading}
      error={error}
      errorTitle="Couldn't load events"
      onRetry={onRetry}
      empty={empty}
    />
  );
}
