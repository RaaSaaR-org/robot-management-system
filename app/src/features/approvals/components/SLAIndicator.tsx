/**
 * @file SLAIndicator.tsx
 * @description SLA deadline indicator with countdown/overdue display
 * @feature approvals
 */

import { useMemo } from 'react';
import { Clock, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface SLAIndicatorProps {
  slaDeadline: string;
  slaHours: number;
  status: string;
  className?: string;
  showLabel?: boolean;
}

export function SLAIndicator({
  slaDeadline,
  slaHours,
  status,
  className,
  showLabel = true,
}: SLAIndicatorProps) {
  const { urgencyLevel, displayText } = useMemo(() => {
    const deadline = new Date(slaDeadline);
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();
    const hours = diffMs / (1000 * 60 * 60);
    const isOverdue = hours < 0;

    let urgencyLevel: 'normal' | 'warning' | 'critical' | 'completed' = 'normal';
    if (status === 'approved' || status === 'rejected' || status === 'cancelled') {
      urgencyLevel = 'completed';
    } else if (isOverdue) {
      urgencyLevel = 'critical';
    } else if (hours < 2) {
      urgencyLevel = 'critical';
    } else if (hours < slaHours * 0.25) {
      urgencyLevel = 'warning';
    }

    // Format display text
    let displayText = '';
    if (urgencyLevel === 'completed') {
      displayText = 'Completed';
    } else if (isOverdue) {
      const overdueHours = Math.abs(hours);
      if (overdueHours < 1) {
        displayText = `${Math.round(overdueHours * 60)}m overdue`;
      } else if (overdueHours < 24) {
        displayText = `${Math.round(overdueHours)}h overdue`;
      } else {
        displayText = `${Math.round(overdueHours / 24)}d overdue`;
      }
    } else {
      if (hours < 1) {
        displayText = `${Math.round(hours * 60)}m remaining`;
      } else if (hours < 24) {
        displayText = `${Math.round(hours)}h remaining`;
      } else {
        displayText = `${Math.round(hours / 24)}d remaining`;
      }
    }

    return {
      hoursRemaining: hours,
      isOverdue,
      urgencyLevel,
      displayText,
    };
  }, [slaDeadline, slaHours, status]);

  const Icon = useMemo(() => {
    switch (urgencyLevel) {
      case 'completed':
        return CheckCircle;
      case 'critical':
        return AlertCircle;
      case 'warning':
        return AlertTriangle;
      default:
        return Clock;
    }
  }, [urgencyLevel]);

  const colorClasses = useMemo(() => {
    switch (urgencyLevel) {
      case 'completed':
        return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700';
      case 'critical':
        return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700';
      case 'warning':
        return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700';
      default:
        return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700';
    }
  }, [urgencyLevel]);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border',
        colorClasses,
        className
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {showLabel && <span className="text-sm font-medium">{displayText}</span>}
    </div>
  );
}
