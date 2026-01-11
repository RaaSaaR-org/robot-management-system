/**
 * @file ApprovalDetailPanel.tsx
 * @description Detail panel for viewing and reviewing approval requests
 * @feature approvals
 */

import { useMemo, useState } from 'react';
import {
  X,
  Clock,
  User,
  Bot,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  MessageSquare,
  Shield,
  Settings,
  Calendar,
  Timer,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { SLAIndicator } from './SLAIndicator';
import { useApprovals } from '../hooks';
import type { ApprovalRequest, ApprovalStep } from '../types';

interface ApprovalDetailPanelProps {
  approval: ApprovalRequest;
  onClose: () => void;
  className?: string;
}

const entityTypeIcons: Record<string, typeof FileText> = {
  performance_evaluation: User,
  shift_change: Clock,
  disciplinary_action: AlertTriangle,
  safety_parameter_modification: Shield,
  software_update: Settings,
};

function formatEntityType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatApproverRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function StepTimeline({ steps }: { steps?: ApprovalStep[] }) {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="space-y-3">
      {steps.map((step, index) => {
        const isCompleted = step.status === 'approved' || step.status === 'rejected';
        const isAwaiting = step.status === 'awaiting';
        const isPending = step.status === 'pending';
        const isSkipped = step.status === 'skipped';

        return (
          <div key={step.id} className="flex items-start gap-3">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                  isCompleted && step.decision === 'approve' &&
                    'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
                  isCompleted && step.decision === 'reject' &&
                    'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
                  isAwaiting &&
                    'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500',
                  isPending &&
                    'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
                  isSkipped &&
                    'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                )}
              >
                {isCompleted && step.decision === 'approve' && <CheckCircle className="w-4 h-4" />}
                {isCompleted && step.decision === 'reject' && <XCircle className="w-4 h-4" />}
                {isAwaiting && <Timer className="w-4 h-4" />}
                {isPending && index + 1}
                {isSkipped && '-'}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'w-0.5 h-8 mt-1',
                    isCompleted ? 'bg-green-300 dark:bg-green-700' : 'bg-gray-200 dark:bg-gray-700'
                  )}
                />
              )}
            </div>

            {/* Step content */}
            <div className="flex-1 pb-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-theme-primary">
                  {formatApproverRole(step.approverRole)}
                </span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    isCompleted && step.decision === 'approve' &&
                      'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                    isCompleted && step.decision === 'reject' &&
                      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
                    isAwaiting &&
                      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
                    isPending &&
                      'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
                    isSkipped &&
                      'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                  )}
                >
                  {isSkipped ? 'Skipped' : step.status.replace(/_/g, ' ')}
                </span>
              </div>
              {step.decidedBy && (
                <p className="text-sm text-theme-secondary mt-1">
                  Decided by: {step.decidedBy}
                </p>
              )}
              {step.decisionNotes && (
                <p className="text-sm text-theme-muted mt-1 italic">"{step.decisionNotes}"</p>
              )}
              {step.decidedAt && (
                <p className="text-xs text-theme-muted mt-1">
                  {new Date(step.decidedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ApprovalDetailPanel({ approval, onClose, className }: ApprovalDetailPanelProps) {
  const [decisionNotes, setDecisionNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { processApproval } = useApprovals();

  const EntityIcon = entityTypeIcons[approval.entityType] || FileText;

  const currentStep = useMemo(() => {
    return approval.steps?.find((s) => s.status === 'awaiting');
  }, [approval.steps]);

  const canTakeAction = approval.status === 'pending' || approval.status === 'in_progress';

  const handleApprove = async () => {
    if (!currentStep) return;
    setIsProcessing(true);
    try {
      await processApproval(approval.id, currentStep.id, {
        decision: 'approve',
        decidedBy: 'current-user', // TODO: Get from auth
        decisionNotes: decisionNotes || undefined,
        reviewDurationSec: 60, // TODO: Track actual review time
        competenceVerified: true,
      });
      onClose();
    } catch (error) {
      console.error('Failed to approve:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!currentStep || !decisionNotes.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }
    setIsProcessing(true);
    try {
      await processApproval(approval.id, currentStep.id, {
        decision: 'reject',
        decidedBy: 'current-user', // TODO: Get from auth
        decisionNotes,
        reviewDurationSec: 60,
        competenceVerified: true,
      });
      onClose();
    } catch (error) {
      console.error('Failed to reject:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className={cn(
        'bg-theme-surface border-l border-theme-subtle h-full flex flex-col',
        className
      )}
    >
      {/* Header */}
      <div className="p-4 border-b border-theme-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <EntityIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="font-semibold text-theme-primary">{approval.requestNumber}</h2>
            <p className="text-sm text-theme-secondary">{formatEntityType(approval.entityType)}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-theme-elevated rounded-lg transition-colors"
        >
          <X className="h-5 w-5 text-theme-muted" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* SLA Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-theme-secondary">SLA Status</span>
          <SLAIndicator
            slaDeadline={approval.slaDeadline}
            slaHours={approval.slaHours}
            status={approval.status}
          />
        </div>

        {/* Request Details */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-secondary">Request Details</h3>
          <div className="bg-theme-elevated rounded-lg p-4 space-y-3">
            <div>
              <span className="text-xs text-theme-muted">Reason</span>
              <p className="text-sm text-theme-primary mt-1">{approval.requestReason}</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-theme-muted" />
                <span className="text-theme-secondary">
                  Created: {new Date(approval.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
            {approval.affectedUserId && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-theme-muted" />
                <span className="text-theme-secondary">Worker affected</span>
              </div>
            )}
            {approval.affectedRobotId && (
              <div className="flex items-center gap-2 text-sm">
                <Bot className="h-4 w-4 text-theme-muted" />
                <span className="text-theme-secondary">Robot: {approval.affectedRobotId}</span>
              </div>
            )}
          </div>
        </div>

        {/* Entity Data */}
        {approval.entityData && Object.keys(approval.entityData).length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-theme-secondary">Entity Data</h3>
            <div className="bg-theme-elevated rounded-lg p-4">
              <pre className="text-xs text-theme-primary overflow-x-auto">
                {JSON.stringify(approval.entityData, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Approval Timeline */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-theme-secondary">Approval Progress</h3>
          <div className="bg-theme-elevated rounded-lg p-4">
            <StepTimeline steps={approval.steps} />
          </div>
        </div>

        {/* Worker Viewpoint */}
        {approval.workerViewpoint && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-theme-secondary flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Worker Viewpoint
            </h3>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-700">
              <p className="text-sm text-purple-900 dark:text-purple-200">
                {approval.workerViewpoint.statement}
              </p>
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
                Submitted: {new Date(approval.workerViewpoint.submittedAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Action Footer */}
      {canTakeAction && currentStep && (
        <div className="p-4 border-t border-theme-subtle space-y-4">
          <div>
            <label className="text-sm font-medium text-theme-secondary block mb-2">
              Decision Notes {currentStep && '(required for rejection)'}
            </label>
            <textarea
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder="Add notes about your decision..."
              className="w-full px-3 py-2 bg-theme-elevated text-theme-primary border border-theme-subtle rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleReject}
              disabled={isProcessing}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors',
                'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
                'hover:bg-red-200 dark:hover:bg-red-900/50',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <XCircle className="h-4 w-4" />
              Reject
            </button>
            <button
              onClick={handleApprove}
              disabled={isProcessing}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors',
                'bg-green-600 dark:bg-green-700 text-white',
                'hover:bg-green-700 dark:hover:bg-green-600',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <CheckCircle className="h-4 w-4" />
              Approve
            </button>
          </div>

          <p className="text-xs text-theme-muted text-center">
            Awaiting: {formatApproverRole(currentStep.approverRole)} approval
          </p>
        </div>
      )}

      {/* Completed status */}
      {!canTakeAction && (
        <div className="p-4 border-t border-theme-subtle">
          <div
            className={cn(
              'flex items-center justify-center gap-2 py-3 rounded-lg',
              approval.status === 'approved' && 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
              approval.status === 'rejected' && 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
              approval.status === 'cancelled' && 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
              approval.status === 'escalated' && 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
            )}
          >
            {approval.status === 'approved' && <CheckCircle className="h-5 w-5" />}
            {approval.status === 'rejected' && <XCircle className="h-5 w-5" />}
            {approval.status === 'escalated' && <AlertTriangle className="h-5 w-5" />}
            <span className="font-medium capitalize">{approval.status.replace(/_/g, ' ')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
