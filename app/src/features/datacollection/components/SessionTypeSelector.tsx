/**
 * @file SessionTypeSelector.tsx
 * @description Teleoperation type selection component with cobalt selection ring
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
              'relative flex items-start gap-3 p-4 rounded-brand border-2 text-left transition-all',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              isSelected
                ? 'border-cobalt-500 bg-cobalt-500/10'
                : 'border-glass-subtle hover:border-glass-highlight bg-transparent'
            )}
          >
            {isSelected && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-cobalt-500 rounded-full flex items-center justify-center">
                <Check size={12} className="text-white" />
              </div>
            )}

            <div
              className={cn(
                'p-2 rounded-brand',
                isSelected
                  ? 'bg-cobalt-500/20'
                  : 'bg-glass-subtle'
              )}
            >
              <Icon
                size={24}
                className={cn(
                  isSelected
                    ? 'text-cobalt-400'
                    : 'text-theme-muted'
                )}
              />
            </div>

            <div className="flex-1 min-w-0">
              <h4
                className={cn(
                  'font-medium',
                  isSelected
                    ? 'text-cobalt-400'
                    : 'text-theme-primary'
                )}
              >
                {TELEOPERATION_TYPE_LABELS[type]}
              </h4>
              <p className="text-xs text-theme-muted mt-0.5">
                {TELEOPERATION_TYPE_DESCRIPTIONS[type]}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
