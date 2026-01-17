/**
 * @file LicenseSelector.tsx
 * @description License type selection component for contribution wizard
 * @feature contributions
 */

import { cn } from '@/shared/utils/cn';
import { Check, Shield, Share2, Lock, FlaskConical } from 'lucide-react';
import type { ContributionLicenseType } from '../types/contributions.types';
import {
  LICENSE_TYPE_LABELS,
  LICENSE_TYPE_DESCRIPTIONS,
} from '../types/contributions.types';

// ============================================================================
// TYPES
// ============================================================================

export interface LicenseSelectorProps {
  value?: ContributionLicenseType;
  onChange: (license: ContributionLicenseType) => void;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const LICENSE_CONFIG: Record<
  ContributionLicenseType,
  {
    icon: typeof Shield;
    creditMultiplier: string;
    features: string[];
  }
> = {
  exclusive: {
    icon: Lock,
    creditMultiplier: '2x',
    features: [
      'Highest credit rewards',
      'Data used exclusively for RoboMind',
      'Priority review processing',
    ],
  },
  non_exclusive: {
    icon: Share2,
    creditMultiplier: '1x',
    features: [
      'Standard credit rewards',
      'You retain rights to use data elsewhere',
      'Most flexible option',
    ],
  },
  limited: {
    icon: Shield,
    creditMultiplier: '0.75x',
    features: [
      'Moderate credit rewards',
      'Data used only for specific purposes',
      'More control over usage',
    ],
  },
  research_only: {
    icon: FlaskConical,
    creditMultiplier: '0.5x',
    features: [
      'Lower credit rewards',
      'Data used only for research',
      'Published in anonymized datasets',
    ],
  },
};

const LICENSE_ORDER: ContributionLicenseType[] = [
  'exclusive',
  'non_exclusive',
  'limited',
  'research_only',
];

// ============================================================================
// COMPONENT
// ============================================================================

export function LicenseSelector({
  value,
  onChange,
  className,
}: LicenseSelectorProps) {
  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-4', className)}>
      {LICENSE_ORDER.map((licenseType) => {
        const config = LICENSE_CONFIG[licenseType];
        const Icon = config.icon;
        const isSelected = value === licenseType;

        return (
          <button
            key={licenseType}
            onClick={() => onChange(licenseType)}
            className={cn(
              'relative flex flex-col p-4 rounded-lg border-2 text-left transition-all',
              isSelected
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            )}
          >
            {/* Selected Checkmark */}
            {isSelected && (
              <div className="absolute top-3 right-3 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                <Check size={12} className="text-white" />
              </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-3 mb-3">
              <div
                className={cn(
                  'p-2 rounded-lg',
                  isSelected
                    ? 'bg-primary-100 dark:bg-primary-800'
                    : 'bg-gray-100 dark:bg-gray-800'
                )}
              >
                <Icon
                  size={20}
                  className={cn(
                    isSelected
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                />
              </div>
              <div>
                <h3
                  className={cn(
                    'font-medium',
                    isSelected
                      ? 'text-primary-900 dark:text-primary-100'
                      : 'text-gray-900 dark:text-gray-100'
                  )}
                >
                  {LICENSE_TYPE_LABELS[licenseType]}
                </h3>
                <span
                  className={cn(
                    'text-sm font-medium',
                    isSelected
                      ? 'text-primary-600 dark:text-primary-400'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  {config.creditMultiplier} credits
                </span>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {LICENSE_TYPE_DESCRIPTIONS[licenseType]}
            </p>

            {/* Features */}
            <ul className="space-y-1.5">
              {config.features.map((feature, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400"
                >
                  <Check
                    size={14}
                    className={cn(
                      'mt-0.5 flex-shrink-0',
                      isSelected
                        ? 'text-primary-500'
                        : 'text-gray-400 dark:text-gray-500'
                    )}
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}
