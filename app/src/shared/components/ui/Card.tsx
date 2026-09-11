/**
 * @file Card.tsx
 * @description Legacy container, kept so its ~340 call sites compile. It now
 *              renders the Panel surface: default/elevated → default panel,
 *              subtle → inset, outlined → a hairline box without fill.
 *              New code uses Panel.
 * @feature shared
 * @dependencies shared/utils/cn, shared/components/ui/Panel
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { panelClasses } from './Panel';
import { focusRing } from './styles';

// ============================================================================
// TYPES
// ============================================================================

export type CardVariant = 'default' | 'elevated' | 'subtle' | 'outlined';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Card content */
  children: ReactNode;
  /** Remove default padding */
  noPadding?: boolean;
  /** Kept for compatibility; panels have no hover effect unless interactive */
  noHover?: boolean;
  /** Add interactive cursor and hover border */
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

function variantClasses(variant: CardVariant): string {
  switch (variant) {
    case 'subtle':
      return panelClasses({ variant: 'inset', padding: 'none' });
    case 'outlined':
      return 'relative min-w-0 bg-transparent border border-line rounded-panel';
    default:
      return panelClasses({ variant: 'default', padding: 'none' });
  }
}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * @example
 * ```tsx
 * <Card>
 *   <Card.Header>Title</Card.Header>
 *   <Card.Body>Content goes here</Card.Body>
 *   <Card.Footer>Footer actions</Card.Footer>
 * </Card>
 * ```
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { children, noPadding = false, noHover: _noHover = false, interactive = false, variant = 'default', className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        variantClasses(variant),
        // The old `.card` class clipped its content; call sites rely on it.
        'overflow-hidden',
        // Subtle cards never had default padding — call sites pad them.
        !noPadding && variant !== 'subtle' && 'p-5',
        interactive &&
          cn('cursor-pointer transition-colors duration-150 hover:border-line-strong', focusRing),
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}) as CardComponent;

/** Card header section with a hairline below; offsets the card's own padding. */
const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { children, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'px-5 py-4 border-b border-line-subtle',
        '-mx-5 -mt-5 mb-5',
        'font-display text-base font-semibold tracking-[-0.01em] text-ink-primary',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

/** Card body section for main content. */
const CardBody = forwardRef<HTMLDivElement, CardBodyProps>(function CardBody({ children, className, ...props }, ref) {
  return (
    <div ref={ref} className={cn('flex-1', className)} {...props}>
      {children}
    </div>
  );
});

/** Card footer section with a hairline above; offsets the card's own padding. */
const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(function CardFooter(
  { children, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('px-5 py-3 border-t border-line-subtle', '-mx-5 -mb-5 mt-5', className)}
      {...props}
    >
      {children}
    </div>
  );
});

// ============================================================================
// COMPOUND COMPONENT TYPE
// ============================================================================

interface CardComponent
  extends React.ForwardRefExoticComponent<CardProps & React.RefAttributes<HTMLDivElement>> {
  Header: typeof CardHeader;
  Body: typeof CardBody;
  Footer: typeof CardFooter;
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;
