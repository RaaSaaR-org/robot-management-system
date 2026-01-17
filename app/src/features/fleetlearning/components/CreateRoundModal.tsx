/**
 * @file CreateRoundModal.tsx
 * @description Modal component for creating a new federated learning round
 * @feature fleetlearning
 */

import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { X, Play, Loader2, Info } from 'lucide-react';
import type {
  CreateFederatedRoundRequest,
  FederatedRoundConfig,
  AggregationMethod,
  SelectionStrategy,
} from '../types/fleetlearning.types';
import {
  DEFAULT_ROUND_CONFIG,
  AGGREGATION_METHOD_LABELS,
  SELECTION_STRATEGY_LABELS,
} from '../types/fleetlearning.types';

// ============================================================================
// TYPES
// ============================================================================

export interface CreateRoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateFederatedRoundRequest) => Promise<void>;
  isLoading?: boolean;
  availableModels?: string[];
}

// ============================================================================
// COMPONENT
// ============================================================================

export function CreateRoundModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading = false,
  availableModels = [],
}: CreateRoundModalProps) {
  const [globalModelVersion, setGlobalModelVersion] = useState('');
  const [config, setConfig] = useState<Partial<FederatedRoundConfig>>({});

  const mergedConfig = { ...DEFAULT_ROUND_CONFIG, ...config };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!globalModelVersion.trim()) return;

    await onSubmit({
      globalModelVersion: globalModelVersion.trim(),
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    // Reset form
    setGlobalModelVersion('');
    setConfig({});
  };

  const updateConfig = <K extends keyof FederatedRoundConfig>(
    key: K,
    value: FederatedRoundConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Create Federated Round
          </h2>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* Model Version */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Global Model Version *
            </label>
            {availableModels.length > 0 ? (
              <select
                value={globalModelVersion}
                onChange={(e) => setGlobalModelVersion(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="">Select a model...</option>
                {availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={globalModelVersion}
                onChange={(e) => setGlobalModelVersion(e.target.value)}
                placeholder="e.g., vla-base-v1.0"
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            )}
          </div>

          {/* Aggregation Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Aggregation Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(AGGREGATION_METHOD_LABELS) as [AggregationMethod, string][]).map(
                ([method, label]) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => updateConfig('aggregationMethod', method)}
                    disabled={isLoading}
                    className={cn(
                      'px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                      mergedConfig.aggregationMethod === method
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
                    )}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Selection Strategy */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Participant Selection
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(SELECTION_STRATEGY_LABELS) as [SelectionStrategy, string][]).map(
                ([strategy, label]) => (
                  <button
                    key={strategy}
                    type="button"
                    onClick={() => updateConfig('selectionStrategy', strategy)}
                    disabled={isLoading}
                    className={cn(
                      'px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                      mergedConfig.selectionStrategy === strategy
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
                    )}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Participant Limits */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Min Participants
              </label>
              <input
                type="number"
                min={1}
                value={mergedConfig.minParticipants}
                onChange={(e) =>
                  updateConfig('minParticipants', parseInt(e.target.value, 10) || 1)
                }
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Max Participants
              </label>
              <input
                type="number"
                min={1}
                value={mergedConfig.maxParticipants}
                onChange={(e) =>
                  updateConfig('maxParticipants', parseInt(e.target.value, 10) || 50)
                }
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Local Training Config */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Local Epochs
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={mergedConfig.localEpochs}
                onChange={(e) => updateConfig('localEpochs', parseInt(e.target.value, 10) || 1)}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Local Learning Rate
              </label>
              <input
                type="number"
                min={0.00001}
                max={1}
                step={0.0001}
                value={mergedConfig.localLearningRate}
                onChange={(e) =>
                  updateConfig('localLearningRate', parseFloat(e.target.value) || 0.001)
                }
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Privacy Settings */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="secureAggregation"
                checked={mergedConfig.secureAggregation}
                onChange={(e) => updateConfig('secureAggregation', e.target.checked)}
                disabled={isLoading}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <label
                htmlFor="secureAggregation"
                className="text-sm text-gray-700 dark:text-gray-300"
              >
                Enable Secure Aggregation
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Privacy Epsilon (optional)
              </label>
              <input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={config.privacyEpsilon || ''}
                onChange={(e) =>
                  updateConfig(
                    'privacyEpsilon',
                    e.target.value ? parseFloat(e.target.value) : undefined
                  )
                }
                placeholder="Leave empty for no DP"
                disabled={isLoading}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Differential privacy budget for this round
              </p>
            </div>
          </div>

          {/* Info Box */}
          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-1">Round Configuration</p>
              <p>
                The round will select eligible participants and distribute the global model for local
                training. After training completes, model updates will be aggregated using the{' '}
                {AGGREGATION_METHOD_LABELS[mergedConfig.aggregationMethod]} algorithm.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !globalModelVersion.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Play size={18} />
                  Create Round
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
