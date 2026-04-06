/**
 * @file ModelSelector.tsx
 * @description Model selector dropdown for uncertainty analysis and priorities
 * @feature datacollection
 */

import { Cpu, AlertTriangle } from 'lucide-react';
import { Card } from '@/shared/components/ui/Card';
import { InfoIcon } from '@/shared/components/ui/Tooltip';
import type { RegisteredModel } from '@/features/training/types';

// ============================================================================
// TYPES
// ============================================================================

export interface ModelSelectorProps {
  models: RegisteredModel[];
  selectedModelId: string | null;
  onChange: (modelId: string | null) => void;
  loading?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ModelSelector({
  models,
  selectedModelId,
  onChange,
  loading,
}: ModelSelectorProps) {
  if (loading) {
    return (
      <Card variant="subtle">
        <div className="flex items-center gap-3 px-4 py-3 text-sm text-theme-muted">
          <Cpu className="w-4 h-4 animate-pulse" />
          Loading models...
        </div>
      </Card>
    );
  }

  if (models.length === 0) {
    return (
      <Card variant="subtle" className="border border-yellow-500/20">
        <div className="flex items-center gap-3 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
          <div>
            <p className="text-sm text-theme-secondary">No registered models found</p>
            <p className="text-xs text-theme-muted mt-0.5">
              Train a VLA model first, then return here to see uncertainty analysis and collection priorities.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="subtle">
      <div className="flex items-center gap-3 px-4 py-3">
        <Cpu className="w-4 h-4 text-cobalt-400 shrink-0" />
        <div className="flex items-center gap-2">
          <label className="text-sm text-theme-secondary whitespace-nowrap">Model:</label>
          <InfoIcon
            content="Select a registered VLA model to view its uncertainty analysis and data collection priorities. Different models have different weak spots."
            size={12}
          />
        </div>
        <select
          value={selectedModelId || ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="px-3 py-1.5 text-sm rounded-brand border border-theme bg-theme-card text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt-500 min-w-[200px]"
        >
          <option value="">Select a model...</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
              {m.description ? ` — ${m.description}` : ''}
            </option>
          ))}
        </select>
      </div>
    </Card>
  );
}
