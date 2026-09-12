/**
 * @file ChangeRoleModal.tsx
 * @description Small FormModal to change a teammate's role (replaces the inline row select)
 * @feature team
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Select, toast } from '@/shared/components/ui';
import { useTeamStore } from '../store/teamStore';
import type { AssignableRole, TeamMember } from '../types/team.types';
import { ROLE_OPTIONS, teamErrorMessage } from './teamErrors';

export function ChangeRoleModal({ member, onClose }: { member: TeamMember | null; onClose: () => void }) {
  const changeRole = useTeamStore((s) => s.changeRole);
  const [role, setRole] = useState<AssignableRole>('member');
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!member) return;
    setRole(member.role === 'super-admin' ? 'owner' : member.role);
    setFormError(undefined);
  }, [member]);

  const handleSubmit = async () => {
    if (!member) return;
    if (role === member.role) return onClose();
    setSaving(true);
    setFormError(undefined);
    try {
      await changeRole(member.id, role);
      toast.success('Role updated', { description: `${member.name} is now ${role}` });
      onClose();
    } catch (err) {
      setFormError(teamErrorMessage(err, "Couldn't change the role"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={member !== null}
      onClose={onClose}
      title={member ? `Change role of ${member.name}` : 'Change role'}
      submitLabel="Save changes"
      submittingLabel="Saving…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      size="sm"
    >
      <FormField label="Role" hint="Takes effect at their next request.">
        <Select options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value as AssignableRole)} />
      </FormField>
    </FormModal>
  );
}
