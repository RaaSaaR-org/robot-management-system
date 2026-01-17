/**
 * @file TrainingJobWizard.tsx
 * @description Multi-step wizard for creating training jobs
 * @feature training
 */

import { useState, useCallback } from 'react';
import { Modal, Button, Badge } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { HyperparameterForm, getDefaultHyperparameters } from './HyperparameterForm';
import type {
  Dataset,
  BaseModel,
  FineTuneMethod,
  HyperparametersInput,
  SubmitTrainingJobInput,
  GpuAvailability,
} from '../types';

export interface TrainingJobWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: SubmitTrainingJobInput) => Promise<void>;
  datasets: Dataset[];
  gpuAvailability?: GpuAvailability;
  isSubmitting?: boolean;
}

type Step = 'dataset' | 'model' | 'hyperparams' | 'gpu' | 'review';

const steps: { id: Step; label: string }[] = [
  { id: 'dataset', label: 'Dataset' },
  { id: 'model', label: 'Model' },
  { id: 'hyperparams', label: 'Hyperparams' },
  { id: 'gpu', label: 'Resources' },
  { id: 'review', label: 'Review' },
];

const baseModels: { value: BaseModel; label: string; description: string }[] = [
  { value: 'pi0', label: 'Pi0', description: 'Physical Intelligence base model' },
  { value: 'pi0_6', label: 'Pi0.6', description: 'Pi0 version 0.6 with improved action heads' },
  { value: 'openvla', label: 'OpenVLA', description: 'Open Vision-Language-Action model' },
  { value: 'groot', label: 'GROOT', description: 'NVIDIA GROOT foundation model' },
];

const fineTuneMethods: { value: FineTuneMethod; label: string; description: string }[] = [
  { value: 'lora', label: 'LoRA', description: 'Parameter-efficient, lower memory' },
  { value: 'full', label: 'Full', description: 'All parameters, best quality' },
  { value: 'frozen_backbone', label: 'Frozen Backbone', description: 'Fast training, action head only' },
];

const TRAINING_PRESETS = {
  quick: {
    label: 'Quick Train',
    description: 'Fast iteration, fewer epochs',
    hyperparameters: { learning_rate: 1e-4, batch_size: 8, epochs: 5, warmup_steps: 100 },
  },
  standard: {
    label: 'Standard',
    description: 'Balanced training',
    hyperparameters: { learning_rate: 5e-5, batch_size: 16, epochs: 20, warmup_steps: 500 },
  },
  thorough: {
    label: 'Thorough',
    description: 'Best quality, more epochs',
    hyperparameters: { learning_rate: 2e-5, batch_size: 32, epochs: 50, warmup_steps: 1000, weight_decay: 0.01 },
  },
} as const;

interface FormState {
  datasetId: string;
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  hyperparameters: HyperparametersInput;
  gpuType: 'a100' | 'h100' | 'any';
  priority: 'low' | 'normal' | 'high';
}

/**
 * Multi-step wizard for creating training jobs
 */
