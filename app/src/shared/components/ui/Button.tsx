/**
 * @file Button.tsx
 * @description The kit's button: primary · secondary · ghost · danger in three
 *              sizes, icon-only squares and a loading state. `buttonClasses()`
 *              is exported so LinkButton (and the rare custom element) share
 *              the exact look.
 * @feature shared
 * @dependencies shared/utils/cn, shared/components/ui/Spinner
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { Spinner } from './Spinner';
import { focusRing } from './styles';

// ============================================================================
// TYPES
// ============================================================================

/** `outline` (= secondary) and `destructive` (= danger) are legacy names kept for old call sites. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant (default `primary`) */
  variant?: ButtonVariant;
  /** Button size: sm 32px · md 38px · lg 44px (default `md`) */
  size?: ButtonSize;
  /** Square icon-only button. Requires `aria-label`. */
  iconOnly?: boolean;
  /** Show loading spinner and disable interaction */
  isLoading?: boolean;
  /** Text shown while loading (defaults to the children) */
  loadingText?: string;
  /** Icon to display before children */
  leftIcon?: ReactNode;
  /** Icon to display after children */
  rightIcon?: ReactNode;
  /** Full width button */
  fullWidth?: boolean;
  /** Button content (optional for icon-only buttons) */
  children?: ReactNode;
}

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'border border-line-strong text-ink-primary hover:bg-raised',
  outline: 'border border-line-strong text-ink-primary hover:bg-raised',
  ghost: 'text-ink-secondary hover:text-ink-primary hover:bg-raised',
  danger: 'bg-stop text-on-stop hover:brightness-110',
  destructive: 'bg-stop text-on-stop hover:brightness-110',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-[38px] px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
};

const iconOnlySizes: Record<ButtonSize, string> = {
  sm: 'h-8 w-8 px-0',
  md: 'h-[38px] w-[38px] px-0',
  lg: 'h-11 w-11 px-0',
};

const spinnerSizes: Record<ButtonSize, 'xs' | 'sm'> = {
  sm: 'xs',
  md: 'sm',
  lg: 'sm',
};

/**
 * The button look as a class string, for elements that must be something other
 * than a `<button>` (a router Link, a label wrapping a file input).
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  fullWidth = false,
  disabled = false,
  className,
}: ButtonClassOptions = {}): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control font-medium leading-none',
    'transition-[background-color,color,border-color,filter] duration-150 ease-[var(--ease-instrument)]',
    'cursor-pointer select-none',
    focusRing,
    variantStyles[variant],
    iconOnly ? iconOnlySizes[size] : sizeStyles[size],
    fullWidth && 'w-full',
    disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
    className,
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * @example
 * ```tsx
 * <Button>Save changes</Button>
 * <Button variant="secondary" leftIcon={<Pencil className="w-4 h-4" />}>Edit</Button>
 * <Button variant="ghost" size="sm" iconOnly aria-label="Close"><X className="w-4 h-4" /></Button>
 * <Button isLoading loadingText="Saving…">Save</Button>
 * <Button variant="danger">Delete</Button>
 * ```
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    iconOnly = false,
    isLoading = false,
    loadingText,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || isLoading;
  const label = isLoading && loadingText ? loadingText : children;
  const hasLabel = label !== undefined && label !== null && label !== false && label !== '';

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={isLoading}
      className={buttonClasses({ variant, size, iconOnly, fullWidth, disabled: isDisabled, className })}
      {...props}
    >
      {isLoading && <Spinner size={spinnerSizes[size]} color="current" label="Loading" />}

      {!isLoading && leftIcon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      )}

      {iconOnly
        ? !isLoading && children
        : hasLabel &&
          // Plain text gets a truncating span. Mixed children (an icon passed as a
          // child, the legacy pattern) render as direct flex items: wrapped in one
          // span, the block-level svg would stack above the text.
          (typeof label === 'string' || typeof label === 'number' ? <span className="truncate">{label}</span> : label)}

      {!isLoading && rightIcon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </button>
  );
});
