/**
 * @file Switch.tsx
 * @description On/off switch: a button with role="switch" and aria-checked.
 *              For settings that apply immediately; inside forms that submit,
 *              a Checkbox is usually the better fit.
 * @feature shared
 */

import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'aria-checked' | 'children'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label (clicking it toggles); omit and pass aria-label for a bare switch */
  label?: ReactNode;
  /** Second line under the label */
  description?: ReactNode;
  /** sm 16px tall · md 20px tall (default md) */
  size?: 'sm' | 'md';
  /** Put the label on the left and the switch on the right (settings rows) */
  labelPosition?: 'left' | 'right';
}

const TRACK = { sm: 'h-4 w-7', md: 'h-5 w-9' } as const;
const THUMB = { sm: 'h-2.5 w-2.5', md: 'h-3.5 w-3.5' } as const;
const THUMB_ON = { sm: 'translate-x-[13px]', md: 'translate-x-[17px]' } as const;

/**
 * @example
 * ```tsx
 * <Switch label="Auto-dock when idle" checked={autoDock} onCheckedChange={setAutoDock} />
 * <Switch aria-label="Enable schedule" checked={enabled} onCheckedChange={setEnabled} size="sm" />
 * ```
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, description, size = 'md', labelPosition = 'right', disabled, className, id, onClick, ...props },
  ref,
) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const labelId = `${switchId}-label`;
  const descriptionId = description ? `${switchId}-description` : undefined;

  const control = (
    <button
      ref={ref}
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={descriptionId}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border p-px',
        'transition-colors duration-150 ease-[var(--ease-instrument)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        focusRing,
        TRACK[size],
        checked ? 'border-primary bg-primary' : 'border-line-strong bg-inset',
        !label && className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block rounded-full transition-transform duration-150 ease-[var(--ease-instrument)]',
          THUMB[size],
          checked ? cn('bg-on-primary', THUMB_ON[size]) : 'translate-x-[2px] bg-ink-tertiary',
        )}
      />
    </button>
  );

  if (!label) return control;

  const text = (
    <span className="min-w-0">
      <label id={labelId} htmlFor={switchId} className={cn('block text-sm text-ink-primary', !disabled && 'cursor-pointer')}>
        {label}
      </label>
      {description && (
        <span id={descriptionId} className="mt-0.5 block text-xs text-ink-tertiary">
          {description}
        </span>
      )}
    </span>
  );

  return (
    <div
      className={cn(
        'flex items-start gap-3',
        labelPosition === 'left' && 'justify-between',
        disabled && 'opacity-70',
        className,
      )}
    >
      {labelPosition === 'left' ? (
        <>
          {text}
          <span className="pt-0.5">{control}</span>
        </>
      ) : (
        <>
          <span className="pt-0.5">{control}</span>
          {text}
        </>
      )}
    </div>
  );
});
