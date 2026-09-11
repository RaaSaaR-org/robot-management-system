/**
 * @file NewScanModal.tsx
 * @description "New scan" FormModal of the Digital Twin gallery: name the site
 *   and pick the scan-capable robot that sweeps it. Creates the twin and hands
 *   it back so the page can open the viewer. With no scan-capable robot the
 *   form says so calmly and the submit stays disabled.
 * @feature digitaltwin
 */

import { useEffect, useMemo, useState } from 'react';
import { FormField, FormModal, Input, Select, errorMessage, toast } from '@/shared/components/ui';
import type { Robot } from '@/features/robots/types/robots.types';
import { useTwinStore } from '../store/twinStore';
import type { DigitalTwinDTO } from '../types/twin.types';

export interface NewScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Scan-capable robots (G1 with a Livox MID-360). */
  robots: Robot[];
  /** Number used in the suggested name ("‹robot› room N"). */
  nextIndex: number;
  onCreated: (twin: DigitalTwinDTO) => void;
}

export function NewScanModal({ isOpen, onClose, robots, nextIndex, onCreated }: NewScanModalProps) {
  const createTwin = useTwinStore((s) => s.createTwin);
  const [name, setName] = useState('');
  const [robotId, setRobotId] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const robotOptions = useMemo(
    () => robots.map((r) => ({ value: r.id, label: `${r.name} · ${r.status}` })),
    [robots],
  );

  // Reset whenever the modal opens; preselect the first robot.
  useEffect(() => {
    if (!isOpen) return;
    const first = robots[0];
    setRobotId(first?.id ?? '');
    setName(first ? `${first.name} room ${nextIndex}` : '');
    setNameTouched(false);
    setNameError(undefined);
    setFormError(undefined);
    // Only on open — a robot list refresh must not wipe typed input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const pickRobot = (id: string) => {
    setRobotId(id);
    const robot = robots.find((r) => r.id === id);
    if (robot && !nameTouched) setName(`${robot.name} room ${nextIndex}`);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setNameError('Give the site a name.');
      return;
    }
    if (!robotId) return;
    setSaving(true);
    setFormError(undefined);
    try {
      const twin = await createTwin({ name: name.trim(), robotId });
      toast.success('Site created', { description: twin.name });
      onCreated(twin);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const noRobot = robots.length === 0;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="New scan"
      description="The robot sweeps the room with its LiDAR; you watch it fill in live."
      submitLabel="Create site"
      submittingLabel="Creating…"
      isSubmitting={saving}
      submitDisabled={noRobot}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Name" required error={nameError}>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
            if (nameError) setNameError(undefined);
          }}
          placeholder="e.g. Assembly hall"
        />
      </FormField>
      <FormField label="Robot" required hint={noRobot ? undefined : 'Only robots with a 3D LiDAR are listed.'}>
        <Select
          options={robotOptions}
          placeholder={noRobot ? 'No scan-capable robot' : undefined}
          value={robotId}
          onChange={(e) => pickRobot(e.target.value)}
          disabled={noRobot}
        />
      </FormField>
      {noRobot && (
        <p className="rounded-control border border-line-subtle bg-inset px-3 py-2.5 text-[13px] text-ink-secondary" role="status">
          No scan-capable robot online. A G1 with a Livox MID-360 can sweep a room.
        </p>
      )}
    </FormModal>
  );
}
