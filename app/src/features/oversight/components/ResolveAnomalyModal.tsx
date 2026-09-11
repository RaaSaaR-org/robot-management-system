/**
 * @file ResolveAnomalyModal.tsx
 * @description Form modal that resolves an anomaly with required resolution notes
 * @feature oversight
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Textarea, errorMessage, toast } from '@/shared/components/ui';
import type { AnomalyRecord } from '../types';
import { humanize } from './oversightFormat';

export interface ResolveAnomalyModalProps {
  anomaly: AnomalyRecord | null;
  onClose: () => void;
  onResolve: (anomalyId: string, resolution: string) => Promise<void>;
}

export function ResolveAnomalyModal({ anomaly, onClose, onResolve }: ResolveAnomalyModalProps) {
  const [notes, setNotes] = useState('');
  const [notesError, setNotesError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!anomaly) return;
    setNotes('');
    setNotesError(undefined);
    setFormError(undefined);
  }, [anomaly]);

  const handleSubmit = async () => {
    if (!anomaly) return;
    if (!notes.trim()) {
      setNotesError('Say what you checked and what fixed it.');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await onResolve(anomaly.id, notes.trim());
      toast.success('Anomaly resolved', { description: humanize(anomaly.anomalyType) });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={Boolean(anomaly)}
      onClose={onClose}
      title="Resolve anomaly"
      description={
        anomaly
          ? `${humanize(anomaly.anomalyType)} on ${anomaly.robotName ?? anomaly.robotId} leaves the active list. The notes go into the oversight log.`
          : undefined
      }
      submitLabel="Resolve anomaly"
      submittingLabel="Resolving…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Resolution notes" required error={notesError}>
        <Textarea
          rows={4}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            if (notesError) setNotesError(undefined);
          }}
          placeholder="e.g. Recalibrated the depth camera; confidence back above 0.9"
        />
      </FormField>
    </FormModal>
  );
}
