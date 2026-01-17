/**
 * @file CanaryConfig.tsx
 * @description Multi-step wizard for configuring canary deployments
 * @feature deployment
 */

import { useState, useMemo } from 'react';
import { Modal, Button, Card, Badge, Input } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import type {
  ModelVersion,
  CreateDeploymentInput,
  CanaryStage,
  RollbackThresholds,
  DeploymentStrategy,
} from '../types';
import {
  CANARY_PRESETS,
  DEFAULT_ROLLBACK_THRESHOLDS,
} from '../types';

export interface CanaryConfigProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateDeploymentInput) => Promise<void>;
  modelVersions: ModelVersion[];
  isLoading?: boolean;
}

type WizardStep = 'model' | 'stages' | 'thresholds' | 'targets' | 'review';

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'model', label: 'Select Model' },
  { key: 'stages', label: 'Configure Stages' },
  { key: 'thresholds', label: 'Set Thresholds' },
  { key: 'targets', label: 'Target Robots' },
  { key: 'review', label: 'Review & Deploy' },
];

interface FormState {
  modelVersionId: string;
  strategy: DeploymentStrategy;
  stages: CanaryStage[];
  rollbackThresholds: RollbackThresholds;
  targetRobotTypes: string[];
  targetZones: string[];
}

const initialFormState: FormState = {
  modelVersionId: '',
  strategy: 'canary',
  stages: CANARY_PRESETS.standard.stages,
  rollbackThresholds: DEFAULT_ROLLBACK_THRESHOLDS,
  targetRobotTypes: [],
  targetZones: [],
};

