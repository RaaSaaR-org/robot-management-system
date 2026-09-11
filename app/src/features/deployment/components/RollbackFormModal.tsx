/**
 * @file RollbackFormModal.tsx
 * @description Danger FormModal that rolls a deployment back; the reason is required and audited
 * @feature deployment
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Textarea } from '@/shared/components/ui';
import type { Deployment } from '../types';
import { deploymentName, errorMessage } from './deploymentHelpers';

export interface RollbackFormModalProps {
  deployment: Deployment | null;
  onClose: () => void;
  /** Performs the rollback; throw to keep the modal open with the error. */
  onSubmit: (deployment: Deployment, reason: string) => Promise<void>;
}

export function RollbackFormModal({ deployment, onClose, onSubmit }: RollbackFormModalProps) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!deployment) return;
    setReason('');
    setReasonError(undefined);
    setFormError(undefined);
  }, [deployment]);

  const handleSubmit = async () => {
    if (!deployment) return;
    if (!reason.trim()) {
      setReasonError('Say why you roll back — it goes into the audit log.');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await onSubmit(deployment, reason.trim());
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const robots = deployment?.deployedRobotIds.length ?? 0;
  const name = deployment ? deploymentName(deployment) : '';

  return (
    <FormModal
      isOpen={deployment !== null}
      onClose={onClose}
      title={`Roll back ${name}?`}
      description={`${robots} ${robots === 1 ? 'robot returns' : 'robots return'} to the previous model version and the rollout stops.`}
      submitLabel="Roll back"
      submittingLabel="Rolling back…"
      submitVariant="danger"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Reason" required error={reasonError} hint="Logged for the audit trail.">
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Error rate above threshold in stage 2"
        />
      </FormField>
    </FormModal>
  );
}
