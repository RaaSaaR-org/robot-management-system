/**
 * @file ContributionWizard.tsx
 * @description Multi-step wizard for creating new contributions
 * @feature contributions
 */

import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  FileText,
  Shield,
  Upload,
  Send,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { LicenseSelector } from './LicenseSelector';
import type {
  ContributionLicenseType,
  ContributionMetadata,
  CollectionMethod,
  InitiateContributionRequest,
  UploadContributionDataRequest,
} from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface ContributionWizardProps {
  onComplete: (contributionId: string) => void;
  onCancel: () => void;
  initiateContribution: (data: InitiateContributionRequest) => Promise<{ id: string }>;
  uploadData: (id: string, data: UploadContributionDataRequest) => Promise<{ estimatedCredits: number }>;
  submitForReview: (id: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
  className?: string;
}

interface WizardData {
  licenseType?: ContributionLicenseType;
  metadata: Partial<ContributionMetadata>;
  trajectoryCount?: number;
  contributionId?: string;
  estimatedCredits?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STEPS = [
  { id: 'metadata', label: 'Details', icon: FileText },
  { id: 'license', label: 'License', icon: Shield },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'submit', label: 'Submit', icon: Send },
];

const COLLECTION_METHODS: { value: CollectionMethod; label: string; description: string }[] = [
  { value: 'teleoperation', label: 'Teleoperation', description: 'Remote-controlled data collection' },
  { value: 'autonomous', label: 'Autonomous', description: 'Autonomous robot operation' },
  { value: 'kinesthetic', label: 'Kinesthetic', description: 'Physical guidance/teaching' },
  { value: 'simulation', label: 'Simulation', description: 'Simulated environment' },
];

const TASK_CATEGORIES = [
  'Pick and Place',
  'Navigation',
  'Manipulation',
  'Assembly',
  'Inspection',
  'Cleaning',
  'Packaging',
  'Human Interaction',
  'Tool Use',
  'Pouring/Dispensing',
];

// ============================================================================
// COMPONENT
// ============================================================================

export function ContributionWizard({
  onComplete,
  onCancel,
  initiateContribution,
  uploadData,
  submitForReview,
  isLoading,
  error,
  className,
}: ContributionWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<WizardData>({
    metadata: {
      taskCategories: [],
    },
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateData = (updates: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...updates }));
    setLocalError(null);
  };

  const updateMetadata = (updates: Partial<ContributionMetadata>) => {
    setData((prev) => ({
      ...prev,
      metadata: { ...prev.metadata, ...updates },
    }));
    setLocalError(null);
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 0: // Metadata
        if (!data.metadata.robotType) {
          setLocalError('Robot type is required');
          return false;
        }
        if (!data.metadata.taskCategories || data.metadata.taskCategories.length === 0) {
          setLocalError('Select at least one task category');
          return false;
        }
        if (!data.metadata.collectionMethod) {
          setLocalError('Collection method is required');
          return false;
        }
        if (!data.metadata.description) {
          setLocalError('Description is required');
          return false;
        }
        return true;
      case 1: // License
        if (!data.licenseType) {
          setLocalError('Please select a license type');
          return false;
        }
        return true;
      case 2: // Upload
        if (!data.trajectoryCount || data.trajectoryCount < 1) {
          setLocalError('Trajectory count must be at least 1');
          return false;
        }
        return true;
      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    setIsSubmitting(true);
    try {
      if (currentStep === 1 && !data.contributionId) {
        // Initiate contribution after license selection
        const result = await initiateContribution({
          licenseType: data.licenseType!,
          metadata: data.metadata as ContributionMetadata,
        });
        updateData({ contributionId: result.id });
      } else if (currentStep === 2 && data.contributionId) {
        // Upload data
        const result = await uploadData(data.contributionId, {
          trajectoryCount: data.trajectoryCount!,
        });
        updateData({ estimatedCredits: result.estimatedCredits });
      }
      setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
    setLocalError(null);
  };

  const handleSubmit = async () => {
    if (!data.contributionId) {
      setLocalError('No contribution to submit');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitForReview(data.contributionId);
      onComplete(data.contributionId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayError = error || localError;
  const loading = isLoading || isSubmitting;

  return (
    <div className={cn('bg-white dark:bg-gray-800 rounded-xl shadow-lg', className)}>
      {/* Progress Steps */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === currentStep;
          const isComplete = index < currentStep;

          return (
            <div key={step.id} className="flex items-center">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full',
                    isComplete
                      ? 'bg-green-500 text-white'
                      : isActive
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  )}
                >
                  {isComplete ? (
                    <Check size={16} />
                  ) : (
                    <Icon size={16} />
                  )}
                </div>
                <span
                  className={cn(
                    'text-sm font-medium hidden sm:inline',
                    isActive
                      ? 'text-gray-900 dark:text-gray-100'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div className="w-8 sm:w-16 h-px bg-gray-200 dark:bg-gray-700 mx-2" />
              )}
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Error Display */}
        {displayError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle size={16} />
            <span className="text-sm">{displayError}</span>
          </div>
        )}

        {/* Step 1: Metadata */}
        {currentStep === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Contribution Details
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Robot Type *
              </label>
              <input
                type="text"
                value={data.metadata.robotType || ''}
                onChange={(e) => updateMetadata({ robotType: e.target.value })}
                placeholder="e.g., Franka Panda, UR5, Custom Arm"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Task Categories * (select all that apply)
              </label>
              <div className="flex flex-wrap gap-2">
                {TASK_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      const current = data.metadata.taskCategories || [];
                      const updated = current.includes(cat)
                        ? current.filter((c) => c !== cat)
                        : [...current, cat];
                      updateMetadata({ taskCategories: updated });
                    }}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded-full border transition-colors',
                      data.metadata.taskCategories?.includes(cat)
                        ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-500 text-primary-700 dark:text-primary-300'
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-400'
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Collection Method *
              </label>
              <div className="grid grid-cols-2 gap-2">
                {COLLECTION_METHODS.map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => updateMetadata({ collectionMethod: method.value })}
                    className={cn(
                      'p-3 text-left rounded-lg border transition-colors',
                      data.metadata.collectionMethod === method.value
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500'
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:border-gray-400'
                    )}
                  >
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {method.label}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {method.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description *
              </label>
              <textarea
                value={data.metadata.description || ''}
                onChange={(e) => updateMetadata({ description: e.target.value })}
                rows={3}
                placeholder="Describe the data you're contributing..."
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Environment (optional)
              </label>
              <input
                type="text"
                value={data.metadata.environment || ''}
                onChange={(e) => updateMetadata({ environment: e.target.value })}
                placeholder="e.g., Kitchen, Warehouse, Office"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>
        )}

        {/* Step 2: License */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Select License Type
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Choose how your data can be used. Different licenses offer different credit rewards.
            </p>
            <LicenseSelector
              value={data.licenseType}
              onChange={(license) => updateData({ licenseType: license })}
            />
          </div>
        )}

        {/* Step 3: Upload */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Upload Data
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Number of Trajectories *
              </label>
              <input
                type="number"
                min="1"
                value={data.trajectoryCount || ''}
                onChange={(e) =>
                  updateData({ trajectoryCount: parseInt(e.target.value, 10) || undefined })
                }
                placeholder="Enter trajectory count"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Each trajectory earns credits based on your license type and data quality
              </p>
            </div>

            {/* Placeholder for file upload UI */}
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center">
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600 dark:text-gray-400">
                Data upload integration coming soon
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                For now, enter the trajectory count manually
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Submit */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Review & Submit
            </h2>

            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Robot Type</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {data.metadata.robotType}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">License</span>
                <span className="font-medium text-gray-900 dark:text-gray-100 capitalize">
                  {data.licenseType?.replace('_', ' ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Trajectories</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {data.trajectoryCount?.toLocaleString()}
                </span>
              </div>
              {data.estimatedCredits && (
                <div className="flex justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-gray-600 dark:text-gray-400">Estimated Credits</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {data.estimatedCredits.toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              By submitting, you confirm that you have the rights to this data and agree to the
              selected license terms.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={currentStep === 0 ? onCancel : handleBack}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
        >
          <ChevronLeft size={18} />
          {currentStep === 0 ? 'Cancel' : 'Back'}
        </button>

        {currentStep < STEPS.length - 1 ? (
          <button
            onClick={handleNext}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                Next
                <ChevronRight size={18} />
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                Submit for Review
                <Send size={18} />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
