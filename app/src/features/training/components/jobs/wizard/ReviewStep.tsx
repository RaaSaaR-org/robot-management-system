/**
 * @file ReviewStep.tsx
 * @description The last step of the New training job wizard: what will be submitted, and what blocks it
 * @feature training
 */

import { KeyValueList } from '@/shared/components/ui';
import type { SimScene } from '@/features/simulation/types';
import type { CompatibilityReport, Dataset } from '../../../types';
import { DatasetCompatibilityPanel } from '../../DatasetCompatibilityPanel';
import { StepSection } from './WizardSteps';
import { FINE_TUNE_OPTIONS, badWeights, describeStartingPoint, type FormState } from './wizardModel';

export interface ReviewStepProps {
  form: FormState;
  datasets: Dataset[];
  scene: SimScene | undefined;
  onCompatibility: (report: CompatibilityReport | null) => void;
}

export function ReviewStep({ form, datasets, scene, onCompatibility }: ReviewStepProps) {
  const bad = badWeights(form);
  const total = form.mixture.reduce((sum, m) => sum + (m.weight || 0), 0);
  const nameOf = (id: string) => datasets.find((d) => d.id === id)?.name ?? id;
  const hp = form.hyperparameters;
  const simRl = form.kind === 'sim_rl';

  return (
    <StepSection title="Review" description="Check the run before it is queued.">
      {bad.length > 0 && (
        <div data-testid="bad-weight-notice" className="rounded-control border border-signal-unknown/30 bg-signal-unknown/10 px-3 py-2 text-sm text-ink-primary">
          {bad.map((m) => nameOf(m.datasetId)).join(', ')} {bad.length === 1 ? 'has' : 'have'} a weight that is not a
          positive number. A weight is how often the trainer samples that dataset, so zero would silently leave it
          out of the run. Go back and set it, or remove the dataset from the mixture.
        </div>
      )}

      <div data-testid="review-summary" className="flex flex-col gap-4 rounded-control bg-inset p-4">
        {simRl ? (
          <KeyValueList
            items={[
              { label: 'Type', value: 'Sim-RL policy' },
              { label: 'Scene', value: scene?.name },
              { label: 'Embodiment', value: scene?.embodimentTag },
              { label: 'Priority', value: form.priority },
            ]}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div data-testid="review-mixture" className="text-sm">
              <div className="text-xs text-ink-tertiary">
                {form.mixture.length > 1 ? `Mixture (${form.mixture.length} datasets)` : 'Dataset'}
              </div>
              {form.mixture.map((member) => (
                <p key={member.datasetId} className="font-medium text-ink-primary">
                  {nameOf(member.datasetId)}
                  {form.mixture.length > 1 && (
                    <span className="ml-2 font-normal text-ink-secondary">
                      weight {member.weight}
                      {total > 0 && ` · ${Math.round((member.weight / total) * 100)}%`}
                    </span>
                  )}
                </p>
              ))}
            </div>
            <div data-testid="review-starts-from" className="text-sm">
              <div className="text-xs text-ink-tertiary">Starts from</div>
              <p className="font-medium text-ink-primary">{describeStartingPoint(form)}</p>
            </div>
            <div className="text-sm">
              <div className="text-xs text-ink-tertiary">Fine-tuning method</div>
              <p className="font-medium text-ink-primary">{FINE_TUNE_OPTIONS.find((m) => m.value === form.fineTuneMethod)?.label}</p>
            </div>
            <div className="text-sm">
              <div className="text-xs text-ink-tertiary">Priority</div>
              <p className="font-medium capitalize text-ink-primary">{form.priority}</p>
            </div>
          </div>
        )}
        <div className="border-t border-line-subtle pt-4">
          <KeyValueList
            columns={3}
            items={[
              { label: 'Learning rate', value: hp.learning_rate },
              { label: 'Batch size', value: hp.batch_size },
              { label: simRl ? 'Iterations' : 'Epochs', value: hp.epochs },
              ...(!simRl && hp.max_steps != null ? [{ label: 'Max steps', value: hp.max_steps }] : []),
              ...(!simRl && form.fineTuneMethod === 'lora' && hp.lora_rank ? [{ label: 'LoRA rank', value: hp.lora_rank }] : []),
              { label: 'GPU', value: form.gpuType === 'any' ? 'Any available' : form.gpuType.toUpperCase() },
            ]}
          />
        </div>
      </div>

      {/* What training these together means, before it is submitted rather than in a log afterwards. */}
      {!simRl && form.mixture.length > 1 && (
        <DatasetCompatibilityPanel datasetIds={form.mixture.map((m) => m.datasetId)} onReport={onCompatibility} />
      )}
    </StepSection>
  );
}
