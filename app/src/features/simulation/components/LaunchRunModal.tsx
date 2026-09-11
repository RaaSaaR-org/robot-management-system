/**
 * @file LaunchRunModal.tsx
 * @description New sim run: pick a scene, label the model, set the rollouts, start
 * @feature simulation
 */

import { useEffect, useMemo, useState } from 'react';
import { FormField, FormModal, InfoIcon, Input, Select, StatusTag, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { simulationApi } from '../api/simulationApi';
import type { SimJob, SimScene } from '../types';
import { GLOSSARY, backendLabel, formatSeconds } from './simFormat';

export interface LaunchRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  scenes: SimScene[];
  /** Scene to preselect (a scene card, or a ?sceneId / ?twinId deep link). */
  initialSceneId?: string | null;
  onStarted: (job: SimJob) => void;
}

/** ~35 s per episode for MuJoCo + remote VLA inference (observed baseline). */
const SECONDS_PER_EPISODE = 35;

const label = (text: string, info: string) => (
  <span className="inline-flex items-center gap-1.5">
    {text} <InfoIcon content={info} />
  </span>
);

export function LaunchRunModal({ isOpen, onClose, scenes, initialSceneId, onStarted }: LaunchRunModalProps) {
  const [modelId, setModelId] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [rollouts, setRollouts] = useState('10');
  const [errors, setErrors] = useState<{ modelId?: string; sceneId?: string; rollouts?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSceneId(initialSceneId ?? '');
    setErrors({});
    setFormError(undefined);
  }, [isOpen, initialSceneId]);

  const scene = useMemo(() => scenes.find((s) => s.id === sceneId), [scenes, sceneId]);
  const count = Number(rollouts);

  const submit = async () => {
    const next: typeof errors = {};
    if (!modelId.trim()) next.modelId = 'Give the run a model label.';
    if (!scene) next.sceneId = 'Choose a scene.';
    if (!Number.isInteger(count) || count < 1 || count > 100) next.rollouts = 'Between 1 and 100.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !scene) return;
    setSaving(true);
    setFormError(undefined);
    try {
      // Scene-based submit: backend and embodiment are resolved server-side.
      const job = await simulationApi.submitJob({ modelId: modelId.trim(), sceneId: scene.id, rolloutCount: count });
      toast.success('Sim run started', { description: `${modelId.trim()} on ${scene.name}` });
      setModelId('');
      onStarted(job);
      onClose();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to start the run'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="New sim run"
      description="Runs a policy against a physics scene and reports how often it completes the task. No robot moves."
      submitLabel="Start sim run"
      submittingLabel="Starting…"
      isSubmitting={saving}
      error={formError}
      onSubmit={submit}
      noValidate
    >
      <FormField label={label('Scene', GLOSSARY.scene)} required error={errors.sceneId}>
        <Select
          placeholder="Choose a scene…"
          value={sceneId}
          onChange={(e) => setSceneId(e.target.value)}
          options={scenes.map((s) => ({ value: s.id, label: `${s.name} · ${backendLabel(s.backend)}` }))}
        />
      </FormField>
      {scene && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
          <StatusTag tone="sim" size="sm">{backendLabel(scene.backend)}</StatusTag>
          <span>{scene.source === 'twin' ? 'Scanned room' : 'Built-in scene'} · {scene.embodimentTag}</span>
        </div>
      )}
      <FormField label={label('Model label', GLOSSARY.modelId)} required error={errors.modelId} hint="The VLA server loads the model set in VLA_MODEL_PATH.">
        <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="e.g. smolvla-so101-v2" />
      </FormField>
      <FormField
        label={label('Rollouts', GLOSSARY.rolloutCount)}
        error={errors.rollouts}
        hint={count >= 1 ? `About ${formatSeconds(count * SECONDS_PER_EPISODE)} at ${SECONDS_PER_EPISODE} s per episode. Progress keeps running if you leave.` : undefined}
      >
        <Input type="number" min={1} max={100} value={rollouts} onChange={(e) => setRollouts(e.target.value)} />
      </FormField>
    </FormModal>
  );
}
