/**
 * @file TrainingJobWizard.tsx
 * @description New training job: a stepped modal (type, datasets or scene, model, settings, resources, review)
 * @feature training
 */

import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button, Modal, toast } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { getErrorMessage } from '@/shared/utils';
import { useSimulationStore, selectScenes, selectScenesLoading } from '@/features/simulation/store/simulationStore';
import { HyperparameterForm, getDefaultHyperparameters } from './HyperparameterForm';
import { DatasetStep, ModelStep, ResourcesStep, SceneStep, StepSection, TypeStep } from './jobs/wizard/WizardSteps';
import { ReviewStep } from './jobs/wizard/ReviewStep';
import { INITIAL_FORM, TRAINING_PRESETS, badWeights, stepsFor, type FormState, type Step } from './jobs/wizard/wizardModel';
import type {
  BaseModel,
  CompatibilityReport,
  Dataset,
  FineTuneMethod,
  InitFromSelection,
  MixtureMemberInput,
  SubmitSimRlJobInput,
  SubmitTrainingJobInput,
  WeightsSource,
} from '../types';

export interface TrainingJobWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: SubmitTrainingJobInput | SubmitSimRlJobInput) => Promise<void>;
  datasets: Dataset[];
  isSubmitting?: boolean;
  /** Datasets picked elsewhere (the Datasets page's selection), pre-filled. */
  initialMixture?: MixtureMemberInput[];
}

