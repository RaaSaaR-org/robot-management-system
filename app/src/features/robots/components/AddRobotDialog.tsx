/**
 * @file AddRobotDialog.tsx
 * @description Register robot FormModal: the robot joins the fleet from its agent URL.
 *   Exported as RegisterRobotModal (and AddRobotDialog for compatibility).
 * @feature robots
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, toast } from '@/shared/components/ui';
import { useRobotsStore } from '../store/robotsStore';
import type { Robot } from '../types/robots.types';

export interface RegisterRobotModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (robot: Robot) => void;
}

/** FormModal that registers a robot by its agent URL. */
export function RegisterRobotModal({ isOpen, onClose, onSuccess }: RegisterRobotModalProps) {
  const registerRobot = useRobotsStore((s) => s.registerRobot);
  const clearError = useRobotsStore((s) => s.clearError);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setUrl('');
    setUrlError(undefined);
    setFormError(undefined);
  }, [isOpen]);

  const handleSubmit = async () => {
    const value = url.trim();
    if (!value) {
      setUrlError('Enter the agent URL.');
      return;
    }
    setSaving(true);
    setUrlError(undefined);
    setFormError(undefined);
    try {
      const robot = await registerRobot(value);
      toast.success('Robot registered', { description: robot.name });
      onSuccess?.(robot);
      onClose();
    } catch (err) {
      // The modal shows the failure itself; don't leave it in the list's error state.
      clearError();
      const detail = err instanceof Error ? err.message : String(err);
      const generic = !detail || /unexpected error/i.test(detail);
      setFormError(
        `Couldn't register the robot. Check that its agent is running at ${value}.` +
          (generic ? '' : ` (${detail})`),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Register robot"
      description="Add a robot to the fleet by pointing at its running agent."
      submitLabel="Register robot"
      submittingLabel="Registering…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField
        label="Agent URL"
        required
        error={urlError}
        hint="The base URL of the robot agent, e.g. http://localhost:41243. The robot registers itself and reports its capabilities over A2A."
      >
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:41243"
          autoComplete="off"
        />
      </FormField>
    </FormModal>
  );
}

/** @deprecated Use RegisterRobotModal. */
export const AddRobotDialog = RegisterRobotModal;
