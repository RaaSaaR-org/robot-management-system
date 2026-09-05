/**
 * @file InitFromModelPicker.tsx
 * @description Picks the registered model (and optionally the epoch checkpoint)
 *              a training run continues from.
 * @feature training
 */

import { useCallback } from 'react';
import { cn } from '@/shared/utils/cn';
import { ModelVersionCard } from '@/features/deployment/components/ModelVersionCard';
import type { ModelVersion } from '@/features/deployment/types';
import { useInitFromModelVersions, type InitFromCandidate } from '../hooks/useInitFromModelVersions';
import type { BaseModel, InitFromSelection } from '../types';

export interface InitFromModelPickerProps {
  /** Architecture the run trains; only models of it can be continued. */
  baseModel: BaseModel;
  /** Label of `baseModel` as the Model step spells it, for the empty state. */
  baseModelLabel: string;
  value: InitFromSelection | null;
  onChange: (selection: InitFromSelection | null) => void;
}

/**
 * The headline `ModelVersionCard` prints, mirrored here because the picker
 * stores the name in the wizard's form: the review step names the starting
 * model after the picker is gone, and it must be the same name the operator
 * clicked. (TASK-238's `getDisplayName`, which the card keeps private.)
 */
function modelDisplayName(version: ModelVersion): string {
  return version.name || version.skill?.name || `Model ${version.version}`;
}

/** "Epoch 14 · loss 0.081" — the loss only when the worker reported one. */
function checkpointLabel(epoch: number, metrics: Record<string, number>): string {
  const loss = metrics.loss;
  return typeof loss === 'number' ? `Epoch ${epoch} · loss ${loss}` : `Epoch ${epoch}`;
}

export function InitFromModelPicker({
  baseModel,
  baseModelLabel,
  value,
  onChange,
}: InitFromModelPickerProps) {
  const { candidates, hiddenCount, isLoading } = useInitFromModelVersions(baseModel);

  const selectModel = useCallback(
    (candidate: InitFromCandidate) => {
      onChange({
        modelVersionId: candidate.version.id,
        modelName: modelDisplayName(candidate.version),
        modelBaseModel: candidate.baseModel,
        // A newly picked model starts from its final weights; the dropdown
        // below narrows that to an epoch.
        checkpointId: null,
        checkpointEpoch: null,
      });
    },
    [onChange]
  );

  const selected = candidates.find((c) => c.version.id === value?.modelVersionId) ?? null;

  const selectCheckpoint = useCallback(
    (checkpointId: string) => {
      if (!value || !selected) return;
      const checkpoint = selected.checkpoints.find((c) => c.id === checkpointId) ?? null;
      onChange({
        ...value,
        checkpointId: checkpoint?.id ?? null,
        checkpointEpoch: checkpoint?.epoch ?? null,
      });
    },
    [onChange, selected, value]
  );

  return (
    <div className="space-y-3" data-testid="init-from-picker">
      {isLoading && (
        <p className="py-6 text-center text-sm text-theme-secondary">Loading registered models…</p>
      )}

      {!isLoading && candidates.length === 0 && (
        <p className="py-6 text-center text-sm text-theme-secondary" data-testid="init-from-empty">
          No registered model was trained as {baseModelLabel}. Register one on the Models page, or
          start from the foundation model.
        </p>
      )}

      {candidates.length > 0 && (
        <div
          className="grid gap-3 max-h-[260px] overflow-y-auto"
          role="radiogroup"
          aria-label="Starting model"
        >
          {candidates.map((candidate) => {
            const name = modelDisplayName(candidate.version);
            const isSelected = candidate.version.id === value?.modelVersionId;
            return (
              <label
                key={candidate.version.id}
                className={cn(
                  'block cursor-pointer rounded-lg',
                  'focus-within:outline-none focus-within:ring-2 focus-within:ring-cobalt-500/60'
                )}
              >
                <input
                  type="radio"
                  name="init-from-model"
                  className="sr-only"
                  aria-label={`Start from ${name}`}
                  checked={isSelected}
                  onChange={() => selectModel(candidate)}
                />
                <ModelVersionCard version={candidate.version} compact selected={isSelected} />
              </label>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="text-xs text-theme-tertiary">
          {hiddenCount} registered {hiddenCount === 1 ? 'model is' : 'models are'} not shown here:
          only a model trained as {baseModelLabel} can be continued by this run.
        </p>
      )}

      {selected && selected.checkpoints.length > 0 && (
        <label className="block text-sm text-theme-secondary">
          Checkpoint
          <select
            className="mt-1 block w-full rounded-brand border border-theme-secondary/30 bg-theme-primary px-2 py-1 text-sm text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500"
            value={value?.checkpointId ?? ''}
            onChange={(e) => selectCheckpoint(e.target.value)}
          >
            <option value="">Final weights (end of the run)</option>
            {selected.checkpoints.map((checkpoint) => (
              <option key={checkpoint.id} value={checkpoint.id}>
                {checkpointLabel(checkpoint.epoch, checkpoint.metrics)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
