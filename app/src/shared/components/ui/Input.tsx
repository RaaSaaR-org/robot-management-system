/**
 * @file Input.tsx
 * @description Text input on the kit's field look, with an optional built-in
 *              label, helper text, error and icons. Inside a FormField, leave
 *              `label`/`error` to the FormField.
 * @feature shared
 * @dependencies shared/utils/cn
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from '@/shared/utils/cn';
import { fieldBase, fieldError, fieldHint, fieldInvalid, fieldLabel, fieldSizes, fieldValid } from './styles';

// ============================================================================
// TYPES
// ============================================================================

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Input label text */
  label?: string;
  /** Helper text below input */
  helperText?: string;
  /** Error message (shows error state when provided) */
  error?: string;
  /** Error look without a message (FormField sets aria-invalid, which works too) */
  invalid?: boolean;
  /** Icon to display on the left */
  leftIcon?: ReactNode;
  /** Icon to display on the right */
  rightIcon?: ReactNode;
  /** Input size: sm 32px · md 38px · lg 44px */
  size?: InputSize;
  /** Full width input */
  fullWidth?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const iconPad: Record<InputSize, { left: string; right: string; pos: string }> = {
  sm: { left: 'pl-8', right: 'pr-8', pos: 'px-2.5' },
  md: { left: 'pl-9', right: 'pr-9', pos: 'px-3' },
  lg: { left: 'pl-10', right: 'pr-10', pos: 'px-3.5' },
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * @example
 * ```tsx
 * <Input label="Email" placeholder="you@example.com" />
 * <Input label="Password" type="password" error="Password is required" />
 * <Input leftIcon={<Search className="w-4 h-4" />} placeholder="Search…" />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, error, invalid, leftIcon, rightIcon, size = 'md', fullWidth = false, disabled, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const ariaInvalid = props['aria-invalid'];
  const hasError = Boolean(error) || Boolean(invalid) || ariaInvalid === true || ariaInvalid === 'true';

  return (
    <div className={cn('flex flex-col gap-1.5', fullWidth && 'w-full')}>
      {label && (
        <label htmlFor={inputId} className={cn(fieldLabel, disabled && 'opacity-50')}>
          {label}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 flex items-center text-ink-tertiary [&_svg]:h-4 [&_svg]:w-4',
              iconPad[size].pos,
            )}
            aria-hidden="true"
          >
            {leftIcon}
          </div>
        )}

        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={cn(
            fieldBase,
            fieldSizes[size],
            hasError ? fieldInvalid : fieldValid,
            leftIcon && iconPad[size].left,
            rightIcon && iconPad[size].right,
            className,
          )}
          {...props}
        />

        {rightIcon && (
          <div
            className={cn(
              'absolute inset-y-0 right-0 flex items-center text-ink-tertiary [&_svg]:h-4 [&_svg]:w-4',
              iconPad[size].pos,
            )}
            aria-hidden="true"
          >
            {rightIcon}
          </div>
        )}
      </div>

      {error && (
        <p id={errorId} className={fieldError} role="alert">
          {error}
        </p>
      )}

      {!error && helperText && (
        <p id={helperId} className={fieldHint}>
          {helperText}
        </p>
      )}
    </div>
  );
});