export function TrainingJobWizard({
  isOpen,
  onClose,
  onSubmit,
  datasets,
  gpuAvailability,
  isSubmitting,
}: TrainingJobWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>('dataset');
  const [form, setForm] = useState<FormState>({
    datasetId: '',
    baseModel: 'pi0',
    fineTuneMethod: 'lora',
    hyperparameters: getDefaultHyperparameters('lora'),
    gpuType: 'any',
    priority: 'normal',
  });
  const [error, setError] = useState<string | null>(null);

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const resetForm = useCallback(() => {
    setCurrentStep('dataset');
    setForm({
      datasetId: '',
      baseModel: 'pi0',
      fineTuneMethod: 'lora',
      hyperparameters: getDefaultHyperparameters('lora'),
      gpuType: 'any',
      priority: 'normal',
    });
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleNext = useCallback(() => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id);
    }
  }, [currentStepIndex]);

  const handleBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id);
    }
  }, [currentStepIndex]);

  const handleFineTuneMethodChange = useCallback((method: FineTuneMethod) => {
    setForm((prev) => ({
      ...prev,
      fineTuneMethod: method,
      hyperparameters: getDefaultHyperparameters(method),
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    setError(null);
    try {
      await onSubmit({
        datasetId: form.datasetId,
        baseModel: form.baseModel,
        fineTuneMethod: form.fineTuneMethod,
        hyperparameters: form.hyperparameters,
        priority: form.priority,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit training job');
    }
  }, [form, onSubmit, handleClose]);

  const canProceed = useCallback(() => {
    switch (currentStep) {
      case 'dataset':
        return !!form.datasetId;
      case 'model':
        return !!form.baseModel && !!form.fineTuneMethod;
      case 'hyperparams':
        return form.hyperparameters.learning_rate > 0 && form.hyperparameters.epochs > 0;
      case 'gpu':
        return true;
      case 'review':
        return true;
      default:
        return false;
    }
  }, [currentStep, form]);

  const selectedDataset = datasets.find((d) => d.id === form.datasetId);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Training Job" size="lg">
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => index < currentStepIndex && setCurrentStep(step.id)}
                disabled={index > currentStepIndex}
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  currentStep === step.id
                    ? 'bg-primary-500 text-white'
                    : index < currentStepIndex
                      ? 'bg-green-500 text-white cursor-pointer hover:bg-green-600'
                      : 'bg-theme-secondary/20 text-theme-secondary'
                )}
              >
                {index < currentStepIndex ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </button>
              <span className={cn(
                'ml-2 text-sm hidden sm:block',
                currentStep === step.id ? 'text-theme-primary font-medium' : 'text-theme-secondary'
              )}>
                {step.label}
              </span>
              {index < steps.length - 1 && (
                <div className="w-8 sm:w-12 h-0.5 mx-2 bg-theme-secondary/20" />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[300px]">
          {/* Dataset selection */}
          {currentStep === 'dataset' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-theme-primary">Select Dataset</h3>
              <p className="text-sm text-theme-secondary">
                Choose a validated dataset for training.
              </p>

              <div className="grid gap-3 max-h-[300px] overflow-y-auto">
                {datasets.filter((d) => d.status === 'ready').map((dataset) => (
                  <button
                    key={dataset.id}
                    onClick={() => setForm({ ...form, datasetId: dataset.id })}
                    className={cn(
                      'p-4 text-left rounded-lg border transition-colors',
                      form.datasetId === dataset.id
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-theme-secondary/30 hover:border-primary-500/50'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-theme-primary">{dataset.name}</span>
                      <Badge className="bg-green-100 text-green-800">Ready</Badge>
                    </div>
                    <p className="text-sm text-theme-secondary mt-1">
                      {dataset.totalFrames.toLocaleString()} frames
                    </p>
                  </button>
                ))}
                {datasets.filter((d) => d.status === 'ready').length === 0 && (
                  <p className="text-center py-8 text-theme-secondary">
                    No validated datasets available. Upload and validate a dataset first.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Model selection */}
          {currentStep === 'model' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-theme-primary">Base Model</h3>
                <p className="text-sm text-theme-secondary mb-3">
                  Select the VLA foundation model to fine-tune.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {baseModels.map((model) => (
                    <button
                      key={model.value}
                      onClick={() => setForm({ ...form, baseModel: model.value })}
                      className={cn(
                        'p-4 text-left rounded-lg border transition-colors',
                        form.baseModel === model.value
                          ? 'border-primary-500 bg-primary-500/10'
                          : 'border-theme-secondary/30 hover:border-primary-500/50'
                      )}
                    >
                      <span className="font-medium text-theme-primary">{model.label}</span>
                      <p className="text-xs text-theme-secondary mt-1">{model.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-theme-primary">Fine-tuning Method</h3>
                <p className="text-sm text-theme-secondary mb-3">
                  Choose how to adapt the model.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {fineTuneMethods.map((method) => (
                    <button
                      key={method.value}
                      onClick={() => handleFineTuneMethodChange(method.value)}
                      className={cn(
                        'p-4 text-left rounded-lg border transition-colors',
                        form.fineTuneMethod === method.value
                          ? 'border-accent-500 bg-accent-500/10'
                          : 'border-theme-secondary/30 hover:border-accent-500/50'
                      )}
                    >
                      <span className="font-medium text-theme-primary">{method.label}</span>
                      <p className="text-xs text-theme-secondary mt-1">{method.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Hyperparameters */}
          {currentStep === 'hyperparams' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-theme-primary">Hyperparameters</h3>
              <p className="text-sm text-theme-secondary">
                Configure training hyperparameters. Defaults are optimized for {form.fineTuneMethod.toUpperCase()}.
              </p>

              {/* Training presets */}
              <div className="flex flex-wrap gap-2">
                <span className="text-sm text-theme-tertiary mr-2 self-center">Presets:</span>
                {Object.entries(TRAINING_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() =>
                      setForm({
                        ...form,
                        hyperparameters: { ...form.hyperparameters, ...preset.hyperparameters },
                      })
                    }
                    className="px-3 py-1.5 text-sm rounded-lg border border-theme-secondary/30 hover:border-primary-500 hover:bg-primary-500/10 transition-colors text-theme-primary"
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <HyperparameterForm
                values={form.hyperparameters}
                onChange={(hyperparameters) => setForm({ ...form, hyperparameters })}
                fineTuneMethod={form.fineTuneMethod}
              />
            </div>
          )}

          {/* GPU Resources */}
          {currentStep === 'gpu' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-theme-primary">GPU Preference</h3>
                <p className="text-sm text-theme-secondary mb-3">
                  Select preferred GPU type or allow any available.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'any' as const, label: 'Any Available', available: gpuAvailability?.available_gpus ?? 0 },
                    { value: 'a100' as const, label: 'A100', available: gpuAvailability?.gpu_types?.a100 ?? 0 },
                    { value: 'h100' as const, label: 'H100', available: gpuAvailability?.gpu_types?.h100 ?? 0 },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setForm({ ...form, gpuType: option.value })}
                      className={cn(
                        'p-4 text-left rounded-lg border transition-colors',
                        form.gpuType === option.value
                          ? 'border-primary-500 bg-primary-500/10'
                          : 'border-theme-secondary/30 hover:border-primary-500/50'
                      )}
                    >
                      <span className="font-medium text-theme-primary">{option.label}</span>
                      <p className="text-xs text-theme-secondary mt-1">
                        {option.available} available
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-theme-primary">Priority</h3>
                <p className="text-sm text-theme-secondary mb-3">
                  Higher priority jobs are scheduled first.
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { value: 'low' as const, label: 'Low' },
                    { value: 'normal' as const, label: 'Normal' },
                    { value: 'high' as const, label: 'High' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setForm({ ...form, priority: option.value })}
                      className={cn(
                        'p-4 text-center rounded-lg border transition-colors',
                        form.priority === option.value
                          ? 'border-accent-500 bg-accent-500/10'
                          : 'border-theme-secondary/30 hover:border-accent-500/50'
                      )}
                    >
                      <span className="font-medium text-theme-primary">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {gpuAvailability && (
                <div className="p-4 bg-theme-secondary/10 rounded-lg">
                  <h4 className="font-medium text-theme-primary mb-2">Queue Status</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-theme-secondary">Available GPUs:</span>
                      <span className="ml-2 font-medium text-theme-primary">
                        {gpuAvailability.available_gpus} / {gpuAvailability.total_gpus}
                      </span>
                    </div>
                    <div>
                      <span className="text-theme-secondary">Jobs in Queue:</span>
                      <span className="ml-2 font-medium text-theme-primary">
                        {gpuAvailability.queued_jobs}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Review */}
          {currentStep === 'review' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-theme-primary">Review & Submit</h3>
              <p className="text-sm text-theme-secondary">
                Review your configuration before submitting.
              </p>

              <div className="space-y-4 p-4 bg-theme-secondary/10 rounded-lg">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm text-theme-tertiary">Dataset</span>
                    <p className="font-medium text-theme-primary">{selectedDataset?.name}</p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-tertiary">Base Model</span>
                    <p className="font-medium text-theme-primary">{form.baseModel.toUpperCase()}</p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-tertiary">Fine-tune Method</span>
                    <p className="font-medium text-theme-primary">
                      {fineTuneMethods.find((m) => m.value === form.fineTuneMethod)?.label}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-theme-tertiary">Priority</span>
                    <p className="font-medium text-theme-primary capitalize">{form.priority}</p>
                  </div>
                </div>

                <div className="border-t border-theme-secondary/20 pt-4">
                  <span className="text-sm text-theme-tertiary">Key Hyperparameters</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="px-2 py-1 bg-theme-primary/5 rounded text-sm">
                      LR: {form.hyperparameters.learning_rate}
                    </span>
                    <span className="px-2 py-1 bg-theme-primary/5 rounded text-sm">
                      Batch: {form.hyperparameters.batch_size}
                    </span>
                    <span className="px-2 py-1 bg-theme-primary/5 rounded text-sm">
                      Epochs: {form.hyperparameters.epochs}
                    </span>
                    {form.fineTuneMethod === 'lora' && form.hyperparameters.lora_rank && (
                      <span className="px-2 py-1 bg-theme-primary/5 rounded text-sm">
                        LoRA Rank: {form.hyperparameters.lora_rank}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {/* Actions */}
        <div className="flex justify-between">
          <Button variant="ghost" onClick={currentStepIndex === 0 ? handleClose : handleBack}>
            {currentStepIndex === 0 ? 'Cancel' : 'Back'}
          </Button>

          {currentStep === 'review' ? (
            <Button onClick={handleSubmit} isLoading={isSubmitting}>
              Submit Training Job
            </Button>
          ) : (
            <Button onClick={handleNext} disabled={!canProceed()}>
              Continue
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
