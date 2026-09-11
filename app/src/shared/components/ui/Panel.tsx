/**
 * @file Panel.tsx
 * @description The kit's surface. Content sits on the canvas in Panels; a panel
 *              inside a panel is an `inset` panel. Matte: a hairline border and
 *              a ground change do the separating — no blur, no glow, no lift.
 * @feature shared
 */

import {
  Children,
  forwardRef,
  isValidElement,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/shared/utils/cn';
import { Eyebrow } from './Eyebrow';
import { focusRing, panelTitle } from './styles';

// ============================================================================
// TYPES
// ============================================================================

export type PanelVariant = 'default' | 'inset' | 'highlight';
export type PanelPadding = 'none' | 'sm' | 'md';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** default = bg-panel · inset = a well inside a panel · highlight = the landing's gradient panel */
  variant?: PanelVariant;
  /** Hover border, pointer cursor; focusable and Enter/Space-activatable when `onClick` is set */
  interactive?: boolean;
  /**
   * Inner padding. Defaults to `md` (20px), or `none` when the panel is built from
   * Panel.Header / Panel.Body / Panel.Footer, which pad themselves. Explicit
   * `none` also clips flush content (a DataTable) to the panel's radius.
   */
  padding?: PanelPadding;
  /** Render as a landmark-ish element instead of a div */
  as?: 'div' | 'section' | 'article' | 'aside';
  children?: ReactNode;
}

export interface PanelHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Panel title (Archivo 16px 600) */
  title?: ReactNode;
  /** One line under the title */
  description?: ReactNode;
  /** Small uppercase label above the title */
  eyebrow?: ReactNode;
  /** Right-aligned controls */
  actions?: ReactNode;
  /** Heading level of the title (default h2) */
  titleAs?: 'h2' | 'h3';
  /** Drop the hairline under the header */
  borderless?: boolean;
  children?: ReactNode;
}

export type PanelBodyProps = HTMLAttributes<HTMLDivElement>;
export type PanelFooterProps = HTMLAttributes<HTMLDivElement>;

// ============================================================================
// CLASSES
// ============================================================================

const variantStyles: Record<PanelVariant, string> = {
  default: 'bg-panel border border-line rounded-panel',
  inset: 'bg-inset border border-line-subtle rounded-control',
  highlight:
    'bg-[linear-gradient(135deg,var(--panel-highlight-from),var(--bg-secondary))] border border-line rounded-panel',
};

const paddingStyles: Record<PanelPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
};

/** Panel surface classes, for the rare element that must look like a panel. */
export function panelClasses({
  variant = 'default',
  interactive = false,
  padding = 'md',
}: { variant?: PanelVariant; interactive?: boolean; padding?: PanelPadding } = {}): string {
  return cn(
    'relative min-w-0',
    variantStyles[variant],
    paddingStyles[padding],
    interactive &&
      cn(
        'cursor-pointer transition-colors duration-150 ease-[var(--ease-instrument)] hover:border-line-strong',
        focusRing,
      ),
  );
}

// ============================================================================
// SECTIONS
// ============================================================================

const PanelHeader = forwardRef<HTMLDivElement, PanelHeaderProps>(function PanelHeader(
  { title, description, eyebrow, actions, titleAs: TitleTag = 'h2', borderless = false, className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4',
        borderless ? 'pb-0' : 'pb-4 border-b border-line-subtle',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1 basis-[12rem]">
        {eyebrow && <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow>}
        {title && <TitleTag className={panelTitle}>{title}</TitleTag>}
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
});

const PanelBody = forwardRef<HTMLDivElement, PanelBodyProps>(function PanelBody({ className, ...props }, ref) {
  return <div ref={ref} className={cn('p-5', className)} {...props} />;
});

const PanelFooter = forwardRef<HTMLDivElement, PanelFooterProps>(function PanelFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle px-5 py-3', className)}
      {...props}
    />
  );
});

const SECTION_TYPES = new Set<unknown>([PanelHeader, PanelBody, PanelFooter]);

// ============================================================================
// PANEL
// ============================================================================

/**
 * @example
 * ```tsx
 * <Panel>Plain padded content</Panel>
 *
 * <Panel>
 *   <Panel.Header title="Recent runs" description="Last 24 hours" actions={<Button size="sm" variant="secondary">View all</Button>} />
 *   <Panel.Body>…</Panel.Body>
 * </Panel>
 *
 * <Panel padding="none"><DataTable … /></Panel>
 * <Panel interactive onClick={() => navigate(`/robots/${id}`)}>…</Panel>
 * ```
 */
const PanelRoot = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { variant = 'default', interactive = false, padding, as: Tag = 'div', className, children, onClick, onKeyDown, ...props },
  ref,
) {
  const hasSections = Children.toArray(children).some(
    (child) => isValidElement(child) && SECTION_TYPES.has(child.type),
  );
  const resolvedPadding: PanelPadding = padding ?? (hasSections ? 'none' : 'md');
  const activatable = interactive && Boolean(onClick);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (!activatable || event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      (event.currentTarget as HTMLDivElement).click();
    }
  };

  return (
    <Tag
      ref={ref}
      tabIndex={activatable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        panelClasses({ variant, interactive, padding: resolvedPadding }),
        padding === 'none' && 'overflow-hidden',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
});

interface PanelComponent
  extends React.ForwardRefExoticComponent<PanelProps & React.RefAttributes<HTMLDivElement>> {
  Header: typeof PanelHeader;
  Body: typeof PanelBody;
  Footer: typeof PanelFooter;
}

export const Panel = PanelRoot as PanelComponent;
Panel.Header = PanelHeader;
Panel.Body = PanelBody;
Panel.Footer = PanelFooter;
