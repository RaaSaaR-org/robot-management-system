/**
 * @file Tooltip.tsx
 * @description Hover/focus tooltip and InfoIcon. Rendered in a portal and
 *              positioned from the trigger's rect, so it is never clipped by a
 *              scrolling table or a panel that hides its overflow.
 * @feature shared
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

// ============================================================================
// TOOLTIP
// ============================================================================

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** Tooltip body — can be text or richer content */
  content: ReactNode;
  /** Trigger element (the thing you hover) */
  children: ReactNode;
  /** Preferred side; flips when there is no room */
  side?: TooltipSide;
  /** Max tooltip width in px (default 260) */
  maxWidth?: number;
  /** Extra class on the trigger wrapper */
  className?: string;
}

const GAP = 8;
const EDGE = 8;
const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function place(trigger: DOMRect, tip: DOMRect, side: TooltipSide): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits = (s: TooltipSide) =>
    s === 'top'
      ? trigger.top - tip.height - GAP >= EDGE
      : s === 'bottom'
        ? trigger.bottom + tip.height + GAP <= vh - EDGE
        : s === 'left'
          ? trigger.left - tip.width - GAP >= EDGE
          : trigger.right + tip.width + GAP <= vw - EDGE;
  const s = fits(side) || !fits(OPPOSITE[side]) ? side : OPPOSITE[side];

  let top: number;
  let left: number;
  if (s === 'top' || s === 'bottom') {
    top = s === 'top' ? trigger.top - tip.height - GAP : trigger.bottom + GAP;
    left = trigger.left + trigger.width / 2 - tip.width / 2;
  } else {
    left = s === 'left' ? trigger.left - tip.width - GAP : trigger.right + GAP;
    top = trigger.top + trigger.height / 2 - tip.height / 2;
  }
  return {
    top: Math.min(Math.max(EDGE, top), vh - tip.height - EDGE),
    left: Math.min(Math.max(EDGE, left), vw - tip.width - EDGE),
  };
}

/**
 * @example
 * ```tsx
 * <Tooltip content="Measured at the robot, 2 s ago"><StatusTag tone="live">Live</StatusTag></Tooltip>
 * ```
 */
export function Tooltip({ content, children, side = 'top', maxWidth = 260, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), 150);
  };
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setOpen(false);
      setPos(null);
    }, 100);
  };

  const measure = useCallback(() => {
    if (!triggerRef.current || !tipRef.current) return;
    setPos(place(triggerRef.current.getBoundingClientRect(), tipRef.current.getBoundingClientRect(), side));
  }, [side]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure, content]);

  return (
    <span
      ref={triggerRef}
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) setOpen(false);
      }}
    >
      <span className="inline-flex" aria-describedby={open ? tooltipId : undefined}>
        {children}
      </span>
      {open &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            id={tooltipId}
            style={{
              maxWidth,
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className={cn(
              'pointer-events-none fixed z-[90]',
              // `w-max` lets the box grow to its text first; `maxWidth` then caps
              // it. Without it a sentence on a narrow trigger rendered as a
              // one-word-per-line column (Agent Mode's place-belief tooltip).
              'w-max',
              'rounded-control border border-line-strong bg-raised px-3 py-2 text-xs leading-relaxed text-ink-primary',
              'shadow-[0_8px_24px_rgba(0,0,0,0.35)]',
            )}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

// ============================================================================
// INFO ICON — convenience: a small (i) that shows a tooltip on hover
// ============================================================================

export interface InfoIconProps {
  /** The hint text / rich content */
  content: ReactNode;
  /** Preferred side */
  side?: TooltipSide;
  /** Icon size in px (default 14) */
  size?: number;
  /** Accessible label */
  label?: string;
  className?: string;
  maxWidth?: number;
}

/**
 * Small info (i) icon with a tooltip — next to labels and metrics.
 *
 * @example
 * ```tsx
 * <InfoIcon content="Success rate over the last 50 episodes." />
 * ```
 */
export function InfoIcon({ content, side = 'top', size = 14, label = 'More info', className, maxWidth }: InfoIconProps) {
  return (
    <Tooltip content={content} side={side} maxWidth={maxWidth}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex items-center justify-center rounded-full text-ink-muted transition-colors',
          'hover:text-primary focus-visible:text-primary',
          focusRing,
          className,
        )}
      >
        <Info style={{ width: size, height: size }} strokeWidth={1.75} />
      </button>
    </Tooltip>
  );
}
