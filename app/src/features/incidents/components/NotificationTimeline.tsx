/**
 * @file NotificationTimeline.tsx
 * @description Timeline component displaying notification deadlines
 * @feature incidents
 * @dependencies @/shared/utils/cn, @/features/incidents/types
 */

import { cn } from '@/shared/utils/cn';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import type { IncidentNotification, NotificationStatus } from '../types/incidents.types';
import {
  AUTHORITY_LABELS,
  REGULATION_LABELS,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_STATUS_LABELS,
} from '../types/incidents.types';

// ============================================================================
// TYPES
// ============================================================================

export interface NotificationTimelineProps {
  /** Notification list */
  notifications: IncidentNotification[];
  /** Handler for marking notification as sent */
  onMarkSent?: (notificationId: string) => void;
  /** Handler for generating content */
  onGenerateContent?: (notificationId: string) => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// MAPPINGS
// ============================================================================

const STATUS_COLORS: Record<NotificationStatus, string> = {
  pending: 'bg-gray-400',
  draft: 'bg-yellow-400',
  sent: 'bg-green-500',
  acknowledged: 'bg-green-600',
  overdue: 'bg-red-500',
};

const STATUS_BADGE_VARIANT: Record<NotificationStatus, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  pending: 'default',
  draft: 'warning',
  sent: 'success',
  acknowledged: 'success',
  overdue: 'error',
};

// ============================================================================
// HELPERS
// ============================================================================

function formatDeadline(dueAt: string, hoursRemaining?: number): string {
  const date = new Date(dueAt);
  const formatted = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (hoursRemaining !== undefined) {
    if (hoursRemaining < 0) {
      const hoursOverdue = Math.abs(Math.round(hoursRemaining));
      return `${formatted} (${hoursOverdue}h overdue)`;
    } else if (hoursRemaining < 24) {
      return `${formatted} (${Math.round(hoursRemaining)}h remaining)`;
    }
  }

  return formatted;
}

function formatSentAt(sentAt: string | null): string {
  if (!sentAt) return '';
  const date = new Date(sentAt);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface NotificationItemProps {
  notification: IncidentNotification;
  isLast: boolean;
  onMarkSent?: (notificationId: string) => void;
  onGenerateContent?: (notificationId: string) => void;
}

function NotificationItem({ notification, isLast, onMarkSent, onGenerateContent }: NotificationItemProps) {
  const canMarkSent = notification.status === 'pending' || notification.status === 'draft';
  const isOverdue = notification.isOverdue || notification.status === 'overdue';
  const isSent = notification.status === 'sent' || notification.status === 'acknowledged';

  return (
    <div className="relative flex gap-4">
      {/* Timeline line */}
      {!isLast && (
        <div
          className={cn(
            'absolute left-[11px] top-6 w-0.5 h-full',
            isSent ? 'bg-green-500' : 'bg-theme-base'
          )}
        />
      )}

      {/* Timeline dot */}
      <div
        className={cn(
          'relative z-10 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
          STATUS_COLORS[isOverdue ? 'overdue' : notification.status]
        )}
      >
        {isSent ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : isOverdue ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6">
        <div
          className={cn(
            'p-4 rounded-lg',
            isOverdue ? 'bg-red-500/10 border border-red-500/30' :
            isSent ? 'bg-green-500/10 border border-green-500/30' :
            'bg-theme-elevated border border-theme-base'
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <h4 className="font-medium text-theme-primary text-sm">
                {AUTHORITY_LABELS[notification.authority]}
              </h4>
              <p className="text-xs text-theme-tertiary">
                {REGULATION_LABELS[notification.regulation]} - {NOTIFICATION_TYPE_LABELS[notification.notificationType]}
              </p>
            </div>
            <Badge variant={STATUS_BADGE_VARIANT[isOverdue ? 'overdue' : notification.status]} size="sm">
              {NOTIFICATION_STATUS_LABELS[isOverdue ? 'overdue' : notification.status]}
            </Badge>
          </div>

          {/* Deadline */}
          <div className="text-sm mb-3">
            <span className="text-theme-secondary">Deadline: </span>
            <span className={cn(
              'font-medium',
              isOverdue ? 'text-red-500' : 'text-theme-primary'
            )}>
              {formatDeadline(notification.dueAt, notification.hoursRemaining)}
            </span>
          </div>

          {/* Sent timestamp */}
          {notification.sentAt && (
            <div className="text-xs text-theme-tertiary mb-3">
              Sent: {formatSentAt(notification.sentAt)}
              {notification.sentBy && ` by ${notification.sentBy}`}
            </div>
          )}

          {/* Actions */}
          {canMarkSent && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-theme-base">
              {onGenerateContent && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onGenerateContent(notification.id)}
                >
                  Generate Content
                </Button>
              )}
              {onMarkSent && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onMarkSent(notification.id)}
                >
                  Mark as Sent
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-theme-tertiary mb-3"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      <p className="text-sm text-theme-secondary">No notifications</p>
      <p className="text-xs text-theme-tertiary mt-1">
        Notification workflow not yet created for this incident
      </p>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Timeline component displaying notification deadlines and status.
 *
 * @example
 * ```tsx
 * <NotificationTimeline
 *   notifications={incident.notifications}
 *   onMarkSent={(id) => markNotificationSent(incidentId, id)}
 *   onGenerateContent={(id) => generateContent(incidentId, id)}
 * />
 * ```
 */
export function NotificationTimeline({
  notifications,
  onMarkSent,
  onGenerateContent,
  className,
}: NotificationTimelineProps) {
  if (!notifications || notifications.length === 0) {
    return (
      <div className={className}>
        <EmptyState />
      </div>
    );
  }

  // Sort notifications by deadline
  const sortedNotifications = [...notifications].sort(
    (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
  );

  return (
    <div className={cn('relative', className)}>
      {sortedNotifications.map((notification, index) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          isLast={index === sortedNotifications.length - 1}
          onMarkSent={onMarkSent}
          onGenerateContent={onGenerateContent}
        />
      ))}
    </div>
  );
}
