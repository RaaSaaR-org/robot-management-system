/**
 * @file HyperparameterForm.tsx
 * @description Dynamic form for hyperparameter configuration based on fine-tune method
 * @feature training
 */

import { Input } from '@/shared/components/ui';
import type { HyperparametersInput, FineTuneMethod } from '../types';

export interface HyperparameterFormProps {
  values: HyperparametersInput;
  onChange: (values: HyperparametersInput) => void;
  fineTuneMethod: FineTuneMethod;
  disabled?: boolean;
}

interface FieldConfig {
  name: keyof HyperparametersInput;
  label: string;
  type: 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  helpText?: string;
  showFor?: FineTuneMethod[];
}

const fieldConfigs: FieldConfig[] = [
  {
    name: 'learning_rate',
    label: 'Learning Rate',
    type: 'number',
    min: 0.0000001,
    max: 0.1,
    step: 0.0001,
    helpText: 'Initial learning rate for optimization',
  },
  {
    name: 'batch_size',
    label: 'Batch Size',
    type: 'number',
    min: 1,
    max: 128,
    step: 1,
    helpText: 'Number of samples per gradient update',
  },
  {
    name: 'epochs',
    label: 'Epochs',
    type: 'number',
    min: 1,
    max: 1000,
    step: 1,
    helpText: 'Number of complete passes through the dataset',
  },
  {
    name: 'warmup_steps',
    label: 'Warmup Steps',
    type: 'number',
    min: 0,
    max: 10000,
    step: 100,
    helpText: 'Number of warmup steps for learning rate scheduler',
  },
  {
    name: 'weight_decay',
    label: 'Weight Decay',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.001,
    helpText: 'L2 regularization coefficient',
  },
  {
    name: 'gradient_accumulation_steps',
    label: 'Gradient Accumulation Steps',
    type: 'number',
    min: 1,
    max: 64,
    step: 1,
    helpText: 'Number of steps to accumulate gradients before update',
  },
  {
    name: 'max_grad_norm',
    label: 'Max Gradient Norm',
    type: 'number',
    min: 0.1,
    max: 10,
    step: 0.1,
    helpText: 'Maximum gradient norm for clipping',
  },
  {
    name: 'lora_rank',
    label: 'LoRA Rank',
    type: 'number',
    min: 1,
    max: 256,
    step: 1,
    helpText: 'Rank of LoRA adaptation matrices',
    showFor: ['lora'],
  },
  {
    name: 'lora_alpha',
    label: 'LoRA Alpha',
    type: 'number',
    min: 1,
    max: 512,
    step: 1,
    helpText: 'LoRA scaling factor (typically 2x rank)',
    showFor: ['lora'],
  },
  {
    name: 'lora_dropout',
    label: 'LoRA Dropout',
    type: 'number',
    min: 0,
    max: 0.5,
    step: 0.05,
    helpText: 'Dropout probability for LoRA layers',
    showFor: ['lora'],
  },
];

const defaultValues: Record<FineTuneMethod, Partial<HyperparametersInput>> = {
  full: {
    learning_rate: 0.0001,
    batch_size: 8,
    epochs: 10,
    warmup_steps: 500,
    weight_decay: 0.01,
    gradient_accumulation_steps: 4,
    max_grad_norm: 1.0,
  },
  lora: {
    learning_rate: 0.0002,
    batch_size: 16,
    epochs: 20,
    warmup_steps: 200,
    weight_decay: 0.01,
    gradient_accumulation_steps: 2,
    max_grad_norm: 1.0,
    lora_rank: 16,
    lora_alpha: 32,
    lora_dropout: 0.05,
  },
  frozen_backbone: {
    learning_rate: 0.001,
    batch_size: 32,
    epochs: 30,
    warmup_steps: 100,
    weight_decay: 0.001,
    gradient_accumulation_steps: 1,
    max_grad_norm: 1.0,
  },
};

/**
 * Get default hyperparameters for a fine-tune method
 */
export function getDefaultHyperparameters(method: FineTuneMethod): HyperparametersInput {
  return {
    learning_rate: 0.0001,
    batch_size: 8,
    epochs: 10,
    ...defaultValues[method],
  } as HyperparametersInput;
}

/**
 * Dynamic form for hyperparameter configuration
 */
export function HyperparameterForm({
  values,
  onChange,
  fineTuneMethod,
  disabled,
}: HyperparameterFormProps) {
  const handleChange = (name: keyof HyperparametersInput, value: number) => {
    onChange({ ...values, [name]: value });
  };

  const visibleFields = fieldConfigs.filter(
    (field) => !field.showFor || field.showFor.includes(fineTuneMethod)
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleFields.map((field) => (
          <div key={field.name}>
            <label className="block text-sm font-medium text-theme-primary mb-1">
              {field.label}
            </label>
            <Input
              type="number"
              value={values[field.name] ?? ''}
              onChange={(e) => handleChange(field.name, parseFloat(e.target.value))}
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={disabled}
              className="w-full"
            />
            {field.helpText && (
              <p className="mt-1 text-xs text-theme-tertiary">{field.helpText}</p>
            )}
          </div>
        ))}
      </div>

      {/* Method-specific hints */}
      <div className="p-3 bg-theme-secondary/10 rounded-lg text-sm">
        {fineTuneMethod === 'lora' && (
          <p className="text-theme-secondary">
            <strong>LoRA:</strong> Parameter-efficient fine-tuning. Uses less GPU memory but may
            require more epochs. Good for limited compute resources.
          </p>
        )}
        {fineTuneMethod === 'full' && (
          <p className="text-theme-secondary">
            <strong>Full Fine-tuning:</strong> Updates all model parameters. Requires more GPU
            memory but can achieve best performance. Use lower learning rates.
          </p>
        )}
        {fineTuneMethod === 'frozen_backbone' && (
          <p className="text-theme-secondary">
            <strong>Frozen Backbone:</strong> Only trains the action head while keeping vision and
            language encoders frozen. Fastest training but limited adaptation.
          </p>
        )}
      </div>
    </div>
  );
}
