/**
 * @file ModelSelector.tsx
 * @description Model picker for uncertainty analysis and collection
 *              priorities, rendered as a kit Toolbar with a Select.
 * @feature datacollection
 */

import { Select, Toolbar, InfoIcon } from '@/shared/components/ui';
import type { RegisteredModel } from '@/features/training/types';

export interface ModelSelectorProps {
  models: RegisteredModel[];
  selectedModelId: string | null;
  onChange: (modelId: string | null) => void;
  loading?: boolean;
}

export function ModelSelector({ models, selectedModelId, onChange, loading }: ModelSelectorProps) {
  const noModels = !loading && models.length === 0;
  return (
    <Toolbar
      filters={
        <div className="flex items-center gap-2">
          <Select
            aria-label="Model"
            fullWidth={false}
            className="w-64 max-w-full"
            placeholder={loading ? 'Loading models…' : noModels ? 'No registered models' : 'Choose a model…'}
            disabled={loading || noModels}
            options={models.map((m) => ({ value: m.name, label: m.description ? `${m.name} — ${m.description}` : m.name }))}
            value={selectedModelId ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
          />
          <InfoIcon content="A registered VLA model. Different models have different weak spots, so priorities and uncertainty are per model." />
        </div>
      }
    />
  );
}
