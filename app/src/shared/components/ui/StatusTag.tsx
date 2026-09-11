/**
 * @file StatusTag.tsx
 * @description The one way to show a status: a small uppercase tag in a signal
 *              tone. Pass `status` and the tone and label come from
 *              statusTone()/humanizeStatus(); pass `tone` + children for a
 *              fixed label (Live, Sim, Gated).
 * @feature shared
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { baseTone, toneFill, toneTag, type Tone } from './styles';
import { humanizeStatus, statusTone } from './statusTone';

export type StatusTagTone = Tone;
export type StatusTagSize = 'sm' | 'md';

export interface StatusTagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Explicit tone. When omitted it is derived from `status`. */
  tone?: StatusTagTone;
  /** Domain status string ("online", "in_progress", "E-Stop"); sets tone and label */
  status?: string | null;
  /** Label override (defaults to the humanised status) */
  children?: ReactNode;
  /** Leading dot */
  dot?: boolean;
  /** Pulse the dot (live things) */
  pulse?: boolean;
  /** sm 10px · md 11px (default md) */
  size?: StatusTagSize;
}

const sizeStyles: Record<StatusTagSize, string> = {
  sm: 'h-[18px] px-1.5 text-[10px] gap-1',
  md: 'h-5 px-2 text-[11px] gap-1.5',
};

/**
 * @example
 * ```tsx
 * <StatusTag status={robot.status} dot />      // "ONLINE" in measured mint
 * <StatusTag tone="sim">Sim</StatusTag>
 * <StatusTag tone="live" dot pulse>Live</StatusTag>
 * ```
 */
export function StatusTag({
  tone,
  status,
  children,
  dot = false,
  pulse = false,
  size = 'md',
  className,
  ...props
}: StatusTagProps) {
  const resolved = baseTone(tone ?? statusTone(status));
  const label = children ?? (status !== undefined ? humanizeStatus(status) : null);

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-tag border font-medium uppercase leading-none tracking-[0.08em]',
        toneTag[resolved],
        sizeStyles[size],
        className,
      )}
      data-tone={resolved}
      {...props}
    >
      {(dot || pulse) && (
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', toneFill[resolved], pulse && 'motion-safe:animate-pulse')}
        />
      )}
      {label}
    </span>
  );
}
