/**
 * @file Button.tsx
 * @description Primary button component with variants, sizes, and loading state
 * @feature shared
 * @dependencies shared/utils/cn, shared/components/ui/Spinner
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { Spinner } from './Spinner';

// ============================================================================
// TYPES
// ============================================================================

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Button size */
  size?: ButtonSize;
  /** Show loading spinner and disable interaction */
  isLoading?: boolean;
  /** Loading text to display */
  loadingText?: string;
  /** Icon to display before children */
  leftIcon?: ReactNode;
  /** Icon to display after children */
  rightIcon?: ReactNode;
  /** Full width button */
  fullWidth?: boolean;
  /** Button content */
  children: ReactNode;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-cobalt text-white hover:bg-cobalt-600 focus:ring-cobalt-500 hover:shadow-lg',
  secondary: 'border-2 border-cobalt text-cobalt hover:bg-cobalt hover:text-white focus:ring-cobalt-500',
  outline: 'border-2 border-theme-strong text-theme-primary hover:bg-theme-elevated focus:ring-cobalt-500',
  ghost: 'text-theme-secondary hover:text-theme-primary hover:bg-theme-elevated focus:ring-cobalt-500',
  destructive: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-500',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-6 py-3 gap-2',
  lg: 'px-8 py-4 text-lg gap-2.5',
};

const spinnerSizes: Record<ButtonSize, 'xs' | 'sm' | 'md'> = {
  sm: 'xs',
  md: 'sm',
  lg: 'md',
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * A versatile button component with multiple variants, sizes, and loading state support.
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="md">Click me</Button>
 * <Button variant="secondary" leftIcon={<Icon />}>With Icon</Button>
 * <Button isLoading loadingText="Saving...">Save</Button>
 * <Button variant="destructive" fullWidth>Delete</Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      loadingText,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={isLoading}
        className={cn(
          // Base styles
          'inline-flex items-center justify-center font-medium rounded-brand',
          'transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-offset-2',
          // Variant and size
          variantStyles[variant],
          sizeStyles[size],
          // States
          fullWidth && 'w-full',
          isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          className
        )}
        {...props}
      >
        {/* Loading spinner */}
        {isLoading && (
          <Spinner
            size={spinnerSizes[size]}
            color={variant === 'primary' || variant === 'destructive' ? 'white' : 'current'}
            label="Loading"
          />
        )}

        {/* Left icon */}
        {!isLoading && leftIcon && (
          <span className="shrink-0" aria-hidden="true">
            {leftIcon}
          </span>
        )}

        {/* Button text */}
        <span>{isLoading && loadingText ? loadingText : children}</span>

        {/* Right icon */}
        {!isLoading && rightIcon && (
          <span className="shrink-0" aria-hidden="true">
            {rightIcon}
          </span>
        )}
      </button>
    );
  }
);
