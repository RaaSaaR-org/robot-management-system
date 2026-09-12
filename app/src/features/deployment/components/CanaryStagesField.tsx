/**
 * @file CanaryStagesField.tsx
 * @description Compact editable list of canary stages (traffic % + duration) for the New deployment form
 * @feature deployment
 */

import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, SegmentedControl } from '@/shared/components/ui';
import { CANARY_PRESETS, type CanaryStage } from '../types';
import { formatStageDuration } from './deploymentHelpers';

export type CanaryPresetKey = keyof typeof CANARY_PRESETS | 'custom';

export interface CanaryStagesFieldProps {
  stages: CanaryStage[];
  preset: CanaryPresetKey;
  onChange: (stages: CanaryStage[], preset: CanaryPresetKey) => void;
  error?: string;
}

const PRESET_OPTIONS: { value: CanaryPresetKey; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard' },
  { value: 'conservative', label: 'Conservative' },
  { value: 'custom', label: 'Custom' },
];

export function CanaryStagesField({ stages, preset, onChange, error }: CanaryStagesFieldProps) {
  const setPreset = (p: CanaryPresetKey) => {
    if (p === 'custom') onChange(stages, 'custom');
    else onChange(CANARY_PRESETS[p].stages.map((s) => ({ ...s })), p);
  };

  const update = (i: number, patch: Partial<CanaryStage>) =>
    onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)), 'custom');

  const remove = (i: number) => onChange(stages.filter((_, j) => j !== i), 'custom');

  const add = () => {
    const last = stages[stages.length - 1];
    const pct = Math.min(100, (last?.percentage ?? 0) + 25);
    onChange([...stages, { percentage: pct, durationMinutes: pct >= 100 ? 0 : 60 }], 'custom');
  };

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl label="Stage preset" size="sm" options={PRESET_OPTIONS} value={preset} onChange={setPreset} />
      <ol className="flex flex-col gap-2">
        {stages.map((stage, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-control bg-inset px-3 py-2">
            <span className="w-16 shrink-0 text-[13px] text-ink-tertiary">Stage {i + 1}</span>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                size="sm"
                min={1}
                max={100}
                aria-label={`Stage ${i + 1} traffic percent`}
                className="w-20"
                value={stage.percentage}
                onChange={(e) => update(i, { percentage: Number(e.target.value) || 0 })}
              />
              <span className="text-[13px] text-ink-tertiary">%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                size="sm"
                min={0}
                aria-label={`Stage ${i + 1} duration in minutes`}
                className="w-24"
                value={stage.durationMinutes}
                onChange={(e) => update(i, { durationMinutes: Number(e.target.value) || 0 })}
              />
              <span className="text-[13px] text-ink-tertiary">min</span>
            </div>
            <span className="hidden flex-1 text-right text-[13px] text-ink-tertiary sm:block">
              {formatStageDuration(stage.durationMinutes)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={`Remove stage ${i + 1}`}
              disabled={stages.length <= 1}
              onClick={() => remove(i)}
              className="ml-auto sm:ml-0"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={add}>
          Add stage
        </Button>
        {error && (
          <p role="alert" className="text-[13px] text-signal-stopped">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** Validation for the stage list; returns a message or undefined. */
export function validateStages(stages: CanaryStage[]): string | undefined {
  if (stages.length === 0) return 'Add at least one stage.';
  for (let i = 0; i < stages.length; i++) {
    const p = stages[i].percentage;
    if (p < 1 || p > 100) return `Stage ${i + 1}: traffic must be 1–100 %.`;
    if (i > 0 && p <= stages[i - 1].percentage) return `Stage ${i + 1} must send more traffic than stage ${i}.`;
  }
  return undefined;
}
