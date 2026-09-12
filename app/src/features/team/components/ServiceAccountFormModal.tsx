/**
 * @file ServiceAccountFormModal.tsx
 * @description "New service account" FormModal: name and role (TASK-165)
 * @feature team
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, toast } from '@/shared/components/ui';
import { useServiceAccountsStore } from '../store/serviceAccountsStore';
import type { AssignableServiceRole } from '../types/serviceAccount.types';
import { teamErrorMessage } from './teamErrors';

const SERVICE_ROLES = [
  { value: 'member', label: 'Member — can operate robots and start training' },
  { value: 'viewer', label: 'Viewer — read-only' },
];

export function ServiceAccountFormModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const create = useServiceAccountsStore((s) => s.create);
  const [name, setName] = useState('');
  const [role, setRole] = useState<AssignableServiceRole>('member');
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setRole('member'); setNameError(undefined); setFormError(undefined);
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!name.trim()) return setNameError('Give the service account a name.');
    setSaving(true);
    setFormError(undefined);
    try {
      await create({ name: name.trim(), role });
      toast.success('Service account created', { description: `${name.trim()} — add a token with Manage tokens.` });
      onClose();
    } catch (err) {
      setFormError(teamErrorMessage(err, "Couldn't create the service account"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="New service account"
      description="A bot user for agents, CI pipelines and integrations. It signs in with API tokens only."
      submitLabel="Create service account"
      submittingLabel="Creating…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Name" required error={nameError}>
        <Input value={name} onChange={(e) => { setName(e.target.value); setNameError(undefined); }} placeholder="e.g. ci-pipeline" />
      </FormField>
      <FormField label="Role">
        <Select options={SERVICE_ROLES} value={role} onChange={(e) => setRole(e.target.value as AssignableServiceRole)} />
      </FormField>
    </FormModal>
  );
}
