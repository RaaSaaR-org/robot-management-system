/**
 * @file wizardModel.ts
 * @description Form state, steps and option lists of the New training job wizard
 * @feature training
 */

import { getDefaultHyperparameters } from '../../HyperparameterForm';
import type {
  BaseModel,
  FineTuneMethod,
  HyperparametersInput,
  InitFromSelection,
  TrainingJobKind,
  WeightsSource,
} from '../../../types';

export type Step = 'type' | 'dataset' | 'model' | 'scene' | 'hyperparams' | 'gpu' | 'review';

/**
 * The step list depends on the job kind: supervised picks a dataset and a
 * model, sim-RL picks a twin-derived scene instead. (TASK-172.C)
 */
export function stepsFor(kind: TrainingJobKind): { id: Step; label: string }[] {
  if (kind === 'sim_rl') {
    return [
      { id: 'type', label: 'Type' },
      { id: 'scene', label: 'Scene' },
      { id: 'hyperparams', label: 'Settings' },
      { id: 'gpu', label: 'Resources' },
      { id: 'review', label: 'Review' },
    ];
  }
  return [
    { id: 'type', label: 'Type' },
    { id: 'dataset', label: 'Datasets' },
    { id: 'model', label: 'Model' },
    { id: 'hyperparams', label: 'Settings' },
    { id: 'gpu', label: 'Resources' },
    { id: 'review', label: 'Review' },
  ];
}

export const BASE_MODEL_OPTIONS: { value: BaseModel; label: string; description: string }[] = [
  { value: 'smolvla', label: 'SmolVLA', description: 'Small Hugging Face VLA, LoRA-friendly on Apple Silicon' },
  { value: 'pi0', label: 'Pi0', description: 'Physical Intelligence base model' },
  { value: 'pi0_6', label: 'Pi0.6', description: 'Pi0 0.6 with improved action heads' },
  { value: 'openvla', label: 'OpenVLA', description: 'Open vision-language-action model' },
  { value: 'groot', label: 'GR00T', description: 'NVIDIA GR00T foundation model' },
  { value: 'groot_n1_7', label: 'GR00T N1.7', description: 'NVIDIA GR00T N1.7 via native LeRobot' },
];

export const FINE_TUNE_OPTIONS: { value: FineTuneMethod; label: string; description: string }[] = [
  { value: 'lora', label: 'LoRA', description: 'Parameter-efficient, lower memory' },
  { value: 'full', label: 'Full', description: 'All parameters, best quality' },
  { value: 'frozen_backbone', label: 'Frozen backbone', description: 'Fast, action head only' },
];

export const TRAINING_PRESETS = {
  quick: { label: 'Quick', description: 'Fast iteration, fewer epochs', hyperparameters: { learning_rate: 1e-4, batch_size: 8, epochs: 5, warmup_steps: 100 } },
  standard: { label: 'Standard', description: 'Balanced training', hyperparameters: { learning_rate: 5e-5, batch_size: 16, epochs: 20, warmup_steps: 500 } },
  thorough: { label: 'Thorough', description: 'Best quality, more epochs', hyperparameters: { learning_rate: 2e-5, batch_size: 32, epochs: 50, warmup_steps: 1000, weight_decay: 0.01 } },
} as const;

export const GPU_OPTIONS = [
  { value: 'any' as const, label: 'Any available' },
  { value: 'a100' as const, label: 'A100' },
  { value: 'h100' as const, label: 'H100' },
];

export const PRIORITY_OPTIONS = [
  { value: 'low' as const, label: 'Low' },
  { value: 'normal' as const, label: 'Normal' },
  { value: 'high' as const, label: 'High' },
];

/** One member of the mixture being assembled, with its sampling weight. */
export interface MixtureMember {
  datasetId: string;
  weight: number;
}

export interface FormState {
  kind: TrainingJobKind;
  /** Member 0 of `mixture`. Kept because the server's single-dataset path is it. */
  datasetId: string;
  mixture: MixtureMember[];
  baseModel: BaseModel;
  fineTuneMethod: FineTuneMethod;
  /** Foundation weights, or a model already in the registry. (TASK-239) */
  weightsSource: WeightsSource;
  /** The picked model/checkpoint; null while `weightsSource` is 'foundation'. */
  initFrom: InitFromSelection | null;
  sceneId: string;
  hyperparameters: HyperparametersInput;
  gpuType: 'a100' | 'h100' | 'any';
  priority: 'low' | 'normal' | 'high';
}

export const INITIAL_FORM: FormState = {
  kind: 'supervised',
  datasetId: '',
  mixture: [],
  baseModel: 'pi0',
  fineTuneMethod: 'lora',
  weightsSource: 'foundation',
  initFrom: null,
  sceneId: '',
  hyperparameters: getDefaultHyperparameters('lora'),
  gpuType: 'any',
  priority: 'normal',
};

/**
 * Weights the server refuses: finite and positive is the whole domain of a
 * sampling ratio, and `Number('') === 0`, so clearing the box lands here too.
 */
export const badWeights = (form: FormState) =>
  form.mixture.filter((m) => !(Number.isFinite(m.weight) && m.weight > 0));

/**
 * What the run starts from, for the review step. A run continuing a fine-tune
 * says so by name — the architecture alone is the truth only for a
 * foundation run. (TASK-239)
 */
export function describeStartingPoint(form: FormState): string {
  const initFrom = form.weightsSource === 'existing' ? form.initFrom : null;
  if (!initFrom) return form.baseModel.toUpperCase();
  const head =
    initFrom.checkpointEpoch !== null ? `Epoch ${initFrom.checkpointEpoch} of ${initFrom.modelName}` : initFrom.modelName;
  return `${head} (${form.baseModel})`;
}
