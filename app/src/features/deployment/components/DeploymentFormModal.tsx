/**
 * @file DeploymentFormModal.tsx
 * @description "New deployment" FormModal: pick a staged model, the strategy, canary stages,
 * target robot types and rollback thresholds; creates and starts the rollout.
 * @feature deployment
 */

import { useEffect, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import {
  Divider,
  FormField,
  FormModal,
  Input,
  LinkButton,
  SegmentedControl,
  Select,
  ToggleChip,
} from '@/shared/components/ui';
import {
  CANARY_PRESETS,
  DEFAULT_ROLLBACK_THRESHOLDS,
  type CanaryStage,
  type CreateDeploymentInput,
  type DeploymentStrategy,
  type ModelVersion,
  type RollbackThresholds,
} from '../types';
import { CanaryStagesField, validateStages, type CanaryPresetKey } from './CanaryStagesField';
import { errorMessage, modelName, strategyLabel } from './deploymentHelpers';

export interface DeploymentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Creates (and starts) the deployment; throw to keep the modal open with the error. */
  onSubmit: (input: CreateDeploymentInput) => Promise<void>;
  /** Model versions in staging — the ones that may be deployed. */
  modelVersions: ModelVersion[];
  modelsLoading?: boolean;
  /** Preselect this model version (from /deployments?new=<id>). */
  initialModelVersionId?: string;
  /** Robot types offered as targets. */
  robotTypes: string[];
}

const STRATEGIES: DeploymentStrategy[] = ['canary', 'rolling', 'blue_green'];

export function DeploymentFormModal({
  isOpen,
  onClose,
  onSubmit,
  modelVersions,
  modelsLoading = false,
  initialModelVersionId,
  robotTypes,
}: DeploymentFormModalProps) {
  const [modelId, setModelId] = useState('');
  const [strategy, setStrategy] = useState<DeploymentStrategy>('canary');
  const [stages, setStages] = useState<CanaryStage[]>([]);
  const [preset, setPreset] = useState<CanaryPresetKey>('standard');
  const [types, setTypes] = useState<string[]>([]);
  const [thresholds, setThresholds] = useState<RollbackThresholds>(DEFAULT_ROLLBACK_THRESHOLDS);
  const [errors, setErrors] = useState<{ model?: string; stages?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setModelId(initialModelVersionId ?? '');
    setStrategy('canary');
    setStages(CANARY_PRESETS.standard.stages.map((s) => ({ ...s })));
    setPreset('standard');
    setTypes([]);
    setThresholds(DEFAULT_ROLLBACK_THRESHOLDS);
    setErrors({});
    setFormError(undefined);
  }, [isOpen, initialModelVersionId]);

  const options = useMemo(() => {
    const opts = modelVersions.map((v) => ({ value: v.id, label: `${modelName(v)} · v${v.version}` }));
    // A preselected model that is not in staging stays visible so the user sees what was asked for.
    if (initialModelVersionId && !opts.some((o) => o.value === initialModelVersionId)) {
      opts.unshift({ value: initialModelVersionId, label: `Model #${initialModelVersionId.slice(0, 6)}` });
    }
    return opts;
  }, [modelVersions, initialModelVersionId]);

  const noModels = !modelsLoading && options.length === 0;

  const handleSubmit = async () => {
    const next = {
      model: modelId ? undefined : 'Choose the model to roll out.',
      stages: strategy === 'canary' ? validateStages(stages) : undefined,
    };
    setErrors(next);
    if (next.model || next.stages) return;
    setSaving(true);
    setFormError(undefined);
    try {
      await onSubmit({
        modelVersionId: modelId,
        strategy,
        targetRobotTypes: types.length ? types : undefined,
        canaryConfig: strategy === 'canary' ? { stages, successThreshold: 0.95, metricsWindow: 60 } : undefined,
        rollbackThresholds: thresholds,
      });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const setPct = (key: 'errorRate' | 'failureRate', value: string) =>
    setThresholds((t) => ({ ...t, [key]: (Number(value) || 0) / 100 }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="New deployment"
      description="Roll a staged model out to the fleet. Canary rollouts start small and widen stage by stage."
      submitLabel="Create deployment"
      submittingLabel="Creating…"
      submitDisabled={noModels}
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      size="lg"
      noValidate
    >
      {noModels ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-inset px-4 py-3">
          <p className="text-sm text-ink-secondary">No model is in staging. Register or train a model first.</p>
          <LinkButton to="/models" variant="ghost" size="sm" leftIcon={<Boxes className="h-4 w-4" strokeWidth={1.75} />}>
            Open models
          </LinkButton>
        </div>
      ) : (
        <FormField label="Model" required error={errors.model} hint="Only models in staging can be deployed.">
          <Select
            placeholder={modelsLoading ? 'Loading models…' : 'Choose a model…'}
            options={options}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          />
        </FormField>
      )}

      <FormField label="Strategy">
        <SegmentedControl
          label="Strategy"
          options={STRATEGIES.map((s) => ({ value: s, label: strategyLabel(s) }))}
          value={strategy}
          onChange={setStrategy}
        />
      </FormField>

      {strategy === 'canary' && (
        <FormField label="Canary stages" hint="Each stage holds its traffic share for the duration, then widens.">
          <CanaryStagesField
            stages={stages}
            preset={preset}
            error={errors.stages}
            onChange={(s, p) => {
              setStages(s);
              setPreset(p);
            }}
          />
        </FormField>
      )}

      {robotTypes.length > 0 && (
        <FormField label="Target robot types" aside="Optional" hint="None selected targets every compatible robot.">
          <div className="flex flex-wrap gap-2">
            {robotTypes.map((t) => (
              <ToggleChip
                key={t}
                active={types.includes(t)}
                onClick={() => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
              >
                {t}
              </ToggleChip>
            ))}
          </div>
        </FormField>
      )}

      <Divider label="Rollback thresholds" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Error rate (%)">
          <Input type="number" min={0} max={100} step={0.1} value={+(thresholds.errorRate * 100).toFixed(1)}
            onChange={(e) => setPct('errorRate', e.target.value)} />
        </FormField>
        <FormField label="P99 latency (ms)">
          <Input type="number" min={0} value={thresholds.latencyP99}
            onChange={(e) => setThresholds((t) => ({ ...t, latencyP99: Number(e.target.value) || 0 }))} />
        </FormField>
        <FormField label="Task failure rate (%)">
          <Input type="number" min={0} max={100} step={0.1} value={+(thresholds.failureRate * 100).toFixed(1)}
            onChange={(e) => setPct('failureRate', e.target.value)} />
        </FormField>
      </div>
    </FormModal>
  );
}
