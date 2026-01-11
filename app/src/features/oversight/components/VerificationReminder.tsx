/**
 * @file VerificationReminder.tsx
 * @description Banner for due and overdue verifications
 * @feature oversight
 */

import { Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import type { DueVerification, VerificationStatus } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface VerificationReminderProps {
  dueVerifications: DueVerification[];
  onComplete: (scheduleId: string, status: VerificationStatus, notes?: string) => void;
  isCompleting?: boolean;
  className?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatOverdue(minutes: number): string {
  if (minutes < 60) return `${minutes}m overdue`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h overdue`;
  return `${Math.floor(minutes / 1440)}d overdue`;
}

// ============================================================================
// SUB-COMPONENT
// ============================================================================

interface VerificationItemProps {
  verification: DueVerification;
  onComplete: (status: VerificationStatus, notes?: string) => void;
  isCompleting?: boolean;
}

function VerificationItem({ verification, onComplete, isCompleting }: VerificationItemProps) {
  const isOverdue = verification.overdueSinceMinutes > 0;

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 p-3 rounded-lg',
        isOverdue
          ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {isOverdue ? (
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
        ) : (
          <Clock className="h-5 w-5 text-yellow-500 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-medium text-theme-primary truncate">
            {verification.schedule.name}
          </p>
          <p className="text-xs text-theme-muted">
            {isOverdue ? formatOverdue(verification.overdueSinceMinutes) : 'Due now'}
            {verification.schedule.description && ` - ${verification.schedule.description}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onComplete('deferred')}
          disabled={isCompleting}
        >
          Defer
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => onComplete('completed')}
          disabled={isCompleting}
        >
          <CheckCircle className="h-4 w-4 mr-1" />
          Complete
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function VerificationReminder({
  dueVerifications,
  onComplete,
  isCompleting,
  className,
}: VerificationReminderProps) {
  if (dueVerifications.length === 0) return null;

  const overdueCount = dueVerifications.filter((v) => v.overdueSinceMinutes > 0).length;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-theme-muted" />
          <h3 className="font-semibold text-theme-primary">
            Verification Required
          </h3>
          {overdueCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full">
              {overdueCount} overdue
            </span>
          )}
        </div>
        <span className="text-sm text-theme-muted">
          {dueVerifications.length} verification{dueVerifications.length !== 1 ? 's' : ''} due
        </span>
      </div>

      <div className="space-y-2">
        {dueVerifications.slice(0, 3).map((verification) => (
          <VerificationItem
            key={verification.schedule.id}
            verification={verification}
            onComplete={(status, notes) => onComplete(verification.schedule.id, status, notes)}
            isCompleting={isCompleting}
          />
        ))}
        {dueVerifications.length > 3 && (
          <p className="text-sm text-theme-muted text-center py-2">
            + {dueVerifications.length - 3} more verification{dueVerifications.length - 3 !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
