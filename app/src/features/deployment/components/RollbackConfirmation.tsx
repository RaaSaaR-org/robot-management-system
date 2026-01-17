/**
 * @file RollbackConfirmation.tsx
 * @description Modal for confirming deployment rollback
 * @feature deployment
 */

import { useState } from 'react';
import { Modal, Button, Input } from '@/shared/components/ui';
import type { Deployment } from '../types';

export interface RollbackConfirmationProps {
  deployment: Deployment;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  isLoading?: boolean;
}

export function RollbackConfirmation({
  deployment,
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
}: RollbackConfirmationProps) {
  const [reason, setReason] = useState('');

  const handleConfirm = async () => {
    if (!reason.trim()) return;
    await onConfirm(reason);
    setReason('');
    onClose();
  };

  const handleClose = () => {
    setReason('');
    onClose();
  };

  const affectedRobots = deployment.deployedRobotIds.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Rollback Deployment"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            isLoading={isLoading}
            disabled={!reason.trim()}
          >
            Rollback
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Warning */}
        <div className="flex gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <svg
            className="w-6 h-6 text-red-500 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="font-medium text-red-600 dark:text-red-400">
              This action will revert all robots to the previous model version.
            </p>
            <p className="text-sm text-red-500 dark:text-red-400/80 mt-1">
              {affectedRobots} robot(s) will be affected.
            </p>
          </div>
        </div>

        {/* Deployment info */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-theme-secondary">Current Model</span>
            <span className="text-theme-primary font-medium">
              {deployment.modelVersion?.skill?.name} v{deployment.modelVersion?.version}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-theme-secondary">Strategy</span>
            <span className="text-theme-primary font-medium capitalize">
              {deployment.strategy}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-theme-secondary">Current Traffic</span>
            <span className="text-theme-primary font-medium">
              {deployment.trafficPercentage}%
            </span>
          </div>
        </div>

        {/* Reason input */}
        <div>
          <label
            htmlFor="rollback-reason"
            className="block text-sm font-medium text-theme-primary mb-1"
          >
            Reason for rollback <span className="text-red-500">*</span>
          </label>
          <Input
            id="rollback-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., High error rate detected, performance degradation..."
            disabled={isLoading}
          />
          <p className="text-xs text-theme-secondary mt-1">
            This will be logged for audit purposes.
          </p>
        </div>
      </div>
    </Modal>
  );
}
