/**
 * @file ProviderDocFormModal.tsx
 * @description "New document" form for provider technical documentation
 *              (EU AI Act Annex IV, Machinery Regulation, CRA, RED).
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, Textarea, errorMessage, toast } from '@/shared/components/ui';
import { complianceApi } from '../api';
import { DocumentTypeLabels, type DocumentType, type ProviderDocInput } from '../types';

export interface ProviderDocFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const TYPE_OPTIONS = (Object.keys(DocumentTypeLabels) as DocumentType[]).map((value) => ({ value, label: DocumentTypeLabels[value] }));

const empty = (): ProviderDocInput => ({
  providerName: '', modelVersion: '', documentType: 'technical_doc', documentUrl: '', content: '',
  validFrom: new Date().toISOString().split('T')[0],
});

type Errors = Partial<Record<'providerName' | 'modelVersion' | 'content' | 'validFrom', string>>;

export function ProviderDocFormModal({ isOpen, onClose, onCreated }: ProviderDocFormModalProps) {
  const [f, setF] = useState<ProviderDocInput>(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setF(empty()); setErrors({}); setFormError(undefined);
  }, [isOpen]);

  const set = (k: keyof ProviderDocInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const submit = async () => {
    const next: Errors = {};
    if (!f.providerName.trim()) next.providerName = 'Name the provider.';
    if (!f.modelVersion.trim()) next.modelVersion = 'Give the model or product version.';
    if (!f.content.trim()) next.content = 'Paste the document content or a summary.';
    if (!f.validFrom) next.validFrom = 'Pick the date it applies from.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setFormError(undefined);
    try {
      await complianceApi.addDocumentation({
        ...f,
        providerName: f.providerName.trim(),
        modelVersion: f.modelVersion.trim(),
        documentUrl: f.documentUrl?.trim() || undefined,
        validTo: f.validTo || undefined,
      });
      toast.success('Document added', { description: `${DocumentTypeLabels[f.documentType]} · ${f.providerName.trim()}` });
      onCreated();
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
      title="New document"
      description="Technical documentation a provider must keep for its model or product."
      submitLabel="Add document"
      submittingLabel="Adding…"
      isSubmitting={saving}
      error={formError}
      onSubmit={submit}
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Provider" required error={errors.providerName}>
          <Input value={f.providerName} onChange={set('providerName')} placeholder="e.g. NeoDEM" />
        </FormField>
        <FormField label="Version" required error={errors.modelVersion}>
          <Input value={f.modelVersion} onChange={set('modelVersion')} placeholder="e.g. 1.0.0" />
        </FormField>
      </div>
      <FormField label="Document type" required>
        <Select options={TYPE_OPTIONS} value={f.documentType} onChange={set('documentType')} />
      </FormField>
      <FormField label="Link" aside="Optional">
        <Input type="url" value={f.documentUrl ?? ''} onChange={set('documentUrl')} placeholder="https://" />
      </FormField>
      <FormField label="Content" required error={errors.content}>
        <Textarea rows={6} value={f.content} onChange={set('content')} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Valid from" required error={errors.validFrom}>
          <Input type="date" value={f.validFrom} onChange={set('validFrom')} />
        </FormField>
        <FormField label="Valid to" aside="Optional">
          <Input type="date" value={f.validTo ?? ''} onChange={set('validTo')} />
        </FormField>
      </div>
    </FormModal>
  );
}
