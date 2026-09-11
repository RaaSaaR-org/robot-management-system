/**
 * @file RejectApprovalModal.tsx
 * @description Form modal that rejects an approval request with a required reason
 * @feature approvals
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Textarea, errorMessage, toast } from '@/shared/components/ui';

export interface RejectApprovalModalProps {
  isOpen: boolean;
  requestNumber: string;
  onClose: () => void;
  /** Performs the rejection; throw to keep the modal open with the error. */
  onReject: (reason: string) => Promise<void>;
}

export function RejectApprovalModal({ isOpen, requestNumber, onClose, onReject }: RejectApprovalModalProps) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setReasonError(undefined);
    setFormError(undefined);
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!reason.trim()) {
      setReasonError('Give a reason. The requester sees it.');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await onReject(reason.trim());
      toast.success('Request rejected', { description: requestNumber });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Reject request"
      description={`${requestNumber} is closed and the blocked change does not happen.`}
      submitLabel="Reject request"
      submittingLabel="Rejecting…"
      submitVariant="danger"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField
        label="Reason"
        required
        hint="The requester sees this reason. It is stored in the audit trail."
        error={reasonError}
      >
        <Textarea
          rows={4}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (reasonError) setReasonError(undefined);
          }}
          placeholder="Why is this request rejected?"
        />
      </FormField>
    </FormModal>
  );
}
