/**
 * @file RopaFormModal.tsx
 * @description Create and edit form for a record of processing activity
 *              (GDPR Art. 30). List fields are entered comma-separated.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, Textarea, errorMessage, toast } from '@/shared/components/ui';
import { useComplianceStore } from '../store';
import type { RopaEntry, RopaEntryInput } from '../types';

export const LEGAL_BASIS_OPTIONS = [
  { value: 'consent', label: 'Consent (Art. 6(1)(a))' },
  { value: 'contract', label: 'Contract (Art. 6(1)(b))' },
  { value: 'legal_obligation', label: 'Legal obligation (Art. 6(1)(c))' },
  { value: 'vital_interests', label: 'Vital interests (Art. 6(1)(d))' },
  { value: 'public_task', label: 'Public task (Art. 6(1)(e))' },
  { value: 'legitimate_interests', label: 'Legitimate interests (Art. 6(1)(f))' },
];

export function legalBasisLabel(value: string): string {
  return LEGAL_BASIS_OPTIONS.find((o) => o.value === value)?.label.replace(/ \(Art\..*\)$/, '') ?? value;
}

const toList = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

export interface RopaFormModalProps {
  isOpen: boolean;
  entry: RopaEntry | null;
  onClose: () => void;
}

interface Errors { processingActivity?: string; purpose?: string; retentionPeriod?: string; dataCategories?: string }

export function RopaFormModal({ isOpen, entry, onClose }: RopaFormModalProps) {
  const { createRopaEntry, updateRopaEntry } = useComplianceStore();
  const [f, setF] = useState({
    processingActivity: '', purpose: '', legalBasis: 'legitimate_interests', retentionPeriod: '',
    dataCategories: '', dataSubjects: '', recipients: '', securityMeasures: '', thirdCountryTransfers: '',
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setF({
      processingActivity: entry?.processingActivity ?? '',
      purpose: entry?.purpose ?? '',
      legalBasis: entry?.legalBasis ?? 'legitimate_interests',
      retentionPeriod: entry?.retentionPeriod ?? '',
      dataCategories: entry?.dataCategories.join(', ') ?? '',
      dataSubjects: entry?.dataSubjects.join(', ') ?? '',
      recipients: entry?.recipients.join(', ') ?? '',
      securityMeasures: entry?.securityMeasures.join(', ') ?? '',
      thirdCountryTransfers: entry?.thirdCountryTransfers ?? '',
    });
    setErrors({});
    setFormError(undefined);
  }, [isOpen, entry]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async () => {
    const next: Errors = {};
    if (!f.processingActivity.trim()) next.processingActivity = 'Name the processing activity.';
    if (!f.purpose.trim()) next.purpose = 'Say what the data is processed for.';
    if (!f.retentionPeriod.trim()) next.retentionPeriod = 'Say how long the data is kept.';
    if (!toList(f.dataCategories).length) next.dataCategories = 'List at least one data category.';
    setErrors(next);
    if (Object.keys(next).length) return;

    const input: RopaEntryInput = {
      processingActivity: f.processingActivity.trim(),
      purpose: f.purpose.trim(),
      legalBasis: f.legalBasis,
      retentionPeriod: f.retentionPeriod.trim(),
      dataCategories: toList(f.dataCategories),
      dataSubjects: toList(f.dataSubjects),
      recipients: toList(f.recipients),
      securityMeasures: toList(f.securityMeasures),
      thirdCountryTransfers: f.thirdCountryTransfers.trim() || undefined,
    };
    setSaving(true);
    setFormError(undefined);
    try {
      if (entry) {
        await updateRopaEntry(entry.id, input);
        toast.success('RoPA entry updated', { description: input.processingActivity });
      } else {
        await createRopaEntry(input);
        toast.success('RoPA entry created', { description: input.processingActivity });
      }
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
      size="lg"
      title={entry ? `Edit ${entry.processingActivity}` : 'New RoPA entry'}
      description={entry ? undefined : 'One record per processing activity, as GDPR Art. 30 requires.'}
      submitLabel={entry ? 'Save changes' : 'Create RoPA entry'}
      submittingLabel={entry ? 'Saving…' : 'Creating…'}
      isSubmitting={saving}
      error={formError}
      onSubmit={submit}
      noValidate
    >
      <FormField label="Processing activity" required error={errors.processingActivity}>
        <Input value={f.processingActivity} onChange={set('processingActivity')} placeholder="e.g. Teleoperation video recording" />
      </FormField>
      <FormField label="Purpose" required error={errors.purpose}>
        <Textarea rows={2} value={f.purpose} onChange={set('purpose')} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Legal basis" required>
          <Select options={LEGAL_BASIS_OPTIONS} value={f.legalBasis} onChange={set('legalBasis')} />
        </FormField>
        <FormField label="Retention period" required error={errors.retentionPeriod}>
          <Input value={f.retentionPeriod} onChange={set('retentionPeriod')} placeholder="e.g. 90 days" />
        </FormField>
      </div>
      <FormField label="Data categories" required error={errors.dataCategories} hint="Separate with commas.">
        <Input value={f.dataCategories} onChange={set('dataCategories')} placeholder="Video, operator ID, robot state" />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Data subjects" aside="Optional" hint="Separate with commas.">
          <Input value={f.dataSubjects} onChange={set('dataSubjects')} placeholder="Operators, visitors" />
        </FormField>
        <FormField label="Recipients" aside="Optional" hint="Separate with commas.">
          <Input value={f.recipients} onChange={set('recipients')} />
        </FormField>
      </div>
      <FormField label="Security measures" aside="Optional" hint="Separate with commas.">
        <Input value={f.securityMeasures} onChange={set('securityMeasures')} placeholder="Encryption at rest, access logging" />
      </FormField>
      <FormField label="Third-country transfers" aside="Optional">
        <Input value={f.thirdCountryTransfers} onChange={set('thirdCountryTransfers')} placeholder="None" />
      </FormField>
    </FormModal>
  );
}
