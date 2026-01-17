/**
 * @file SessionTypeSelector.tsx
 * @description Teleoperation type selection component
 * @feature datacollection
 */

import { cn } from '@/shared/utils/cn';
import { Check, Headset, Glasses, Hand, Keyboard, Gamepad2, Monitor } from 'lucide-react';
import type { TeleoperationType } from '../types/datacollection.types';
import {
  TELEOPERATION_TYPE_LABELS,
  TELEOPERATION_TYPE_DESCRIPTIONS,
} from '../types/datacollection.types';

// ============================================================================
// TYPES
// ============================================================================

export interface SessionTypeSelectorProps {
  value?: TeleoperationType;
  onChange: (type: TeleoperationType) => void;
  disabled?: boolean;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TYPE_ICONS: Record<TeleoperationType, typeof Headset> = {
  vr_quest: Headset,
  vr_vision_pro: Glasses,
  bilateral_aloha: Monitor,
  kinesthetic: Hand,
  keyboard_mouse: Keyboard,
  gamepad: Gamepad2,
};

const TYPE_ORDER: TeleoperationType[] = [
  'vr_quest',
  'vr_vision_pro',
  'bilateral_aloha',
  'kinesthetic',
  'keyboard_mouse',
  'gamepad',
];

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionTypeSelector({
  value,
  onChange,
  disabled,
  className,
}: SessionTypeSelectorProps) {
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3', className)}>
      {TYPE_ORDER.map((type) => {
        const Icon = TYPE_ICONS[type];
        const isSelected = value === type;

        return (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onChange(type)}
            className={cn(
              'relative flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              isSelected
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            )}
          >
            {isSelected && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                <Check size={12} className="text-white" />
              </div>
            )}

            <div
              className={cn(
                'p-2 rounded-lg',
                isSelected
                  ? 'bg-primary-100 dark:bg-primary-800'
                  : 'bg-gray-100 dark:bg-gray-800'
              )}
            >
              <Icon
                size={24}
                className={cn(
                  isSelected
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-gray-500 dark:text-gray-400'
                )}
              />
            </div>

            <div className="flex-1 min-w-0">
              <h4
                className={cn(
                  'font-medium',
                  isSelected
                    ? 'text-primary-900 dark:text-primary-100'
                    : 'text-gray-900 dark:text-gray-100'
                )}
              >
                {TELEOPERATION_TYPE_LABELS[type]}
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {TELEOPERATION_TYPE_DESCRIPTIONS[type]}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
