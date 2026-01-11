/**
 * @file ApprovalCard.tsx
 * @description Card component for displaying an approval request
 * @feature approvals
 */

import { useMemo } from 'react';
import {
  FileCheck,
  Clock,
  User,
  Bot,
  ChevronRight,
  AlertCircle,
  Users,
  Shield,
  Settings,
  Zap,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { SLAIndicator } from './SLAIndicator';
import type { ApprovalQueueItem, ApprovalEntityType, ApprovalStatus, ApprovalPriority } from '../types';

interface ApprovalCardProps {
  approval: ApprovalQueueItem;
  onClick?: () => void;
  className?: string;
}

const entityTypeIcons: Record<ApprovalEntityType, typeof FileCheck> = {
  performance_evaluation: User,
  shift_change: Clock,
  disciplinary_action: AlertCircle,
  safety_parameter_modification: Shield,
  software_update: Settings,
};

const statusColors: Record<ApprovalStatus, string> = {
  pending: 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700',
  in_progress: 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-700',
  approved: 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200 border-green-300 dark:border-green-700',
  rejected: 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700',
  escalated: 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-700',
  expired: 'bg-gray-100 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600',
  cancelled: 'bg-gray-100 dark:bg-gray-800/50 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-600',
};

const priorityColors: Record<ApprovalPriority, string> = {
  low: 'bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-300',
  normal: 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  high: 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
  critical: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  urgent: 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400',
};

function formatEntityType(type: ApprovalEntityType): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatApproverRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function ApprovalCard({ approval, onClick, className }: ApprovalCardProps) {
  const EntityIcon = entityTypeIcons[approval.entityType] || FileCheck;

  const currentStep = useMemo(() => {
    return approval.steps?.find((s) => s.status === 'awaiting');
  }, [approval.steps]);

  const completedSteps = useMemo(() => {
    return approval.steps?.filter((s) => s.status === 'approved').length || 0;
  }, [approval.steps]);

  const totalSteps = approval.steps?.length || 1;

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-theme-surface rounded-lg border border-theme-subtle p-4 cursor-pointer',
        'hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-sm transition-all',
        approval.urgencyLevel === 'critical' && 'border-l-4 border-l-red-500',
        approval.urgencyLevel === 'warning' && 'border-l-4 border-l-amber-500',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'p-2 rounded-lg',
              approval.urgencyLevel === 'critical'
                ? 'bg-red-100 dark:bg-red-900/20'
                : approval.urgencyLevel === 'warning'
                  ? 'bg-amber-100 dark:bg-amber-900/20'
                  : 'bg-blue-100 dark:bg-blue-900/20'
            )}
          >
            <EntityIcon
              className={cn(
                'h-5 w-5',
                approval.urgencyLevel === 'critical'
                  ? 'text-red-600 dark:text-red-400'
                  : approval.urgencyLevel === 'warning'
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-blue-600 dark:text-blue-400'
              )}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-theme-primary">{approval.requestNumber}</h3>
              <span className={cn('px-2 py-0.5 text-xs rounded-full', priorityColors[approval.priority])}>
                {approval.priority}
              </span>
            </div>
            <p className="text-sm text-theme-secondary">{formatEntityType(approval.entityType)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SLAIndicator
            slaDeadline={approval.slaDeadline}
            slaHours={approval.slaHours}
            status={approval.status}
          />
          <ChevronRight className="h-5 w-5 text-theme-muted" />
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 space-y-2">
        <p className="text-sm text-theme-secondary line-clamp-2">{approval.requestReason}</p>

        {/* Affected entities */}
        <div className="flex flex-wrap gap-3 text-sm text-theme-muted">
          {approval.affectedUserId && (
            <span className="flex items-center gap-1">
              <User className="h-4 w-4" />
              Worker affected
            </span>
          )}
          {approval.affectedRobotId && (
            <span className="flex items-center gap-1">
              <Bot className="h-4 w-4" />
              Robot affected
            </span>
          )}
        </div>

        {/* Progress for multi-step */}
        {approval.approvalType !== 'single_approval' && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-theme-muted mb-1">
              <span>
                Step {completedSteps + 1} of {totalSteps}
              </span>
              {currentStep && (
                <span className="text-blue-600 dark:text-blue-400">
                  Awaiting: {formatApproverRole(currentStep.approverRole)}
                </span>
              )}
            </div>
            <div className="h-1.5 bg-theme-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Single approval - show awaiting */}
        {approval.approvalType === 'single_approval' && currentStep && (
          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-theme-muted" />
            <span className="text-theme-secondary">
              Awaiting {formatApproverRole(currentStep.approverRole)} approval
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-theme-subtle flex items-center justify-between text-xs text-theme-muted">
        <span className={cn('px-2 py-1 rounded border', statusColors[approval.status])}>
          {approval.status.replace(/_/g, ' ')}
        </span>
        <span>
          Created {new Date(approval.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Worker viewpoint indicator */}
      {approval.workerViewpoint && (
        <div className="mt-2 flex items-center gap-2 text-sm bg-purple-50 dark:bg-purple-900/20 rounded p-2">
          <Zap className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <span className="text-purple-700 dark:text-purple-400">
            Worker viewpoint {approval.workerViewpoint.status}
          </span>
        </div>
      )}
    </div>
  );
}
