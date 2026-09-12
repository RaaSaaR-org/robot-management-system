/**
 * @file VerificationFormModal.tsx
 * @description Form modal that schedules a recurring human verification of robot outputs
 * @feature oversight
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, Textarea, errorMessage, toast } from '@/shared/components/ui';
import type { CreateVerificationScheduleInput } from '../types';

export interface VerificationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  robots: Array<{ id: string; name: string }>;
  /** Preselects the robot scope (the toolbar's robot filter). */
  defaultRobotId?: string | null;
  onCreate: (input: CreateVerificationScheduleInput) => Promise<unknown>;
}

const INTERVALS = [
  { value: '60', label: 'Every hour' },
  { value: '240', label: 'Every 4 hours' },
  { value: '480', label: 'Every shift (8 hours)' },
  { value: '1440', label: 'Every day' },
  { value: '10080', label: 'Every week' },
];

export function VerificationFormModal({ isOpen, onClose, robots, defaultRobotId, onCreate }: VerificationFormModalProps) {
  const [name, setName] = useState('');
  const [interval, setIntervalValue] = useState('480');
  const [robotId, setRobotId] = useState('');
  const [description, setDescription] = useState('');
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setIntervalValue('480');
    setRobotId(defaultRobotId ?? '');
    setDescription('');
    setNameError(undefined);
    setFormError(undefined);
  }, [isOpen, defaultRobotId]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setNameError('Give the verification a name.');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        intervalMinutes: Number(interval),
        robotScope: robotId ? 'robot' : 'all',
        scopeId: robotId || undefined,
      });
      toast.success('Verification scheduled', { description: name.trim() });
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
      title="Schedule verification"
      description="A recurring reminder for an operator to check the robots' outputs by hand."
      submitLabel="Schedule verification"
      submittingLabel="Scheduling…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Name" required error={nameError}>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(undefined);
          }}
          placeholder="e.g. Shift start pick check"
        />
      </FormField>
      <FormField label="Interval">
        <Select options={INTERVALS} value={interval} onChange={(e) => setIntervalValue(e.target.value)} />
      </FormField>
      <FormField label="Robots">
        <Select
          placeholder="All robots"
          options={robots.map((r) => ({ value: r.id, label: r.name }))}
          value={robotId}
          onChange={(e) => setRobotId(e.target.value)}
        />
      </FormField>
      <FormField label="What to check" aside="Optional">
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
    </FormModal>
  );
}
