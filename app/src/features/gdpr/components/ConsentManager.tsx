/**
 * @file ConsentManager.tsx
 * @description Component for managing all user consents
 * @feature gdpr
 */

import { useEffect } from 'react';
import type { UserConsent, ConsentType } from '../types';
import { ConsentTypes } from '../types';
import { ConsentToggle } from './ConsentToggle';

export interface ConsentManagerProps {
  consents: UserConsent[];
  onToggle: (type: ConsentType, granted: boolean) => void;
  onLoad: () => void;
  isLoading?: boolean;
  isUpdating?: boolean;
  className?: string;
}

export function ConsentManager({
  consents,
  onToggle,
  onLoad,
  isLoading = false,
  isUpdating = false,
  className = '',
}: ConsentManagerProps) {
  useEffect(() => {
    onLoad();
  }, [onLoad]);

  const getConsentForType = (type: ConsentType): UserConsent | null => {
    return consents.find((c) => c.consentType === type) || null;
  };

  if (isLoading) {
    return (
      <div className={`space-y-3 ${className}`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="p-4 section-secondary rounded-lg border border-theme animate-pulse"
          >
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-300 dark:bg-gray-600 rounded w-2/3" />
              </div>
              <div className="h-6 w-11 bg-gray-300 dark:bg-gray-600 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="mb-4">
        <h3 className="text-lg font-medium text-theme-primary">Consent Preferences</h3>
        <p className="text-sm text-theme-secondary mt-1">
          Manage how your data is processed. You can change these settings at any time.
        </p>
      </div>

      <div className="space-y-3">
        {ConsentTypes.map((type) => (
          <ConsentToggle
            key={type}
            type={type}
            consent={getConsentForType(type)}
            onToggle={onToggle}
            disabled={isUpdating}
          />
        ))}
      </div>

      <div className="mt-4 p-3 bg-cobalt/10 rounded-lg border border-cobalt/20">
        <p className="text-sm text-theme-secondary">
          <strong className="text-theme-primary">Note:</strong> Some data processing may be required for the service to
          function. You can request information about mandatory processing in the Data
          Access section.
        </p>
      </div>
    </div>
  );
}
