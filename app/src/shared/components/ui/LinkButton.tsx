/**
 * @file LinkButton.tsx
 * @description A react-router Link that looks exactly like a Button. Use it for
 *              navigation ("New route" that opens a page, "Open in Fleet"); use
 *              Button for actions.
 * @feature shared
 */

import { forwardRef, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './Button';

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
}

/**
 * @example
 * ```tsx
 * <LinkButton to="/patrol/routes/new" leftIcon={<Plus className="w-4 h-4" />}>New route</LinkButton>
 * <LinkButton to="/fleet" variant="secondary" size="sm">Open fleet</LinkButton>
 * ```
 */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { variant = 'primary', size = 'md', iconOnly = false, fullWidth = false, leftIcon, rightIcon, className, children, ...props },
  ref,
) {
  return (
    <Link
      ref={ref}
      className={buttonClasses({
        variant,
        size,
        iconOnly,
        fullWidth,
        className: typeof className === 'string' ? className : undefined,
      })}
      {...props}
    >
      {leftIcon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      {iconOnly ? children : children !== undefined && <span className="truncate">{children}</span>}
      {rightIcon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </Link>
  );
});
