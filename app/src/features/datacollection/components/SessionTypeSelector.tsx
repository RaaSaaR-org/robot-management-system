/**
 * @file SessionTypeSelector.tsx
 * @description Teleoperation input picker: a radio-card grid (one column on
 *              phones, two at sm, three at xl), selected = primary border.
 * @feature datacollection
 */

import { Check, Headset, Glasses, Hand, Keyboard, Gamepad2, Monitor, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { TeleoperationType } from '../types/datacollection.types';
import { TELEOPERATION_TYPE_LABELS, TELEOPERATION_TYPE_DESCRIPTIONS } from '../types/datacollection.types';

export interface SessionTypeSelectorProps {
  value?: TeleoperationType;
  onChange: (type: TeleoperationType) => void;
  disabled?: boolean;
  className?: string;
  /** Marks the group invalid (e.g. submitted without a choice). */
  invalid?: boolean;
}

export const TYPE_ICONS: Record<TeleoperationType, LucideIcon> = {
  vr_quest: Headset,
  vr_vision_pro: Glasses,
  bilateral_aloha: Monitor,
  kinesthetic: Hand,
  keyboard_mouse: Keyboard,
  gamepad: Gamepad2,
};

const TYPE_ORDER: TeleoperationType[] = [
  'vr_quest', 'vr_vision_pro', 'bilateral_aloha', 'kinesthetic', 'keyboard_mouse', 'gamepad',
];

export function SessionTypeSelector({ value, onChange, disabled, className, invalid }: SessionTypeSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Teleoperation input"
      aria-invalid={invalid || undefined}
      className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}
    >
      {TYPE_ORDER.map((type) => {
        const Icon = TYPE_ICONS[type];
        const isSelected = value === type;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChange(type)}
            className={cn(
              'relative flex items-start gap-3 rounded-control border p-4 text-left transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
              'disabled:cursor-not-allowed disabled:opacity-50',
              isSelected
                ? 'border-primary bg-primary/10'
                : cn('bg-panel hover:border-line-strong', invalid ? 'border-signal-stopped/60' : 'border-line'),
            )}
          >
            <span
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-control',
                isSelected ? 'bg-primary/15 text-primary' : 'bg-inset text-ink-tertiary',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 pr-5">
              <span className="block text-sm font-semibold text-ink-primary">{TELEOPERATION_TYPE_LABELS[type]}</span>
              <span className="mt-0.5 block text-[13px] text-ink-tertiary">{TELEOPERATION_TYPE_DESCRIPTIONS[type]}</span>
            </span>
            {isSelected && (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-on-primary">
                <Check className="h-3 w-3" strokeWidth={2.5} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
