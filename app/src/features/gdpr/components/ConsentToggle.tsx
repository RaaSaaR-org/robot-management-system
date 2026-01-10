/**
 * @file ConsentToggle.tsx
 * @description Toggle component for consent management
 * @feature gdpr
 */

import type { UserConsent, ConsentType } from '../types';
import { CONSENT_TYPE_LABELS, CONSENT_TYPE_DESCRIPTIONS } from '../types';

export interface ConsentToggleProps {
  consent: UserConsent | null;
  type: ConsentType;
  onToggle: (type: ConsentType, granted: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function ConsentToggle({
  consent,
  type,
  onToggle,
  disabled = false,
  className = '',
}: ConsentToggleProps) {
  const granted = consent?.granted ?? false;
  const label = CONSENT_TYPE_LABELS[type];
  const description = CONSENT_TYPE_DESCRIPTIONS[type];

  const handleToggle = () => {
    if (!disabled) {
      onToggle(type, !granted);
    }
  };

  return (
    <div
      className={`flex items-start justify-between gap-4 p-4 section-secondary rounded-lg border border-theme ${className}`}
    >
      <div className="flex-1">
        <h4 className="font-medium text-theme-primary">{label}</h4>
        <p className="text-sm text-theme-secondary mt-1">{description}</p>
        {consent?.grantedAt && granted && (
          <p className="text-xs text-theme-tertiary mt-2">
            Granted on {new Date(consent.grantedAt).toLocaleDateString()}
          </p>
        )}
        {consent?.revokedAt && !granted && (
          <p className="text-xs text-theme-tertiary mt-2">
            Revoked on {new Date(consent.revokedAt).toLocaleDateString()}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={granted}
        disabled={disabled}
        onClick={handleToggle}
        className={`
          relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
          transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cobalt focus:ring-offset-2
          ${granted ? 'bg-cobalt' : 'bg-gray-300 dark:bg-gray-600'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <span className="sr-only">{label}</span>
        <span
          className={`
            pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
            transition duration-200 ease-in-out
            ${granted ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </button>
    </div>
  );
}
