/**
 * @file DeployUpdateModal.tsx
 * @description FormModal that sends an approved update package to one robot
 * @feature updates
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useUpdatesStore } from '../store/updatesStore';
import type { UpdatePackage } from '../types/updates.types';
import { runUpdateAct } from './updateActs';
import { useRobotOptions } from './useRobotOptions';

export interface DeployUpdateModalProps {
  /** The package to deploy; null keeps the modal closed. */
  pkg: UpdatePackage | null;
  onClose: () => void;
}

export function DeployUpdateModal({ pkg, onClose }: DeployUpdateModalProps) {
  const deployPackage = useUpdatesStore((s) => s.deployPackage);
  const robots = useRobotOptions(Boolean(pkg));
  const [robotId, setRobotId] = useState('');
  const [previousVersion, setPreviousVersion] = useState('');
  const [robotError, setRobotError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pkg) return;
    setRobotId('');
    setPreviousVersion('');
    setRobotError(undefined);
    setFormError(undefined);
  }, [pkg]);

  const handleSubmit = async () => {
    if (!pkg) return;
    if (!robotId) {
      setRobotError('Choose the robot that gets the update.');
      return;
    }
    setSaving(true);
    setFormError(undefined);
    try {
      await runUpdateAct(() => deployPackage(pkg.id, robotId, previousVersion.trim() || undefined));
      toast.success('Update deployed', { description: `v${pkg.version} → ${robots.nameOf(robotId)}` });
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
      title={pkg ? `Deploy v${pkg.version}` : 'Deploy update'}
      description="The robot downloads the package, verifies its signature and installs it on its next safe stop."
      submitLabel="Deploy update"
      submittingLabel="Deploying…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Robot" required error={robotError}
        hint={robots.options.length === 0 && !robots.isLoading ? 'No robots registered yet.' : undefined}>
        <Select placeholder={robots.isLoading ? 'Loading robots…' : 'Choose a robot…'}
          options={robots.options} value={robotId} onChange={(e) => setRobotId(e.target.value)} />
      </FormField>
      <FormField label="Current version on the robot" aside="Optional" hint="Recorded so the update can be rolled back.">
        <Input value={previousVersion} onChange={(e) => setPreviousVersion(e.target.value)} placeholder="e.g. 1.3.2" />
      </FormField>
    </FormModal>
  );
}
