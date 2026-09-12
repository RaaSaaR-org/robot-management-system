/**
 * @file NotificationTimeline.tsx
 * @description Regulatory notifications of an incident, ordered by deadline:
 *              authority, regulation, deadline, status and the two acts
 * @feature incidents
 */

import { BellOff, FileText, Send } from 'lucide-react';
import { Button, EmptyState, StatusTag, statusTone } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils/format';
import type { IncidentNotification, NotificationStatus } from '../types/incidents.types';
import {
  AUTHORITY_LABELS,
  REGULATION_LABELS,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_STATUS_LABELS,
} from '../types/incidents.types';

export interface NotificationTimelineProps {
  /** Notification list */
  notifications: IncidentNotification[];
  /** Mark a notification as sent (the host confirms and toasts) */
  onMarkSent?: (notification: IncidentNotification) => void;
  /** Generate the notification text */
  onGenerateContent?: (notification: IncidentNotification) => void;
  /** Additional class names */
  className?: string;
}

const SHORT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

function deadlineNote(hoursRemaining?: number): string | null {
  if (hoursRemaining === undefined) return null;
  const h = Math.abs(Math.round(hoursRemaining));
  if (hoursRemaining < 0) return `${h} h overdue`;
  if (hoursRemaining < 48) return `${h} h left`;
  return `${Math.round(hoursRemaining / 24)} days left`;
}

function NotificationRow({ notification: n, onMarkSent, onGenerateContent }: {
  notification: IncidentNotification;
  onMarkSent?: NotificationTimelineProps['onMarkSent'];
  onGenerateContent?: NotificationTimelineProps['onGenerateContent'];
}) {
  const status: NotificationStatus = n.isOverdue && n.status !== 'sent' && n.status !== 'acknowledged' ? 'overdue' : n.status;
  const open = n.status === 'pending' || n.status === 'draft' || status === 'overdue';
  const note = open ? deadlineNote(n.hoursRemaining) : null;

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink-primary">{AUTHORITY_LABELS[n.authority]}</span>
          <StatusTag tone={statusTone(status)} dot>
            {NOTIFICATION_STATUS_LABELS[status]}
          </StatusTag>
        </div>
        <p className="text-[13px] text-ink-tertiary">
          {REGULATION_LABELS[n.regulation]} · {NOTIFICATION_TYPE_LABELS[n.notificationType]}
        </p>
        <p className="mt-1 text-[13px] tabular-nums text-ink-secondary">
          Due {formatDateTime(n.dueAt, SHORT)}
          {note && (
            <span className={status === 'overdue' ? 'text-signal-stopped' : 'text-ink-tertiary'}> · {note}</span>
          )}
        </p>
        {n.sentAt && (
          <p className="text-[13px] tabular-nums text-ink-tertiary">
            Sent {formatDateTime(n.sentAt, SHORT)}
            {n.sentBy && ` by ${n.sentBy}`}
          </p>
        )}
      </div>
      {open && (onGenerateContent || onMarkSent) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {onGenerateContent && (
            <Button variant="ghost" size="sm" leftIcon={<FileText className="h-4 w-4" strokeWidth={1.75} />} onClick={() => onGenerateContent(n)}>
              Generate text
            </Button>
          )}
          {onMarkSent && (
            <Button variant="secondary" size="sm" leftIcon={<Send className="h-4 w-4" strokeWidth={1.75} />} onClick={() => onMarkSent(n)}>
              Mark sent
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Notification list ordered by deadline.
 *
 * @example
 * <NotificationTimeline notifications={incident.notifications ?? []} onMarkSent={askMarkSent} />
 */
export function NotificationTimeline({ notifications, onMarkSent, onGenerateContent, className }: NotificationTimelineProps) {
  if (!notifications || notifications.length === 0) {
    return (
      <EmptyState
        className={className}
        size="sm"
        icon={<BellOff />}
        title="No notifications required"
        description="No regulation asks for a report on this incident so far."
      />
    );
  }

  const sorted = [...notifications].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  return (
    <ul className={className ? `divide-y divide-line-subtle ${className}` : 'divide-y divide-line-subtle'}>
      {sorted.map((n) => (
        <NotificationRow key={n.id} notification={n} onMarkSent={onMarkSent} onGenerateContent={onGenerateContent} />
      ))}
    </ul>
  );
}