export function CanaryConfig({
  isOpen,
  onClose,
  onSubmit,
  modelVersions,
  isLoading = false,
}: CanaryConfigProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('model');
  const [formState, setFormState] = useState<FormState>(initialFormState);
  const [selectedPreset, setSelectedPreset] = useState<keyof typeof CANARY_PRESETS>('standard');

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex].key);
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex].key);
    }
  };

  const handleSubmit = async () => {
    const input: CreateDeploymentInput = {
      modelVersionId: formState.modelVersionId,
      strategy: formState.strategy,
      targetRobotTypes: formState.targetRobotTypes.length > 0 ? formState.targetRobotTypes : undefined,
      targetZones: formState.targetZones.length > 0 ? formState.targetZones : undefined,
      canaryConfig: {
        stages: formState.stages,
        successThreshold: 0.95,
        metricsWindow: 60,
      },
      rollbackThresholds: formState.rollbackThresholds,
    };

    await onSubmit(input);
    handleClose();
  };

  const handleClose = () => {
    setCurrentStep('model');
    setFormState(initialFormState);
    setSelectedPreset('standard');
    onClose();
  };

  const handlePresetSelect = (preset: keyof typeof CANARY_PRESETS) => {
    setSelectedPreset(preset);
    setFormState((prev) => ({
      ...prev,
      stages: [...CANARY_PRESETS[preset].stages],
    }));
  };

  const selectedModel = useMemo(
    () => modelVersions.find((v) => v.id === formState.modelVersionId),
    [modelVersions, formState.modelVersionId]
  );

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 'model':
        return !!formState.modelVersionId;
      case 'stages':
        return formState.stages.length > 0;
      case 'thresholds':
        return true;
      case 'targets':
        return true; // Optional
      case 'review':
        return true;
      default:
        return false;
    }
  }, [currentStep, formState]);

  const estimatedDuration = useMemo(() => {
    const totalMinutes = formState.stages.reduce((sum, s) => sum + s.durationMinutes, 0);
    const hours = Math.floor(totalMinutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `~${days} day(s)`;
    if (hours > 0) return `~${hours} hour(s)`;
    return `~${totalMinutes} minute(s)`;
  }, [formState.stages]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Deployment"
      size="lg"
      footer={
        <div className="flex justify-between w-full">
          <Button
            variant="ghost"
            onClick={currentStepIndex === 0 ? handleClose : handleBack}
            disabled={isLoading}
          >
            {currentStepIndex === 0 ? 'Cancel' : 'Back'}
          </Button>
          <Button
            variant="primary"
            onClick={currentStep === 'review' ? handleSubmit : handleNext}
            disabled={!canProceed}
            isLoading={isLoading && currentStep === 'review'}
          >
            {currentStep === 'review' ? 'Start Deployment' : 'Continue'}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Step indicator */}
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => (
            <div key={step.key} className="flex items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                  index < currentStepIndex
                    ? 'bg-green-500 text-white'
                    : index === currentStepIndex
                      ? 'bg-cobalt-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-theme-secondary'
                )}
              >
                {index < currentStepIndex ? '✓' : index + 1}
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={cn(
                    'w-12 h-0.5 mx-1',
                    index < currentStepIndex ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[300px]">
          {/* Step 1: Select Model */}
          {currentStep === 'model' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-theme-primary">Select Model Version</h3>
              <div className="grid gap-3 max-h-[300px] overflow-y-auto">
                {modelVersions.length > 0 ? (
                  modelVersions.map((version) => (
                    <Card
                      key={version.id}
                      interactive
                      onClick={() => setFormState((prev) => ({ ...prev, modelVersionId: version.id }))}
                      className={cn(
                        'p-4 cursor-pointer',
                        formState.modelVersionId === version.id && 'ring-2 ring-cobalt-500'
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium text-theme-primary">
                            {version.skill?.name || 'Unknown Skill'}
                          </h4>
                          <p className="text-sm text-theme-secondary">
                            v{version.version}
                          </p>
                        </div>
                        <Badge
                          variant={version.deploymentStatus === 'staging' ? 'warning' : 'default'}
                        >
                          {version.deploymentStatus}
                        </Badge>
                      </div>
                    </Card>
                  ))
                ) : (
                  <p className="text-theme-secondary text-center py-8">
                    No model versions available for deployment
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Configure Stages */}
          {currentStep === 'stages' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-theme-primary">Configure Rollout Stages</h3>

              {/* Presets */}
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(CANARY_PRESETS) as Array<keyof typeof CANARY_PRESETS>).map((key) => (
                  <Card
                    key={key}
                    interactive
                    onClick={() => handlePresetSelect(key)}
                    className={cn(
                      'p-3 cursor-pointer text-center',
                      selectedPreset === key && 'ring-2 ring-cobalt-500'
                    )}
                  >
                    <p className="font-medium text-theme-primary">{CANARY_PRESETS[key].name}</p>
                    <p className="text-xs text-theme-secondary mt-1">
                      {CANARY_PRESETS[key].description}
                    </p>
                  </Card>
                ))}
              </div>

              {/* Stage preview */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-theme-primary">Stages:</p>
                {formState.stages.map((stage, index) => (
                  <div
                    key={index}
                    className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800/50 rounded"
                  >
                    <span className="text-sm text-theme-primary">
                      Stage {index + 1}: {stage.percentage}% traffic
                    </span>
                    <span className="text-sm text-theme-secondary">
                      {stage.durationMinutes > 0
                        ? `${Math.floor(stage.durationMinutes / 60)}h ${stage.durationMinutes % 60}m`
                        : 'Final'}
                    </span>
                  </div>
                ))}
              </div>

              <p className="text-sm text-theme-secondary">
                Estimated total duration: {estimatedDuration}
              </p>
            </div>
          )}

          {/* Step 3: Rollback Thresholds */}
          {currentStep === 'thresholds' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-theme-primary">Set Rollback Thresholds</h3>
              <p className="text-sm text-theme-secondary">
                Automatic rollback will trigger if any threshold is exceeded.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-theme-primary mb-1">
                    Error Rate (%)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={(formState.rollbackThresholds.errorRate * 100).toFixed(1)}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        rollbackThresholds: {
                          ...prev.rollbackThresholds,
                          errorRate: parseFloat(e.target.value) / 100,
                        },
                      }))
                    }
                  />
                  <p className="text-xs text-theme-secondary mt-1">
                    Rollback if error rate exceeds this percentage
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-primary mb-1">
                    P99 Latency (ms)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={formState.rollbackThresholds.latencyP99}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        rollbackThresholds: {
                          ...prev.rollbackThresholds,
                          latencyP99: parseInt(e.target.value) || 0,
                        },
                      }))
                    }
                  />
                  <p className="text-xs text-theme-secondary mt-1">
                    Rollback if P99 latency exceeds this value
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-theme-primary mb-1">
                    Task Failure Rate (%)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={(formState.rollbackThresholds.failureRate * 100).toFixed(1)}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        rollbackThresholds: {
                          ...prev.rollbackThresholds,
                          failureRate: parseFloat(e.target.value) / 100,
                        },
                      }))
                    }
                  />
                  <p className="text-xs text-theme-secondary mt-1">
                    Rollback if task failure rate exceeds this percentage
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Target Robots */}
          {currentStep === 'targets' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-theme-primary">Target Robots (Optional)</h3>
              <p className="text-sm text-theme-secondary">
                Leave empty to target all compatible robots.
              </p>

              <div>
                <label className="block text-sm font-medium text-theme-primary mb-1">
                  Robot Types (comma-separated)
                </label>
                <Input
                  placeholder="e.g., unitree-g1, boston-dynamics-spot"
                  value={formState.targetRobotTypes.join(', ')}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      targetRobotTypes: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }))
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-primary mb-1">
                  Zones (comma-separated)
                </label>
                <Input
                  placeholder="e.g., warehouse-a, warehouse-b"
                  value={formState.targetZones.join(', ')}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      targetZones: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }))
                  }
                />
              </div>
            </div>
          )}

          {/* Step 5: Review */}
          {currentStep === 'review' && (
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-theme-primary">Review Deployment</h3>

              <div className="space-y-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
                <div className="flex justify-between">
                  <span className="text-theme-secondary">Model</span>
                  <span className="font-medium text-theme-primary">
                    {selectedModel?.skill?.name} v{selectedModel?.version}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-theme-secondary">Strategy</span>
                  <span className="font-medium text-theme-primary capitalize">
                    {formState.strategy}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-theme-secondary">Stages</span>
                  <span className="font-medium text-theme-primary">
                    {formState.stages.length} stages
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-theme-secondary">Est. Duration</span>
                  <span className="font-medium text-theme-primary">{estimatedDuration}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-theme-secondary">Error Threshold</span>
                  <span className="font-medium text-theme-primary">
                    {(formState.rollbackThresholds.errorRate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-theme-secondary">Latency Threshold</span>
                  <span className="font-medium text-theme-primary">
                    {formState.rollbackThresholds.latencyP99}ms
                  </span>
                </div>
                {formState.targetRobotTypes.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-theme-secondary">Target Types</span>
                    <span className="font-medium text-theme-primary">
                      {formState.targetRobotTypes.join(', ')}
                    </span>
                  </div>
                )}
                {formState.targetZones.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-theme-secondary">Target Zones</span>
                    <span className="font-medium text-theme-primary">
                      {formState.targetZones.join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
