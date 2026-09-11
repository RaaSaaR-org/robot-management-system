/**
 * @file Readout.tsx
 * @description A small telemetry value: eyebrow label, tabular Inter value, muted unit.
 *   Missing values render as an em dash. Used for every numeric readout in the feature.
 * @feature robots
 */

import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

export type ReadoutTone = 'measured' | 'estimated' | 'unknown' | 'stopped';

export interface ReadoutProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  tone?: ReadoutTone;
  className?: string;
}

const TONE_CLASS: Record<ReadoutTone, string> = {
  measured: 'text-signal-measured',
  estimated: 'text-signal-estimated',
  unknown: 'text-signal-unknown',
  stopped: 'text-signal-stopped',
};

/** Label over value (+ unit), optional hint below. */
export function Readout({ label, value, unit, hint, tone, className }: ReadoutProps) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-tertiary">
        {label}
      </span>
      {empty ? (
        <span className="text-sm font-semibold text-ink-muted">—</span>
      ) : (
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            tone ? TONE_CLASS[tone] : 'text-ink-primary',
          )}
        >
          {value}
          {unit && <span className="ml-0.5 font-normal text-ink-tertiary">{unit}</span>}
        </span>
      )}
      {hint && <span className="text-xs text-ink-tertiary">{hint}</span>}
    </div>
  );
}
