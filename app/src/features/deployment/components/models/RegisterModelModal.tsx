/**
 * @file RegisterModelModal.tsx
 * @description FormModal that registers an externally trained model version
 *              so deployments and skills can address it by id (TASK-238)
 * @feature deployment
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useDeploymentStore } from '../../store';
import { deploymentApi } from '../../api';
import { ARTIFACT_URI_SCHEMES } from '../../types';
import type { ModelVersion, RegisterModelVersionInput } from '../../types';
import { getModelDisplayName } from './modelDisplay';

export interface RegisterModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegistered: () => Promise<void> | void;
  modelVersions: ModelVersion[];
}

interface FieldErrors {
  version?: string;
  artifactUri?: string;
}

function hasKnownScheme(uri: string): boolean {
  return ARTIFACT_URI_SCHEMES.some((scheme) => uri.startsWith(scheme));
}

export function RegisterModelModal({ isOpen, onClose, onRegistered, modelVersions }: RegisterModelModalProps) {
  const skills = useDeploymentStore((s) => s.skills);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [artifactUri, setArtifactUri] = useState('');
  const [skillId, setSkillId] = useState('');
  const [parentId, setParentId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setVersion('');
    setArtifactUri('');
    setSkillId('');
    setParentId('');
    setErrors({});
    setFormError(undefined);
  }, [isOpen]);

  const handleSubmit = async () => {
    const uri = artifactUri.trim();
    const next: FieldErrors = {};
    if (!version.trim()) next.version = 'Give the version a label.';
    if (!uri) next.artifactUri = 'Say where the weights live.';
    else if (!hasKnownScheme(uri)) next.artifactUri = `Needs a scheme: ${ARTIFACT_URI_SCHEMES.join(', ')}`;
    setErrors(next);
    if (next.version || next.artifactUri) return;

    const input: RegisterModelVersionInput = {
      version: version.trim(),
      artifactUri: uri,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(skillId ? { skillId } : {}),
      ...(parentId ? { parentModelVersionId: parentId } : {}),
    };

    setSaving(true);
    setFormError(undefined);
    try {
      await deploymentApi.registerModelVersion(input);
      toast.success('Model registered', { description: name.trim() || `v${version.trim()}` });
      await onRegistered();
      onClose();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Register model"
      description="Registers a model this server did not train — a checkpoint from another machine, a Hub repo, or a bucket — so deployments and skills can address it by id."
      submitLabel="Register model"
      submittingLabel="Registering…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      size="lg"
      noValidate
    >
      <FormField label="Name" aside="Optional">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GR00T-N1.7 AppleToPlate" />
      </FormField>
      <FormField label="Version" required error={errors.version}>
        <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2026-09-04-g1-apple-pnp" />
      </FormField>
      <FormField
        label="Artifact URI"
        required
        error={errors.artifactUri}
        hint="hf://, s3:// or file:///… — a bare path is not portable and fails on another machine."
      >
        <Input value={artifactUri} onChange={(e) => setArtifactUri(e.target.value)} placeholder="hf://org/repo" />
      </FormField>
      <FormField label="Skill" aside="Optional">
        <Select
          placeholder="No skill"
          options={skills.map((s) => ({ value: s.id, label: `${s.name} v${s.version}` }))}
          value={skillId}
          onChange={(e) => setSkillId(e.target.value)}
        />
      </FormField>
      <FormField label="Derived from" aside="Optional">
        <Select
          placeholder="No parent"
          options={modelVersions.map((v) => ({ value: v.id, label: `${getModelDisplayName(v)} v${v.version}` }))}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        />
      </FormField>
    </FormModal>
  );
}
