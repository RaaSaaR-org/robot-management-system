/**
 * @file Input.tsx
 * @description Text input component with label, error state, and icon support
 * @feature shared
 * @dependencies shared/utils/cn
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from '@/shared/utils/cn';

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
  /** Icon to display on the left */
  leftIcon?: ReactNode;
  /** Icon to display on the right */
  rightIcon?: ReactNode;
  /** Input size */
  size?: InputSize;
  /** Full width input */
  fullWidth?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const sizeStyles: Record<InputSize, { input: string; icon: string }> = {
  sm: {
    input: 'py-1.5 text-sm',
    icon: 'w-4 h-4',
  },
  md: {
    input: 'py-2.5',
    icon: 'w-5 h-5',
  },
  lg: {
    input: 'py-3 text-lg',
    icon: 'w-6 h-6',
  },
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A text input component with optional label, icons, and error state.
 *
 * @example
 * ```tsx
 * <Input label="Email" placeholder="Enter your email" />
 * <Input label="Password" type="password" error="Password is required" />
 * <Input leftIcon={<SearchIcon />} placeholder="Search..." />
 * <Input label="Amount" rightIcon={<span>$</span>} />
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      size = 'md',
      fullWidth = false,
      disabled,
      className,
      id,
      ...props
    },
    ref
  ) {
    // Generate unique IDs for accessibility
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    const hasError = Boolean(error);

    return (
      <div className={cn('flex flex-col gap-1.5', fullWidth && 'w-full')}>
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'text-sm font-medium text-theme-secondary',
              disabled && 'opacity-50'
            )}
          >
            {label}
          </label>
        )}

        {/* Input wrapper */}
        <div className="relative">
          {/* Left icon */}
          {leftIcon && (
            <div
              className={cn(
                'absolute left-3 top-1/2 -translate-y-1/2 text-theme-tertiary',
                sizeStyles[size].icon
              )}
              aria-hidden="true"
            >
              {leftIcon}
            </div>
          )}

          {/* Input field */}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={hasError}
            aria-describedby={
              hasError ? errorId : helperText ? helperId : undefined
            }
            className={cn(
              // Base styles
              'w-full rounded-brand border bg-theme-card px-3',
              'text-theme-primary placeholder:text-theme-tertiary',
              'transition-colors duration-200',
              'focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-transparent',
              // Size
              sizeStyles[size].input,
              // Icon padding
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              // States
              hasError
                ? 'border-red-500 focus:ring-red-500'
                : 'border-theme',
              disabled && 'opacity-50 cursor-not-allowed bg-theme-elevated',
              className
            )}
            {...props}
          />

          {/* Right icon */}
          {rightIcon && (
            <div
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2 text-theme-tertiary',
                sizeStyles[size].icon
              )}
              aria-hidden="true"
            >
              {rightIcon}
            </div>
          )}
        </div>

        {/* Error message */}
        {hasError && (
          <p id={errorId} className="text-sm text-red-500" role="alert">
            {error}
          </p>
        )}

        {/* Helper text */}
        {!hasError && helperText && (
          <p id={helperId} className="text-sm text-theme-tertiary">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
