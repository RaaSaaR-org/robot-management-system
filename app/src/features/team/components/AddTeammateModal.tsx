/**
 * @file AddTeammateModal.tsx
 * @description "Add teammate" FormModal: name, email, role, temporary password. On success the
 * page shows the one-time credentials handoff.
 * @feature team
 */

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, FormField, FormModal, Input, Select } from '@/shared/components/ui';
import { useTeamStore } from '../store/teamStore';
import type { AddTeamMemberResult, AssignableRole } from '../types/team.types';
import { ROLE_OPTIONS, teamErrorMessage } from './teamErrors';

interface AddTeammateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: (result: AddTeamMemberResult) => void;
}

/** Non-authoritative suggestion; the server generates one when the field is empty. */
function suggestTempPassword(): string {
  const sets = ['abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKMNPQRSTUVWXYZ', '23456789', '!@$%^&*'];
  const all = sets.join('');
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b, i) => (i < sets.length ? sets[i][b % sets[i].length] : all[b % all.length]));
  return chars.sort(() => (crypto.getRandomValues(new Uint8Array(1))[0] > 127 ? 1 : -1)).join('');
}

export function AddTeammateModal({ isOpen, onClose, onAdded }: AddTeammateModalProps) {
  const add = useTeamStore((s) => s.add);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const [tempPassword, setTempPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(''); setEmail(''); setRole('member');
    setTempPassword(suggestTempPassword());
    setErrors({}); setFormError(undefined);
  }, [isOpen]);

  const handleSubmit = async () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Enter their name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setFormError(undefined);
    try {
      const result = await add({ name: name.trim(), email: email.trim().toLowerCase(), role, tempPassword: tempPassword || undefined });
      onClose();
      onAdded(result);
    } catch (err) {
      setFormError(teamErrorMessage(err, "Couldn't add the teammate"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Add teammate"
      description="They sign in with a temporary password and choose their own at first sign-in."
      submitLabel="Add teammate"
      submittingLabel="Adding…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Name" required error={errors.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Doe" autoComplete="off" />
      </FormField>
      <FormField label="Email" required error={errors.email}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" autoComplete="off" />
      </FormField>
      <FormField label="Role">
        <Select options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value as AssignableRole)} />
      </FormField>
      <FormField
        label="Temporary password"
        hint="Left empty, the server makes one. Shown once after adding."
        aside={
          <Button variant="ghost" size="sm" leftIcon={<RefreshCw className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setTempPassword(suggestTempPassword())}>
            Regenerate
          </Button>
        }
      >
        <Input value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} className="font-mono" autoComplete="off" />
      </FormField>
    </FormModal>
  );
}
