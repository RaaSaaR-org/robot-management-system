/**
 * @file RequestTypeCard.tsx
 * @description Card component for selecting GDPR request type
 * @feature gdpr
 */

import type { GDPRRequestType } from '../types';
import { REQUEST_TYPE_LABELS, REQUEST_TYPE_DESCRIPTIONS } from '../types';

export interface RequestTypeCardProps {
  type: GDPRRequestType;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

const TYPE_ICONS: Record<GDPRRequestType, string> = {
  access: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  rectification: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  erasure: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  restriction: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
  portability: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  objection: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
  adm_review: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
};

export function RequestTypeCard({
  type,
  onClick,
  disabled = false,
  className = '',
}: RequestTypeCardProps) {
  const label = REQUEST_TYPE_LABELS[type];
  const description = REQUEST_TYPE_DESCRIPTIONS[type];
  const iconPath = TYPE_ICONS[type];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        w-full p-4 text-left rounded-lg border-2 transition-all
        ${disabled
          ? 'border-theme opacity-60 cursor-not-allowed'
          : 'border-theme section-secondary hover:border-cobalt hover:shadow-md cursor-pointer'
        }
        ${className}
      `}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${disabled ? 'bg-gray-200 dark:bg-gray-700' : 'bg-cobalt/10'}`}>
          <svg
            className={`w-6 h-6 ${disabled ? 'text-theme-tertiary' : 'text-cobalt'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d={iconPath}
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className={`font-medium ${disabled ? 'text-theme-tertiary' : 'text-theme-primary'}`}>
            {label}
          </h3>
          <p className={`text-sm mt-1 ${disabled ? 'text-theme-tertiary' : 'text-theme-secondary'}`}>
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}
