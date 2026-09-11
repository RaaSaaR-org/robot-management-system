/**
 * @file NewRequestModal.tsx
 * @description FormModal to file a GDPR data-subject request: pick one of 7 rights, then its fields
 * @feature gdpr
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, Textarea, toast } from '@/shared/components/ui';
import { errorMessage } from './errorMessage';
import { useGDPRStore } from '../store';
import {
  RESTRICTION_REASON_LABELS,
  RESTRICTION_SCOPE_LABELS,
  REQUEST_TYPE_LABELS,
  RestrictionReasons,
  RestrictionScopes,
  type GDPRRequestType,
  type RestrictionReason,
  type RestrictionScope,
} from '../types';
import { RequestTypePicker } from './RequestTypeCard';

export interface NewRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Fields = Record<string, string>;
const REQUIRED: Partial<Record<GDPRRequestType, { key: string; message: string }[]>> = {
  rectification: [
    { key: 'field', message: 'Name the data to correct.' },
    { key: 'newValue', message: 'Enter the correct value.' },
  ],
  objection: [
    { key: 'activity', message: 'Name the processing you object to.' },
    { key: 'reason', message: 'Give a reason.' },
  ],
  adm_review: [
    { key: 'decisionId', message: 'Enter the decision ID.' },
    { key: 'reason', message: 'Say why you contest it.' },
  ],
};

export function NewRequestModal({ isOpen, onClose }: NewRequestModalProps) {
  const store = useGDPRStore();
  const [type, setType] = useState<GDPRRequestType | null>(null);
  const [f, setF] = useState<Fields>({});
  const [errors, setErrors] = useState<Fields>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setType(null); setF({ format: 'json', scope: 'all', restrictReason: 'accuracy_disputed' }); setErrors({}); setFormError(undefined);
  }, [isOpen]);

  const set = (key: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [key]: e.target.value }));
  const v = (key: string) => (f[key] ?? '').trim();

  const submit = async () => {
    if (!type) { setFormError('Choose the right you want to exercise.'); return; }
    const errs: Fields = {};
    for (const r of REQUIRED[type] ?? []) if (!v(r.key)) errs[r.key] = r.message;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true); setFormError(undefined);
    try {
      const format = (f.format === 'csv' ? 'csv' : 'json') as 'json' | 'csv';
      switch (type) {
        case 'access': await store.submitAccessRequest({ format, includeMetadata: true }); break;
        case 'portability': await store.submitPortabilityRequest({ format }); break;
        case 'erasure': await store.submitErasureRequest({ reason: v('reason') || undefined, scope: 'all' }); break;
        case 'rectification':
          await store.submitRectificationRequest({ fields: [{ field: v('field'), currentValue: v('currentValue'), newValue: v('newValue'), reason: v('reason') }] });
          break;
        case 'restriction':
          await store.submitRestrictionRequest({ scope: f.scope as RestrictionScope, reason: f.restrictReason as RestrictionReason, details: v('details') || undefined });
          break;
        case 'objection': await store.submitObjectionRequest({ processingActivity: v('activity'), reason: v('reason'), details: v('details') || undefined }); break;
        case 'adm_review': await store.submitADMReviewRequest({ decisionId: v('decisionId'), contestReason: v('reason'), evidence: v('details') || undefined }); break;
      }
      toast.success('Privacy request submitted', { description: `${REQUEST_TYPE_LABELS[type]} · We answer within 30 days.` });
      onClose();
      void store.fetchMyRequests();
    } catch (err) {
      setFormError(errorMessage(err, "Couldn't submit the request. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const formatField = (
    <FormField label="Format">
      <Select value={f.format} onChange={set('format')} options={[{ value: 'json', label: 'JSON' }, { value: 'csv', label: 'CSV' }]} />
    </FormField>
  );

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title="New privacy request"
      description="Choose the right you want to exercise under GDPR Art. 15–22. Most requests are answered within 30 days."
      submitLabel="Submit request"
      submittingLabel="Submitting…"
      isSubmitting={saving}
      error={formError}
      onSubmit={submit}
      noValidate
    >
      <RequestTypePicker value={type} onChange={(t) => { setType(t); setErrors({}); setFormError(undefined); }} />

      {(type === 'access' || type === 'portability') && formatField}
      {type === 'erasure' && (
        <FormField label="Reason" aside="Optional"><Textarea rows={3} value={f.reason ?? ''} onChange={set('reason')} /></FormField>
      )}
      {type === 'rectification' && (
        <>
          <FormField label="Data to correct" required error={errors.field}><Input value={f.field ?? ''} onChange={set('field')} placeholder="e.g. Email address" /></FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Current value" aside="Optional"><Input value={f.currentValue ?? ''} onChange={set('currentValue')} /></FormField>
            <FormField label="Correct value" required error={errors.newValue}><Input value={f.newValue ?? ''} onChange={set('newValue')} /></FormField>
          </div>
          <FormField label="Reason" aside="Optional"><Textarea rows={2} value={f.reason ?? ''} onChange={set('reason')} /></FormField>
        </>
      )}
      {type === 'restriction' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Scope"><Select value={f.scope} onChange={set('scope')} options={RestrictionScopes.map((s) => ({ value: s, label: RESTRICTION_SCOPE_LABELS[s] }))} /></FormField>
            <FormField label="Reason"><Select value={f.restrictReason} onChange={set('restrictReason')} options={RestrictionReasons.map((r) => ({ value: r, label: RESTRICTION_REASON_LABELS[r] }))} /></FormField>
          </div>
          <FormField label="Details" aside="Optional"><Textarea rows={2} value={f.details ?? ''} onChange={set('details')} /></FormField>
        </>
      )}
      {type === 'objection' && (
        <>
          <FormField label="Processing activity" required error={errors.activity}><Input value={f.activity ?? ''} onChange={set('activity')} placeholder="e.g. Usage analytics" /></FormField>
          <FormField label="Reason" required error={errors.reason}><Textarea rows={2} value={f.reason ?? ''} onChange={set('reason')} /></FormField>
        </>
      )}
      {type === 'adm_review' && (
        <>
          <FormField label="Decision ID" required error={errors.decisionId}><Input value={f.decisionId ?? ''} onChange={set('decisionId')} className="font-mono" /></FormField>
          <FormField label="Why you contest it" required error={errors.reason}><Textarea rows={2} value={f.reason ?? ''} onChange={set('reason')} /></FormField>
          <FormField label="Evidence" aside="Optional"><Textarea rows={2} value={f.details ?? ''} onChange={set('details')} /></FormField>
        </>
      )}
    </FormModal>
  );
}
