/**
 * @file Card.tsx
 * @description Container card component with shadow and hover effects
 * @feature shared
 * @dependencies shared/utils/cn
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export type CardVariant = 'default' | 'glass' | 'elevated' | 'subtle' | 'outlined';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Card content */
  children: ReactNode;
  /** Remove default padding */
  noPadding?: boolean;
  /** Disable hover effects */
  noHover?: boolean;
  /** Add interactive cursor and enhanced hover */
  interactive?: boolean;
  /** Card variant for different visual styles */
  variant?: CardVariant;
}

export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const variantStyles: Record<CardVariant, string> = {
  default: '', // Uses .card class from CSS which applies glass-card
  glass: '', // Same as default, explicitly glass
  elevated: 'glass-elevated', // Enhanced glass with stronger blur and shadow
  subtle: 'glass-subtle !rounded-brand', // Subtle glass for nested elements
  outlined: 'bg-transparent shadow-none backdrop-blur-none border border-theme',
};

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * A container card component with shadow and optional hover effects.
 * Uses compound component pattern with Card.Header, Card.Body, and Card.Footer.
 *
 * @example
 * ```tsx
 * <Card>
 *   <Card.Header>Title</Card.Header>
 *   <Card.Body>Content goes here</Card.Body>
 *   <Card.Footer>Footer actions</Card.Footer>
 * </Card>
 *
 * <Card variant="elevated" interactive>
 *   Clickable elevated card
 * </Card>
 * ```
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  function Card(
    {
      children,
      noPadding = false,
      noHover = false,
      interactive = false,
      variant = 'default',
      className,
      ...props
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          // Base card styles (from index.css .card class which uses glass-card)
          'card',
          // Variant styles
          variantStyles[variant],
          // Padding (not for subtle variant which has its own smaller padding)
          !noPadding && variant !== 'subtle' && 'p-6',
          // Interactive styles - use glass-card-interactive for hover/active effects
          interactive && 'glass-card-interactive',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
) as CardComponent;

/**
 * Card header section with bottom border.
 */
const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  function CardHeader({ children, className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'px-6 py-4 border-b border-glass-subtle',
          '-mx-6 -mt-6 mb-6', // Offset parent padding
          'first:rounded-t-brand-lg',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

/**
 * Card body section for main content.
 */
const CardBody = forwardRef<HTMLDivElement, CardBodyProps>(
  function CardBody({ children, className, ...props }, ref) {
    return (
      <div ref={ref} className={cn('flex-1', className)} {...props}>
        {children}
      </div>
    );
  }
);

/**
 * Card footer section with top border.
 */
const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  function CardFooter({ children, className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'px-6 py-4 border-t border-glass-subtle',
          '-mx-6 -mb-6 mt-6', // Offset parent padding
          'last:rounded-b-brand-lg',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

// ============================================================================
// COMPOUND COMPONENT TYPE
// ============================================================================

interface CardComponent
  extends React.ForwardRefExoticComponent<CardProps & React.RefAttributes<HTMLDivElement>> {
  Header: typeof CardHeader;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
}

// Attach subcomponents
Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;
