/**
 * @file NewPackageModal.tsx
 * @description FormModal that creates a new OTA update package; the server
 *              signs it
 * @feature updates
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Textarea, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useUpdatesStore } from '../store/updatesStore';
import { runUpdateAct } from './updateActs';

export interface NewPackageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

export function NewPackageModal({ isOpen, onClose }: NewPackageModalProps) {
  const createPackage = useUpdatesStore((s) => s.createPackage);
  const [version, setVersion] = useState('');
  const [changelog, setChangelog] = useState('');
  const [errors, setErrors] = useState<{ version?: string; changelog?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setVersion('');
    setChangelog('');
    setErrors({});
    setFormError(undefined);
  }, [isOpen]);

  const handleSubmit = async () => {
    const v = version.trim().replace(/^v/, '');
    const next: typeof errors = {};
    if (!v) next.version = 'Give the package a version.';
    else if (!SEMVER.test(v)) next.version = 'Use a semantic version, e.g. 1.4.0.';
    if (!changelog.trim()) next.changelog = 'Say what changed.';
    setErrors(next);
    if (next.version || next.changelog) return;

    setSaving(true);
    setFormError(undefined);
    try {
      await runUpdateAct(() => createPackage({ version: v, changelog: changelog.trim() }));
      toast.success('Package created', { description: `v${v}` });
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
      title="New package"
      description="The server signs the package with its Ed25519 key. It stays pending until someone approves it."
      submitLabel="Create package"
      submittingLabel="Creating…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Version" required error={errors.version} hint="Semantic version, e.g. 1.4.0">
        <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.4.0" />
      </FormField>
      <FormField label="Changelog" required error={errors.changelog}>
        <Textarea rows={4} value={changelog} onChange={(e) => setChangelog(e.target.value)}
          placeholder="What changes for the robots and their operators" />
      </FormField>
    </FormModal>
  );
}
