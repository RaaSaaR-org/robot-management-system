/**
 * @file Tooltip.tsx
 * @description Lightweight hover/focus tooltip for educational hints and labels
 * @feature shared
 */

import { useState, useRef, useEffect, useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TOOLTIP
// ============================================================================

export interface TooltipProps {
  /** Tooltip body — can be text or richer content */
  content: ReactNode;
  /** Trigger element (the thing you hover) */
  children: ReactNode;
  /** Side the tooltip should appear on */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Max tooltip width in px (default 260) */
  maxWidth?: number;
  /** Extra class on the trigger wrapper */
  className?: string;
}

/**
 * Minimal tooltip — CSS-positioned, shows on hover/focus, no portal.
 * Uses native title-like semantics via aria-describedby so it's accessible.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  maxWidth = 260,
  className,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    timeoutRef.current = setTimeout(() => setOpen(false), 100);
  };

  const sideClass = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }[side];

  return (
    <span
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={open ? tooltipId : undefined}>{children}</span>
      {open && (
        <span
          role="tooltip"
          id={tooltipId}
          style={{ maxWidth }}
          className={cn(
            'absolute z-50 pointer-events-none',
            'px-3 py-2 rounded-brand text-xs leading-relaxed',
            'bg-slate-900/95 text-slate-100 border border-slate-700/50 shadow-xl',
            'backdrop-blur-sm',
            sideClass
          )}
        >
          {content}
        </span>
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
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Icon size in px (default 14) */
  size?: number;
  /** Accessible label */
  label?: string;
  className?: string;
  maxWidth?: number;
}

/**
 * Small info (i) icon with hover tooltip — use next to labels/metrics to
 * give users an inline explanation without cluttering the UI.
 */
export function InfoIcon({
  content,
  side = 'top',
  size = 14,
  label = 'More info',
  className,
  maxWidth,
}: InfoIconProps) {
  return (
    <Tooltip content={content} side={side} maxWidth={maxWidth}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex items-center justify-center rounded-full',
          'text-theme-muted hover:text-cobalt-400 focus:text-cobalt-400',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-cobalt-500/40',
          className
        )}
      >
        <Info style={{ width: size, height: size }} />
      </button>
    </Tooltip>
  );
}