export function TrainingJobWizard({ isOpen, onClose, onSubmit, datasets, isSubmitting, initialMixture }: TrainingJobWizardProps) {
  const [step, setStep] = useState<Step>('type');
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [compatibility, setCompatibility] = useState<CompatibilityReport | null>(null);
  const patch = useCallback((p: Partial<FormState>) => setForm((prev) => ({ ...prev, ...p })), []);

  // The scene registry (shared with the Simulation tab) for the sim-RL picker.
  const scenes = useSimulationStore(selectScenes);
  const scenesLoading = useSimulationStore(selectScenesLoading);
  const fetchScenes = useSimulationStore((s) => s.fetchScenes);
  useEffect(() => {
    if (isOpen && scenes.length === 0) void fetchScenes();
  }, [isOpen, scenes.length, fetchScenes]);

  // The Datasets page's selection, as a value that only changes when the
  // selection does — an inline array prop is a new object every render.
  const seeded = (initialMixture ?? []).map((m) => `${m.datasetId}:${m.weight ?? 1}`).join(',');
  useEffect(() => {
    if (!isOpen || !seeded) return;
    const members = seeded.split(',').map((entry) => {
      const [datasetId, weight] = entry.split(':');
      return { datasetId, weight: Number(weight) || 1 };
    });
    setForm((prev) => ({ ...prev, kind: 'supervised', mixture: members, datasetId: members[0].datasetId }));
    // Straight to the datasets: the person got here by choosing them.
    setStep('dataset');
  }, [isOpen, seeded]);

  const steps = stepsFor(form.kind);
  const index = steps.findIndex((s) => s.id === step);

  const close = useCallback(() => {
    setStep('type');
    setForm(INITIAL_FORM);
    setError(null);
    setCompatibility(null);
    onClose();
  }, [onClose]);

  // Recompute the list from form.kind: the kind can change on step 0.
  const go = (delta: 1 | -1) => {
    const list = stepsFor(form.kind);
    const next = list[list.findIndex((s) => s.id === step) + delta];
    if (next) setStep(next.id);
  };

  const toggleMember = (datasetId: string) => {
    setForm((prev) => {
      const exists = prev.mixture.some((m) => m.datasetId === datasetId);
      const mixture = exists ? prev.mixture.filter((m) => m.datasetId !== datasetId) : [...prev.mixture, { datasetId, weight: 1 }];
      return { ...prev, mixture, datasetId: mixture[0]?.datasetId ?? '' };
    });
    setCompatibility(null);
  };
  const setWeight = (datasetId: string, weight: number) =>
    setForm((prev) => ({ ...prev, mixture: prev.mixture.map((m) => (m.datasetId === datasetId ? { ...m, weight } : m)) }));

  // Changing the architecture drops the picked model: the server refuses a run
  // whose baseModel differs from the weights it starts from. (TASK-239)
  const onBaseModel = (value: BaseModel) =>
    setForm((prev) => (prev.baseModel === value ? prev : { ...prev, baseModel: value, initFrom: null }));
  const onWeightsSource = (source: WeightsSource) =>
    setForm((prev) => ({ ...prev, weightsSource: source, initFrom: source === 'foundation' ? null : prev.initFrom }));
  const onInitFrom = (initFrom: InitFromSelection | null) => patch({ initFrom });
  const onMethod = (method: FineTuneMethod) => patch({ fineTuneMethod: method, hyperparameters: getDefaultHyperparameters(method) });

  const canProceed = (() => {
    switch (step) {
      case 'dataset':
        return form.mixture.length > 0;
      case 'model':
        // "Continue from an existing model" without one would silently fall
        // back to the foundation weights. (TASK-239)
        return form.weightsSource === 'foundation' || !!form.initFrom;
      case 'scene':
        return !!form.sceneId;
      case 'hyperparams':
        return form.hyperparameters.learning_rate > 0 && form.hyperparameters.epochs > 0;
      default:
        return true;
    }
  })();

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const gpuRequirements = { type: form.gpuType };
      if (form.kind === 'sim_rl') {
        await onSubmit({ kind: 'sim_rl', sceneId: form.sceneId, hyperparameters: form.hyperparameters, gpuRequirements, priority: form.priority });
      } else {
        const members = form.mixture;
        const initFrom = form.weightsSource === 'existing' ? form.initFrom : null;
        await onSubmit({
          datasetId: members[0]?.datasetId ?? form.datasetId,
          baseModel: form.baseModel,
          fineTuneMethod: form.fineTuneMethod,
          hyperparameters: form.hyperparameters,
          gpuRequirements,
          priority: form.priority,
          // A single dataset stays exactly the request it was before mixtures.
          ...(members.length > 1 ? { mixture: members.map((m) => ({ datasetId: m.datasetId, weight: m.weight })) } : {}),
          // One set of starting weights: a checkpoint replaces its model. (TASK-239)
          ...(initFrom?.checkpointId
            ? { initFromCheckpointId: initFrom.checkpointId }
            : initFrom
              ? { initFromModelVersionId: initFrom.modelVersionId }
              : {}),
        });
      }
      toast.success('Training job created', { description: 'It starts as soon as a worker is free.' });
      close();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to submit training job'));
    } finally {
      setSubmitting(false);
    }
  };

  const blocked = compatibility?.verdict === 'incompatible' || badWeights(form).length > 0;

  const footer = (
    <div className="flex w-full items-center justify-end gap-2">
      <Button variant="ghost" onClick={close} className="mr-auto">Cancel</Button>
      {index > 0 && <Button variant="secondary" onClick={() => go(-1)}>Back</Button>}
      {step === 'review' ? (
        // The server refuses an incompatible mixture and a non-positive weight;
        // refusing both here keeps the reason on screen.
        <Button onClick={() => void submit()} isLoading={isSubmitting || submitting} loadingText="Creating…" disabled={blocked}>
          Create training job
        </Button>
      ) : (
        <Button onClick={() => go(1)} disabled={!canProceed}>Next</Button>
      )}
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={close} title="New training job" size="xl" closeOnBackdrop={false} footer={footer}>
      <div className="flex flex-col gap-6">
        <StepIndicator steps={steps} index={index} onJump={(id) => setStep(id)} />
        <div className="min-h-[280px]">
          {step === 'type' && <TypeStep form={form} patch={patch} />}
          {step === 'scene' && <SceneStep form={form} patch={patch} scenes={scenes} loading={scenesLoading} />}
          {step === 'dataset' && <DatasetStep form={form} datasets={datasets} onToggle={toggleMember} onWeight={setWeight} />}
          {step === 'model' && <ModelStep form={form} onBaseModel={onBaseModel} onWeightsSource={onWeightsSource} onInitFrom={onInitFrom} onMethod={onMethod} />}
          {step === 'hyperparams' && (
            <StepSection title="Settings" description="Start from a preset, then adjust. Defaults suit the chosen fine-tuning method.">
              <div className="flex flex-wrap gap-2">
                {Object.entries(TRAINING_PRESETS).map(([key, preset]) => (
                  <Button key={key} variant="secondary" size="sm" title={preset.description}
                    onClick={() => patch({ hyperparameters: { ...form.hyperparameters, ...preset.hyperparameters } })}>
                    {preset.label}
                  </Button>
                ))}
              </div>
              <HyperparameterForm values={form.hyperparameters} onChange={(hyperparameters) => patch({ hyperparameters })} fineTuneMethod={form.fineTuneMethod} />
            </StepSection>
          )}
          {step === 'gpu' && <ResourcesStep form={form} patch={patch} />}
          {step === 'review' && (
            <ReviewStep form={form} datasets={datasets} scene={scenes.find((s) => s.id === form.sceneId)} onCompatibility={setCompatibility} />
          )}
        </div>
        {error && (
          <div role="alert" className="rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-3 py-2 text-sm text-ink-primary">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function StepIndicator({ steps, index, onJump }: { steps: { id: Step; label: string }[]; index: number; onJump: (id: Step) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Steps">
      {steps.map((s, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => done && onJump(s.id)}
              disabled={!done}
              aria-current={current ? 'step' : undefined}
              aria-label={`${s.label}${done ? ' (done)' : ''}`}
              className={cn(
                'flex items-center gap-2 rounded-control px-1 py-0.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                done && 'cursor-pointer hover:text-ink-primary'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  current ? 'bg-primary text-on-primary' : done ? 'bg-primary/15 text-primary' : 'bg-inset text-ink-tertiary'
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : i + 1}
              </span>
              <span className={cn('hidden sm:inline', current ? 'font-medium text-ink-primary' : 'text-ink-secondary')}>{s.label}</span>
            </button>
            {i < steps.length - 1 && <span aria-hidden className="h-px w-4 bg-line sm:w-6" />}
          </li>
        );
      })}
    </ol>
  );
}
