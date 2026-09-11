/**
 * @file ManualModeFormModal.tsx
 * @description Form modal that puts one robot under manual control (reason + speed mode)
 * @feature oversight
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Select, Textarea, errorMessage, toast } from '@/shared/components/ui';
import type { ActivateManualModeInput } from '../types';
import { MANUAL_SPEED_LIMITS } from '../types';

export interface ManualModeFormModalProps {
  isOpen: boolean;
  robot: { id: string; name: string } | null;
  operatorId?: string;
  onClose: () => void;
  onActivate: (input: ActivateManualModeInput) => Promise<unknown>;
}

const MODES = [
  { value: 'reduced_speed', label: `Reduced speed (${MANUAL_SPEED_LIMITS.reduced} mm/s)` },
  { value: 'full_speed', label: `Full speed (${MANUAL_SPEED_LIMITS.full} mm/s)` },
];

export function ManualModeFormModal({ isOpen, robot, operatorId, onClose, onActivate }: ManualModeFormModalProps) {
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'reduced_speed' | 'full_speed'>('reduced_speed');
  const [reasonError, setReasonError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setMode('reduced_speed');
    setReasonError(undefined);
    setFormError(undefined);
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!robot) return;
    if (!reason.trim()) {
      setReasonError('Say why you take control. It goes into the oversight log.');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await onActivate({ robotId: robot.id, reason: reason.trim(), mode, operatorId });
      toast.success('Manual mode activated', { description: robot.name });
      onClose();
    } catch (err) {
      const message = errorMessage(err);
      setFormError(message);
      toast.error("Couldn't activate manual mode", { description: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Take manual control"
      description={
        robot
          ? `${robot.name} stops autonomous work until you hand control back. Speed and force are capped while you drive.`
          : undefined
      }
      submitLabel="Take control"
      submittingLabel="Taking control…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Reason" required error={reasonError}>
        <Textarea
          rows={3}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (reasonError) setReasonError(undefined);
          }}
          placeholder="e.g. Confidence dropped near the loading dock"
        />
      </FormField>
      <FormField label="Speed limit" hint="ISO 10218-1: reduced speed unless the area is cleared.">
        <Select options={MODES} value={mode} onChange={(e) => setMode(e.target.value as 'reduced_speed' | 'full_speed')} />
      </FormField>
    </FormModal>
  );
}
