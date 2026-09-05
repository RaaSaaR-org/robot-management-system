/**
 * @file ModelsPage.tsx
 * @description Model registry — every registered model version, plus the
 *              "Register model" form that puts an externally trained
 *              fine-tune into the system (TASK-238)
 * @feature deployment
 */

import { useEffect, useState } from 'react';
import { Modal, Button, Input, PageHeader } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useDeploymentStore } from '../store';
import { useModelVersionsAutoFetch } from '../hooks/useModelVersions';
import { ModelBrowser } from '../components';
import { deploymentApi } from '../api';
import { ARTIFACT_URI_SCHEMES } from '../types';
import type { ModelVersion, RegisterModelVersionInput } from '../types';

const fieldLabelClass = 'block text-sm font-medium text-theme-primary mb-1';
const selectClass =
  'w-full px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-theme-primary focus:ring-2 focus:ring-cobalt-500 focus:border-transparent';

interface RegisterFormState {
  name: string;
  version: string;
  artifactUri: string;
  skillId: string;
  parentModelVersionId: string;
}

const initialFormState: RegisterFormState = {
  name: '',
  version: '',
  artifactUri: '',
  skillId: '',
  parentModelVersionId: '',
};

function hasKnownScheme(uri: string): boolean {
  return ARTIFACT_URI_SCHEMES.some((scheme) => uri.startsWith(scheme));
}

interface RegisterModelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegistered: () => Promise<void> | void;
  modelVersions: ModelVersion[];
}

function RegisterModelModal({
  isOpen,
  onClose,
  onRegistered,
  modelVersions,
}: RegisterModelModalProps) {
  const skills = useDeploymentStore((s) => s.skills);
  const [form, setForm] = useState<RegisterFormState>(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(initialFormState);
      setError(null);
    }
  }, [isOpen]);

  const trimmedUri = form.artifactUri.trim();
  const uriHasScheme = trimmedUri.length === 0 || hasKnownScheme(trimmedUri);
  const canSubmit = form.version.trim().length > 0 && trimmedUri.length > 0 && uriHasScheme;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const input: RegisterModelVersionInput = {
      version: form.version.trim(),
      artifactUri: trimmedUri,
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      ...(form.skillId ? { skillId: form.skillId } : {}),
      ...(form.parentModelVersionId
        ? { parentModelVersionId: form.parentModelVersionId }
        : {}),
    };

    setIsSubmitting(true);
    setError(null);
    try {
      await deploymentApi.registerModelVersion(input);
      await onRegistered();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Register model"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={!canSubmit}
          >
            Register
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-theme-secondary">
          Registers a model this server did not train — a checkpoint from another machine,
          a Hub repo, or a bucket — so deployments and skills can address it by id.
        </p>

        <div>
          <label className={fieldLabelClass}>Name</label>
          <Input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="e.g., GR00T-N1.7 AppleToPlate"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className={fieldLabelClass}>
            Version <span className="text-red-500">*</span>
          </label>
          <Input
            value={form.version}
            onChange={(e) => setForm((prev) => ({ ...prev, version: e.target.value }))}
            placeholder="e.g., 2026-09-04-g1-apple-pnp"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className={fieldLabelClass}>
            Artifact URI <span className="text-red-500">*</span>
          </label>
          <Input
            value={form.artifactUri}
            onChange={(e) => setForm((prev) => ({ ...prev, artifactUri: e.target.value }))}
            placeholder="hf://org/repo · s3://bucket/key · file:///abs/path"
            disabled={isSubmitting}
            error={
              uriHasScheme
                ? undefined
                : `Needs a scheme: ${ARTIFACT_URI_SCHEMES.join(', ')}`
            }
            helperText={
              uriHasScheme
                ? 'A bare path is not portable and fails on another machine.'
                : undefined
            }
          />
        </div>

        <div>
          <label className={fieldLabelClass}>Skill</label>
          <select
            className={selectClass}
            value={form.skillId}
            onChange={(e) => setForm((prev) => ({ ...prev, skillId: e.target.value }))}
            disabled={isSubmitting}
          >
            <option value="">No skill</option>
            {skills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name} v{skill.version}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabelClass}>Derived from</label>
          <select
            className={selectClass}
            value={form.parentModelVersionId}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, parentModelVersionId: e.target.value }))
            }
            disabled={isSubmitting}
          >
            <option value="">No parent</option>
            {modelVersions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name || version.skill?.name || 'Model'} v{version.version}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

export function ModelsPage() {
  const { modelVersions, isLoading, fetchModelVersions } = useModelVersionsAutoFetch();
  const fetchSkills = useDeploymentStore((s) => s.fetchSkills);
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>();
  const [showRegister, setShowRegister] = useState(false);

  // The register form offers the skill list as a dropdown, so it has to be loaded
  // before the modal opens.
  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Model Registry"
        subtitle="Every model version this system knows — trained here, imported, or derived from another."
        actions={
          <Button variant="primary" onClick={() => setShowRegister(true)}>
            Register model
          </Button>
        }
      />

      <ModelBrowser
        modelVersions={modelVersions}
        isLoading={isLoading}
        selectedVersionId={selectedVersionId}
        onSelectVersion={(version) => setSelectedVersionId(version.id)}
      />

      <RegisterModelModal
        isOpen={showRegister}
        onClose={() => setShowRegister(false)}
        onRegistered={() => fetchModelVersions()}
        modelVersions={modelVersions}
      />
    </div>
  );
}
