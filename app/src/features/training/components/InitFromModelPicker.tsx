/**
 * @file InitFromModelPicker.tsx
 * @description Picks the registered model (and optionally the epoch checkpoint)
 *              a training run continues from.
 * @feature training
 */

import { useCallback } from 'react';
import { FormField, Select, SkeletonRows } from '@/shared/components/ui';
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
 * The headline `ModelVersionCard` prints, mirrored here because the review
 * step names the starting model after the picker is gone, and it must be the
 * same name the operator clicked. (TASK-238's `getDisplayName`.)
 */
function modelDisplayName(version: ModelVersion): string {
  return version.name || version.skill?.name || `Model ${version.version}`;
}

/** "Epoch 14 · loss 0.081" — the loss only when the worker reported one. */
function checkpointLabel(epoch: number, metrics: Record<string, number>): string {
  const loss = metrics.loss;
  return typeof loss === 'number' ? `Epoch ${epoch} · loss ${loss}` : `Epoch ${epoch}`;
}

export function InitFromModelPicker({ baseModel, baseModelLabel, value, onChange }: InitFromModelPickerProps) {
  const { candidates, hiddenCount, isLoading } = useInitFromModelVersions(baseModel);

  const selectModel = useCallback(
    (candidate: InitFromCandidate) => {
      onChange({
        modelVersionId: candidate.version.id,
        modelName: modelDisplayName(candidate.version),
        modelBaseModel: candidate.baseModel,
        // A newly picked model starts from its final weights; the checkpoint
        // select below narrows that to an epoch.
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
      onChange({ ...value, checkpointId: checkpoint?.id ?? null, checkpointEpoch: checkpoint?.epoch ?? null });
    },
    [onChange, selected, value]
  );

  return (
    <div className="flex flex-col gap-3" data-testid="init-from-picker">
      {isLoading && <SkeletonRows rows={2} columns={2} dense />}

      {!isLoading && candidates.length === 0 && (
        <p className="rounded-control bg-inset px-3 py-4 text-center text-sm text-ink-secondary" data-testid="init-from-empty">
          No registered model was trained as {baseModelLabel}. Register one on the Models page, or
          start from the foundation model.
        </p>
      )}

      {candidates.length > 0 && (
        <div className="grid max-h-[260px] gap-3 overflow-y-auto" role="radiogroup" aria-label="Starting model">
          {candidates.map((candidate) => {
            const name = modelDisplayName(candidate.version);
            const isSelected = candidate.version.id === value?.modelVersionId;
            return (
              <label
                key={candidate.version.id}
                className="block cursor-pointer rounded-control focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary"
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
        <p className="text-xs text-ink-tertiary">
          {hiddenCount} registered {hiddenCount === 1 ? 'model is' : 'models are'} not shown here:
          only a model trained as {baseModelLabel} can be continued by this run.
        </p>
      )}

      {selected && selected.checkpoints.length > 0 && (
        <FormField label="Checkpoint">
          <Select
            value={value?.checkpointId ?? ''}
            onChange={(e) => selectCheckpoint(e.target.value)}
            options={[
              { value: '', label: 'Final weights (end of the run)' },
              ...selected.checkpoints.map((c) => ({ value: c.id, label: checkpointLabel(c.epoch, c.metrics) })),
            ]}
          />
        </FormField>
      )}
    </div>
  );
}
