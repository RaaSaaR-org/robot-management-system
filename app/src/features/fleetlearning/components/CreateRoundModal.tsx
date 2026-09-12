/**
 * @file CreateRoundModal.tsx
 * @description FormModal that creates a new federated learning round
 * @feature fleetlearning
 */

import { useEffect, useState } from 'react';
import { Divider, FormField, FormModal, Input, Select, Switch } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import type { AggregationMethod, CreateFederatedRoundRequest, FederatedRoundConfig, SelectionStrategy } from '../types/fleetlearning.types';
import { AGGREGATION_METHOD_LABELS, DEFAULT_ROUND_CONFIG, SELECTION_STRATEGY_LABELS } from '../types/fleetlearning.types';

export interface CreateRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Creates the round; a thrown error stays in the modal. */
  onSubmit: (data: CreateFederatedRoundRequest) => Promise<void>;
  isLoading?: boolean;
  /** Model versions to choose from; a free-text field when empty. */
  availableModels?: { value: string; label: string }[];
}

const toOptions = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export function CreateRoundModal({ isOpen, onClose, onSubmit, availableModels = [] }: CreateRoundModalProps) {
  const [model, setModel] = useState('');
  const [config, setConfig] = useState<FederatedRoundConfig>(DEFAULT_ROUND_CONFIG);
  const [privacy, setPrivacy] = useState(false);
  const [epsilon, setEpsilon] = useState('1');
  const [errors, setErrors] = useState<{ model?: string; participants?: string; epsilon?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setModel('');
    setConfig(DEFAULT_ROUND_CONFIG);
    setPrivacy(false);
    setEpsilon('1');
    setErrors({});
    setFormError(undefined);
  }, [isOpen]);

  const set = <K extends keyof FederatedRoundConfig>(key: K, value: FederatedRoundConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const num = (v: string, fallback: number) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : fallback);

  const handleSubmit = async () => {
    const next: typeof errors = {};
    if (!model.trim()) next.model = 'Choose the global model to train.';
    if (config.minParticipants < 1 || config.maxParticipants < config.minParticipants) {
      next.participants = 'Max must be at least min, and min at least 1.';
    }
    const eps = parseFloat(epsilon);
    if (privacy && !(eps > 0)) next.epsilon = 'Epsilon must be greater than 0.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setFormError(undefined);
    try {
      await onSubmit({
        globalModelVersion: model.trim(),
        config: { ...config, ...(privacy ? { privacyEpsilon: eps } : {}) },
      });
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
      title="New round"
      description="Selected robots train the global model on their own data; only the weight updates come back."
      submitLabel="Create round"
      submittingLabel="Creating…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      size="lg"
      noValidate
    >
      <FormField label="Global model version" required error={errors.model}>
        {availableModels.length > 0 ? (
          <Select placeholder="Choose a model…" options={availableModels} value={model} onChange={(e) => setModel(e.target.value)} />
        ) : (
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. 2026-09-04-g1-apple-pnp" />
        )}
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Aggregation">
          <Select options={toOptions(AGGREGATION_METHOD_LABELS)} value={config.aggregationMethod}
            onChange={(e) => set('aggregationMethod', e.target.value as AggregationMethod)} />
        </FormField>
        <FormField label="Selection strategy">
          <Select options={toOptions(SELECTION_STRATEGY_LABELS)} value={config.selectionStrategy}
            onChange={(e) => set('selectionStrategy', e.target.value as SelectionStrategy)} />
        </FormField>
        <FormField label="Min participants" error={errors.participants}>
          <Input type="number" min={1} value={config.minParticipants}
            onChange={(e) => set('minParticipants', Math.round(num(e.target.value, 1)))} />
        </FormField>
        <FormField label="Max participants">
          <Input type="number" min={1} value={config.maxParticipants}
            onChange={(e) => set('maxParticipants', Math.round(num(e.target.value, 1)))} />
        </FormField>
        <FormField label="Local epochs">
          <Input type="number" min={1} max={10} value={config.localEpochs}
            onChange={(e) => set('localEpochs', Math.round(num(e.target.value, 1)))} />
        </FormField>
        <FormField label="Learning rate">
          <Input type="number" min={0.00001} max={1} step={0.0001} value={config.localLearningRate}
            onChange={(e) => set('localLearningRate', num(e.target.value, 0.001))} />
        </FormField>
      </div>
      <Divider label="Privacy" />
      <Switch label="Secure aggregation" description="The server only sees the sum of the updates, never one robot's."
        checked={config.secureAggregation} onCheckedChange={(v) => set('secureAggregation', v)} />
      <Switch label="Differential privacy" description="Adds noise to each update and spends privacy budget (ε)."
        checked={privacy} onCheckedChange={setPrivacy} />
      {privacy && (
        <FormField label="Epsilon (ε) per round" error={errors.epsilon} hint="Lower is more private. 0.1 – 10.">
          <Input type="number" min={0.1} max={10} step={0.1} value={epsilon} onChange={(e) => setEpsilon(e.target.value)} />
        </FormField>
      )}
    </FormModal>
  );
}
