/**
 * @file RollbackModal.tsx
 * @description Danger FormModal that rolls a deployed update back on one
 *              robot to an earlier version
 * @feature updates
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useUpdatesStore } from '../store/updatesStore';
import type { UpdatePackage } from '../types/updates.types';
import { runUpdateAct } from './updateActs';
import { useRobotOptions } from './useRobotOptions';

export interface RollbackModalProps {
  /** The package to roll back; null keeps the modal closed. */
  pkg: UpdatePackage | null;
  onClose: () => void;
}

export function RollbackModal({ pkg, onClose }: RollbackModalProps) {
  const triggerRollback = useUpdatesStore((s) => s.triggerRollback);
  const robots = useRobotOptions(Boolean(pkg));
  const [robotId, setRobotId] = useState('');
  const [targetVersion, setTargetVersion] = useState('');
  const [errors, setErrors] = useState<{ robot?: string; target?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pkg) return;
    setRobotId('');
    setTargetVersion('');
    setErrors({});
    setFormError(undefined);
  }, [pkg]);

  const handleSubmit = async () => {
    if (!pkg) return;
    const next: typeof errors = {};
    if (!robotId) next.robot = 'Choose the robot to roll back.';
    if (!targetVersion.trim()) next.target = 'Say which version to restore.';
    setErrors(next);
    if (next.robot || next.target) return;

    setSaving(true);
    setFormError(undefined);
    try {
      await runUpdateAct(() => triggerRollback(pkg.id, robotId, targetVersion.trim()));
      toast.success('Update rolled back', { description: `${robots.nameOf(robotId)} → v${targetVersion.trim()}` });
      onClose();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={Boolean(pkg)}
      onClose={onClose}
      title={pkg ? `Roll back v${pkg.version}?` : 'Roll back update'}
      description="The robot uninstalls this package and restores the version you name. The rollback is logged for compliance."
      submitLabel="Roll back"
      submittingLabel="Rolling back…"
      submitVariant="danger"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Robot" required error={errors.robot}>
        <Select placeholder={robots.isLoading ? 'Loading robots…' : 'Choose a robot…'}
          options={robots.options} value={robotId} onChange={(e) => setRobotId(e.target.value)} />
      </FormField>
      <FormField label="Restore version" required error={errors.target}>
        <Input value={targetVersion} onChange={(e) => setTargetVersion(e.target.value)} placeholder="e.g. 1.3.2" />
      </FormField>
    </FormModal>
  );
}
