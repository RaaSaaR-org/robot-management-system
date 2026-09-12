/**
 * @file LegalHoldFormModal.tsx
 * @description Create form for a legal hold: name, reason, who placed it,
 *              optional end date and log ids to preserve.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Textarea, errorMessage, toast } from '@/shared/components/ui';
import { useComplianceStore } from '../store';

export interface LegalHoldFormModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Errors { name?: string; reason?: string; createdBy?: string; logIds?: string }

/** "New legal hold" form (holds are created and released, never edited). */
export function LegalHoldFormModal({ isOpen, onClose }: LegalHoldFormModalProps) {
  const createLegalHold = useComplianceStore((s) => s.createLegalHold);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [endDate, setEndDate] = useState('');
  const [logIds, setLogIds] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setReason(''); setCreatedBy(''); setEndDate(''); setLogIds('');
    setErrors({}); setFormError(undefined);
  }, [isOpen]);

  const submit = async () => {
    const next: Errors = {};
    if (!name.trim()) next.name = 'Give the hold a name.';
    if (!reason.trim()) next.reason = 'Say why the entries must be preserved.';
    if (!createdBy.trim()) next.createdBy = 'Say who placed the hold.';
    const ids = logIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!ids.length) next.logIds = 'Add at least one log ID to preserve.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setFormError(undefined);
    try {
      await createLegalHold({
        name: name.trim(),
        reason: reason.trim(),
        createdBy: createdBy.trim(),
        endDate: endDate || undefined,
        logIds: ids,
      });
      toast.success('Legal hold created', { description: name.trim() });
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
      title="New legal hold"
      description="Entries under a hold are never deleted by retention cleanup, until the hold is released."
      submitLabel="Create legal hold"
      submittingLabel="Creating…"
      isSubmitting={saving}
      error={formError}
      onSubmit={submit}
      noValidate
    >
      <FormField label="Name" required error={errors.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incident 2026-09 investigation" />
      </FormField>
      <FormField label="Reason" required error={errors.reason}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Litigation, regulator request, incident review…" />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Placed by" required error={errors.createdBy}>
          <Input value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} placeholder="Name or role" />
        </FormField>
        <FormField label="Ends on" aside="Optional">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Log IDs" required error={errors.logIds} hint="Copy them from an audit log entry. Separate with commas or new lines.">
        <Textarea rows={3} className="font-mono text-xs" value={logIds} onChange={(e) => setLogIds(e.target.value)} />
      </FormField>
    </FormModal>
  );
}
