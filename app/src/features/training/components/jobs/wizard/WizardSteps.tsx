/**
 * @file WizardSteps.tsx
 * @description The choice steps of the New training job wizard: type, scene, datasets, model, resources
 * @feature training
 */

import type { ReactNode } from 'react';
import { Input, SkeletonRows, StatusTag } from '@/shared/components/ui';
import type { SimScene } from '@/features/simulation/types';
import type { BaseModel, Dataset, FineTuneMethod, InitFromSelection, WeightsSource } from '../../../types';
import { InitFromModelPicker } from '../../InitFromModelPicker';
import { ChoiceCard, choiceSurface } from '../ChoiceCard';
import { BASE_MODEL_OPTIONS, FINE_TUNE_OPTIONS, GPU_OPTIONS, PRIORITY_OPTIONS, type FormState } from './wizardModel';

type Patch = (patch: Partial<FormState>) => void;

/** A titled group of fields inside a step. */
export function StepSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-ink-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function TypeStep({ form, patch }: { form: FormState; patch: Patch }) {
  return (
    <StepSection title="What do you want to train?" description="Supervised fine-tunes a VLA on recorded datasets. Sim-RL trains a control policy in a simulation scene.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Training type">
        <ChoiceCard data-testid="wizard-kind-supervised" selected={form.kind === 'supervised'} onSelect={() => patch({ kind: 'supervised' })} title="Supervised fine-tune" description="Fine-tune a VLA model (SmolVLA, Pi0, …) on a validated dataset." />
        <ChoiceCard data-testid="wizard-kind-sim_rl" selected={form.kind === 'sim_rl'} onSelect={() => patch({ kind: 'sim_rl' })} title="Sim-RL policy" aside={<StatusTag tone="sim" size="sm">Beta</StatusTag>} description="Train a navigation or locomotion policy for a robot in a simulation scene." />
      </div>
    </StepSection>
  );
}

export function SceneStep({ form, patch, scenes, loading }: { form: FormState; patch: Patch; scenes: SimScene[]; loading: boolean }) {
  return (
    <StepSection title="Scene" description="Digital-twin scenes replicate a real room; the navigation goal is part of the scene.">
      <div className="grid max-h-[320px] gap-2 overflow-y-auto" data-testid="scene-list" role="group" aria-label="Simulation scene">
        {loading && scenes.length === 0 && <SkeletonRows rows={3} columns={2} dense />}
        {scenes.map((scene) => (
          <ChoiceCard
            key={scene.id}
            data-testid={`scene-option-${scene.id}`}
            selected={form.sceneId === scene.id}
            onSelect={() => patch({ sceneId: scene.id })}
            title={scene.name}
            description={scene.description ?? undefined}
            aside={<StatusTag tone="sim" size="sm">{scene.source === 'twin' ? 'Digital twin' : 'Built-in'}</StatusTag>}
          />
        ))}
        {!loading && scenes.length === 0 && (
          <p className="rounded-control bg-inset px-3 py-6 text-center text-sm text-ink-secondary">
            No simulation scenes yet. Build a digital twin or add a built-in scene first.
          </p>
        )}
      </div>
    </StepSection>
  );
}

export function DatasetStep({ form, datasets, onToggle, onWeight }: { form: FormState; datasets: Dataset[]; onToggle: (id: string) => void; onWeight: (id: string, w: number) => void }) {
  const ready = datasets.filter((d) => d.status === 'ready');
  return (
    <StepSection title="Datasets" description="Pick one dataset, or several to train as a mixture. A weight is how often a dataset is sampled relative to the others.">
      <div className="grid max-h-[340px] gap-2 overflow-y-auto" role="group" aria-label="Dataset">
        {ready.map((dataset) => {
          const member = form.mixture.find((m) => m.datasetId === dataset.id);
          return (
            <div key={dataset.id} className={`${choiceSurface(!!member)} flex items-center gap-3 p-3`}>
              <button type="button" aria-pressed={!!member} onClick={() => onToggle(dataset.id)} className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <span className="block truncate text-sm font-medium text-ink-primary">{dataset.name}</span>
                <span className="text-xs text-ink-secondary">
                  {dataset.totalFrames.toLocaleString()} frames · {dataset.demonstrationCount} episodes
                </span>
              </button>
              {member && (
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  size="sm"
                  fullWidth={false}
                  className="w-20"
                  value={member.weight}
                  aria-label={`Weight for ${dataset.name}`}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    onWeight(dataset.id, Number.isFinite(next) ? next : 1);
                  }}
                />
              )}
            </div>
          );
        })}
        {ready.length === 0 && (
          <p className="rounded-control bg-inset px-3 py-6 text-center text-sm text-ink-secondary">
            No ready datasets. Import or record one on the Datasets page first.
          </p>
        )}
      </div>
    </StepSection>
  );
}

export function ModelStep(props: {
  form: FormState;
  onBaseModel: (m: BaseModel) => void;
  onWeightsSource: (s: WeightsSource) => void;
  onInitFrom: (s: InitFromSelection | null) => void;
  onMethod: (m: FineTuneMethod) => void;
}) {
  const { form } = props;
  const label = BASE_MODEL_OPTIONS.find((m) => m.value === form.baseModel)?.label ?? form.baseModel;
  return (
    <div className="flex flex-col gap-6">
      <StepSection title="Base model" description="The architecture to train. Continuing an existing model keeps its architecture.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Base model">
          {BASE_MODEL_OPTIONS.map((m) => (
            <ChoiceCard key={m.value} selected={form.baseModel === m.value} onSelect={() => props.onBaseModel(m.value)} title={m.label} description={m.description} />
          ))}
        </div>
      </StepSection>
      <StepSection title="Starting weights" description="Start from the foundation model, or continue a model that already exists.">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Starting weights">
          <ChoiceCard data-testid="weights-source-foundation" selected={form.weightsSource === 'foundation'} onSelect={() => props.onWeightsSource('foundation')} title="Foundation model" description={`Train from the published ${label} weights.`} />
          <ChoiceCard data-testid="weights-source-existing" selected={form.weightsSource === 'existing'} onSelect={() => props.onWeightsSource('existing')} title="Continue from an existing model" description="A registered model, or one of its epoch checkpoints." />
        </div>
        {form.weightsSource === 'existing' && (
          <InitFromModelPicker baseModel={form.baseModel} baseModelLabel={label} value={form.initFrom} onChange={props.onInitFrom} />
        )}
      </StepSection>
      <StepSection title="Fine-tuning method">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Fine-tuning method">
          {FINE_TUNE_OPTIONS.map((m) => (
            <ChoiceCard key={m.value} selected={form.fineTuneMethod === m.value} onSelect={() => props.onMethod(m.value)} title={m.label} description={m.description} />
          ))}
        </div>
      </StepSection>
    </div>
  );
}

export function ResourcesStep({ form, patch }: { form: FormState; patch: Patch }) {
  return (
    <div className="flex flex-col gap-6">
      <StepSection title="GPU" description="Prefer a GPU type, or take any available worker.">
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="GPU preference">
          {GPU_OPTIONS.map((o) => (
            <ChoiceCard key={o.value} selected={form.gpuType === o.value} onSelect={() => patch({ gpuType: o.value })} title={o.label} />
          ))}
        </div>
      </StepSection>
      <StepSection title="Priority" description="Higher priority jobs are scheduled first.">
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Priority">
          {PRIORITY_OPTIONS.map((o) => (
            <ChoiceCard key={o.value} selected={form.priority === o.value} onSelect={() => patch({ priority: o.value })} title={o.label} />
          ))}
        </div>
      </StepSection>
    </div>
  );
}
