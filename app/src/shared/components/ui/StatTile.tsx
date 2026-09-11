/**
 * @file StatTile.tsx
 * @description StatTile (one summarised number: label, Archivo value, unit,
 *              hint, trend, progress) and StatRow (the responsive grid the
 *              tiles sit in under the page header).
 * @feature shared
 */

import { Children, type ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Skeleton } from './Skeleton';
import { baseTone, labelCaps, toneFill, toneText, type Tone } from './styles';

// ============================================================================
// STAT TILE
// ============================================================================

export interface StatTileTrend {
  /** Shown next to the arrow, e.g. "+12%" or "3 since yesterday" */
  value: ReactNode;
  direction: 'up' | 'down' | 'flat';
  /** Whether this change is good news (mint), bad news (red) or neither (default) */
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Unit after the value ("%", "robots", "Hz") */
  unit?: ReactNode;
  /** One line under the value */
  hint?: ReactNode;
  /** Colours the value and the progress fill (default neutral = ink) */
  tone?: Tone;
  /** Small icon at the top right (w-4 h-4) */
  icon?: ReactNode;
  trend?: StatTileTrend;
  /** 0–100: thin bar under the value */
  progress?: number;
  /** Show a skeleton in place of the value */
  isLoading?: boolean;
  className?: string;
}

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight } as const;
const TREND_TEXT = {
  positive: 'text-signal-measured',
  negative: 'text-signal-stopped',
  neutral: 'text-ink-tertiary',
} as const;

/**
 * @example
 * ```tsx
 * <StatTile label="Robots online" value={12} unit="/ 14" hint="2 charging" tone="live" />
 * <StatTile label="Battery" value={82} unit="%" progress={82} />
 * <StatTile label="Incidents" value={3} trend={{ value: '+1 today', direction: 'up', sentiment: 'negative' }} />
 * ```
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  tone,
  icon,
  trend,
  progress,
  isLoading = false,
  className,
}: StatTileProps) {
  const resolved = tone ? baseTone(tone) : null;
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  const pct = progress === undefined ? null : Math.min(100, Math.max(0, progress));

  return (
    <div className={cn('flex min-w-0 flex-col rounded-panel border border-line bg-panel p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        {/* Wraps rather than truncates: two-up tiles at 390px are narrow. */}
        <div className={cn(labelCaps, 'min-w-0 break-words leading-4')}>{label}</div>
        {icon && (
          <span className="shrink-0 text-ink-muted [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex min-w-0 items-baseline gap-1.5">
        {isLoading ? (
          <Skeleton className="h-[30px] w-20" />
        ) : (
          <>
            <span
              className={cn(
                'truncate font-display text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums',
                resolved && resolved !== 'neutral' ? toneText[resolved] : 'text-ink-primary',
              )}
            >
              {value}
            </span>
            {unit && <span className="shrink-0 text-[13px] text-ink-tertiary">{unit}</span>}
          </>
        )}
      </div>

      {pct !== null && (
        <div
          className="mt-3 h-1 overflow-hidden rounded-full bg-line-subtle"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn('h-full rounded-full', resolved && resolved !== 'neutral' ? toneFill[resolved] : 'bg-primary')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {(hint || trend) && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {trend && TrendIcon && (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', TREND_TEXT[trend.sentiment ?? 'neutral'])}>
              <TrendIcon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              {trend.value}
            </span>
          )}
          {hint && <span className="min-w-0 truncate text-ink-tertiary">{hint}</span>}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STAT ROW
// ============================================================================

export interface StatRowProps {
  children: ReactNode;
  /** Columns at the widest breakpoint (2–6). Defaults to the number of tiles. */
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}

const COLUMN_STYLES: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
};

/**
 * Two tiles per row on phones, up to `columns` on wide screens.
 *
 * @example
 * ```tsx
 * <StatRow>
 *   <StatTile label="Online" value={12} tone="live" />
 *   <StatTile label="Charging" value={2} />
 *   <StatTile label="Faults" value={0} />
 * </StatRow>
 * ```
 */
export function StatRow({ children, columns, className }: StatRowProps) {
  const count = Children.toArray(children).length;
  const cols = columns ?? (Math.min(6, Math.max(2, count)) as 2 | 3 | 4 | 5 | 6);
  return <div className={cn('grid gap-3', COLUMN_STYLES[cols], className)}>{children}</div>;
}
