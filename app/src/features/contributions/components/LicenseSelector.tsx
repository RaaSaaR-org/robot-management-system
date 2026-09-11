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
      'Data used exclusively for this platform',
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
                ? 'border-primary bg-primary/10 '
                : 'border-line hover:border-line-strong '
            )}
          >
            {/* Selected Checkmark */}
            {isSelected && (
              <div className="absolute top-3 right-3 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                <Check size={12} className="text-on-primary" />
              </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-3 mb-3">
              <div
                className={cn(
                  'p-2 rounded-lg',
                  isSelected
                    ? 'bg-primary/10 '
                    : 'bg-inset '
                )}
              >
                <Icon
                  size={20}
                  className={cn(
                    isSelected
                      ? 'text-primary '
                      : 'text-ink-tertiary '
                  )}
                />
              </div>
              <div>
                <h3
                  className={cn(
                    'font-medium',
                    isSelected
                      ? 'text-ink-primary '
                      : 'text-ink-primary '
                  )}
                >
                  {LICENSE_TYPE_LABELS[licenseType]}
                </h3>
                <span
                  className={cn(
                    'text-sm font-medium',
                    isSelected
                      ? 'text-primary '
                      : 'text-ink-tertiary '
                  )}
                >
                  {config.creditMultiplier} credits
                </span>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-ink-secondary mb-3">
              {LICENSE_TYPE_DESCRIPTIONS[licenseType]}
            </p>

            {/* Features */}
            <ul className="space-y-1.5">
              {config.features.map((feature, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-sm text-ink-secondary"
                >
                  <Check
                    size={14}
                    className={cn(
                      'mt-0.5 flex-shrink-0',
                      isSelected
                        ? 'text-primary'
                        : 'text-ink-muted '
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
