/**
 * @file EditModelModal.tsx
 * @description FormModal that renames a registered model version or changes
 *              its skill link (PATCH /api/models/versions/:id)
 * @feature deployment
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useDeploymentStore } from '../../store';
import { deploymentApi } from '../../api';
import type { ModelVersion } from '../../types';
import { getModelDisplayName } from './modelDisplay';

export interface EditModelModalProps {
  /** The version being edited; null keeps the modal closed. */
  version: ModelVersion | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function EditModelModal({ version, onClose, onSaved }: EditModelModalProps) {
  const skills = useDeploymentStore((s) => s.skills);
  const [name, setName] = useState('');
  const [skillId, setSkillId] = useState('');
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!version) return;
    setName(version.name ?? '');
    setSkillId(version.skillId ?? '');
    setFormError(undefined);
  }, [version]);

  const handleSubmit = async () => {
    if (!version) return;
    const trimmed = name.trim();
    setSaving(true);
    setFormError(undefined);
    try {
      // An empty field clears the column, so the name falls back to the skill or the version.
      await deploymentApi.updateModelVersion(version.id, { name: trimmed || null, skillId: skillId || null });
      toast.success('Model updated', { description: trimmed || `v${version.version}` });
      await onSaved();
      onClose();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={version !== null}
      onClose={onClose}
      title={version ? `Edit ${getModelDisplayName(version)}` : 'Edit model'}
      description="The version and the artifact are fixed once registered. The name and the skill link can change."
      submitLabel="Save changes"
      submittingLabel="Saving…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Name" aside="Optional" hint="Leave it empty to show the skill name, or the version.">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GR00T-N1.7 AppleToPlate" />
      </FormField>
      <FormField label="Skill" aside="Optional">
        <Select
          placeholder="No skill"
          options={skills.map((s) => ({ value: s.id, label: `${s.name} v${s.version}` }))}
          value={skillId}
          onChange={(e) => setSkillId(e.target.value)}
        />
      </FormField>
    </FormModal>
  );
}
