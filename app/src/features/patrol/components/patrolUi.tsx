/**
 * @file patrolUi.tsx
 * @description Shared visual vocabulary of the patrol feature: class-name
 *              constants (glass panels, micro-labels, mono telemetry, glow,
 *              motion), unified colour maps for run/leg/severity states, and
 *              the tiny presentational pieces more than one page draws —
 *              KpiTile, SectionHeader, StatusDot and the RoutePath stepper.
 *              Built only on the Tailwind theme tokens in index.css.
 * @feature patrol
 */

import { memo, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import type { PatrolFindingSeverity, PatrolLegStatus, PatrolRunStatus } from '../types/patrol.types';

// ---- class vocabulary -------------------------------------------------------
/** Instrument-like motion: 200 ms, brand easing, respects reduced-motion via index.css. */
export const PATROL_MOTION = 'transition-all duration-200 ease-[var(--ease-instrument)]';
/** New rows/cards enter with the existing `fadeInUp` keyframes (250 ms). */
export const PATROL_FADE_IN = 'animate-[fadeInUp_250ms_ease-out_both]';
/** Keyboard focus ring for every glass control. */
export const PATROL_FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-500/40';
export const PATROL_PANEL = 'glass-card rounded-brand-lg p-4 sm:p-5 min-w-0';
export const PATROL_INSET = 'glass-subtle rounded-brand p-3 min-w-0';
/** Interactive inset (row that links somewhere). */
export const PATROL_INSET_HOVER = cn(PATROL_INSET, PATROL_MOTION, 'hover:bg-theme-hover hover:border-[var(--glass-border-highlight)]');
/** Uppercase micro-label above values (KPI labels, table heads, photo tags). */
export const PATROL_MICRO = 'text-[10px] font-medium uppercase tracking-[0.12em] text-theme-tertiary';
/** Mono telemetry text (cron, times, counts). */
export const PATROL_MONO = 'font-mono tabular-nums text-xs text-theme-secondary';
/** Big mono number in a KPI tile. */
export const PATROL_KPI_VALUE = 'font-mono tabular-nums text-2xl font-semibold leading-none text-theme-primary';
/** The one glow per screen — the live element. Halved in light mode. */
export const PATROL_GLOW_LIVE = 'shadow-[0_0_24px_-6px_color-mix(in_srgb,var(--color-primary)_35%,transparent)] dark:shadow-[0_0_28px_-6px_color-mix(in_srgb,var(--color-primary)_55%,transparent)]';
export const PATROL_LIVE_BORDER = 'border border-cobalt-500/40';
/** Amber attention text (finding counts), AA in both themes. */
export const PATROL_ATTENTION_TEXT = 'text-amber-700 dark:text-amber-400';
/**
 * Sticky side rail on ≥ lg. Offset clears the fixed 56-px TopBar; capped to the
 * viewport and scrolls inside itself so a long rail never gets cut off. The
 * -m/p pair leaves room for the live glow so the scroll box does not clip it.
 */
/**
 * A rail that follows the operator down the page (below the 56 px top bar) and
 * scrolls inside itself when taller than the viewport. `[&>*]:shrink-0`: the rail
 * is a flex column, and a max-height + overflow container otherwise SHRINKS its
 * flex children — the status card was squeezed and clipped its own
 * "Promote to baseline" button instead of the rail scrolling.
 * `lg:self-start`, never bare `self-start`: below lg both consumers stack the
 * rail in a COLUMN flexbox, where align-self governs the HORIZONTAL axis, so an
 * unprefixed token shrank the rail to its content width and left a ragged,
 * left-hugging column next to full-width siblings on phones and tablets. At lg
 * it is still needed — a stretched grid item cannot behave as sticky.
 */
export const PATROL_STICKY_RAIL =
  'lg:sticky lg:top-[4.5rem] lg:self-start lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:-m-2 lg:p-2 [&>*]:shrink-0';

/** 3-px left rail per finding severity — never a tinted background. */
export const SEVERITY_RAIL: Record<PatrolFindingSeverity, string> = {
  high: 'border-l-[3px] border-l-red-500',
  medium: 'border-l-[3px] border-l-amber-500',
  low: 'border-l-[3px] border-l-surface-light-400 dark:border-l-surface-400',
};

/** Solid dot colour per run status (legends, history rows, KPI live dot). */
export const RUN_STATUS_DOT: Record<PatrolRunStatus, string> = {
  running: 'bg-cobalt-500',
  done: 'bg-turquoise-600 dark:bg-turquoise-500',
  aborted: 'bg-amber-500',
  failed: 'bg-red-500',
  skipped: 'bg-surface-light-400 dark:bg-surface-400',
};

/** Node look per leg status; `route` = a checkpoint with no run behind it. */
export const LEG_NODE: Record<PatrolLegStatus | 'route', string> = {
  route: 'bg-cobalt-500/15 text-cobalt-700 dark:text-cobalt-300',
  pending: 'bg-surface-light-300 text-theme-tertiary dark:bg-surface-500',
  running: 'bg-cobalt-500 text-white ring-4 ring-cobalt-500/25 animate-pulse',
  done: 'bg-turquoise-600 text-white dark:bg-turquoise-500 dark:text-surface-900',
  failed: 'bg-red-500 text-white',
  skipped: 'bg-surface-light-400 text-white dark:bg-surface-400',
};

/** SVG/CSS colours for the map overlay, read from theme tokens (theme-aware). */
export const OVERLAY_COLOR = {
  path: 'var(--color-cobalt-500)',
  done: 'var(--color-signal-measured)',
  running: 'var(--color-cobalt-500)',
  finding: 'var(--color-signal-stopped)',
  attention: 'var(--color-signal-unknown)',
  muted: 'var(--text-muted)',
} as const;

// ---- tiny components --------------------------------------------------------
export type PatrolTone = 'neutral' | 'primary' | 'accent' | 'attention' | 'danger';

const DOT_TONE: Record<PatrolTone, string> = {
  neutral: 'bg-surface-light-400 dark:bg-surface-400',
  primary: 'bg-cobalt-500',
  accent: 'bg-turquoise-600 dark:bg-turquoise-500',
  attention: 'bg-amber-500',
  danger: 'bg-red-500',
};
export interface StatusDotProps {
  tone?: PatrolTone;
  pulse?: boolean;
  className?: string;
}

/** 8-px status dot; `pulse` for live things only. */
export const StatusDot = memo(function StatusDot({ tone = 'neutral', pulse, className }: StatusDotProps) {
  return <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', DOT_TONE[tone], pulse && 'animate-pulse', className)} aria-hidden="true" />;
});

const KPI_VALUE_TONE: Record<PatrolTone, string> = {
  neutral: 'text-theme-primary',
  primary: 'text-cobalt-700 dark:text-cobalt-300',
  accent: 'text-turquoise-700 dark:text-turquoise-400',
  attention: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-700 dark:text-red-400',
};
export interface KpiTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: PatrolTone;
  /** Draw a status dot next to the value (live link, running run). Static — the page-level "live" pill already pulses. */
  live?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** Glass KPI tile: micro-label, mono value, one sub-line. */
export const KpiTile = memo(function KpiTile({ label, value, sub, tone = 'neutral', live, className, ...rest }: KpiTileProps) {
  return (
    <div className={cn('glass-card rounded-brand-lg p-4 flex flex-col gap-1.5 min-w-0', className)} data-testid={rest['data-testid']}>
      <span className={PATROL_MICRO}>{label}</span>
      <span className={cn(PATROL_KPI_VALUE, KPI_VALUE_TONE[tone], 'flex items-center gap-2 min-w-0')}>
        {live && <StatusDot tone={tone === 'neutral' ? 'accent' : tone} />}
        <span className="min-w-0 truncate">{value}</span>
      </span>
      {sub && <span className="text-[11px] text-theme-tertiary truncate">{sub}</span>}
    </div>
  );
});
export interface SectionHeaderProps {
  title: string;
  count?: number;
  meta?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}

/** Section title row: title, optional mono count chip, meta text, right actions. */
export const SectionHeader = memo(function SectionHeader({ title, count, meta, actions, as: Tag = 'h2', className }: SectionHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 min-w-0', className)}>
      <Tag className="card-title text-sm flex items-center gap-2 min-w-0">
        <span className="truncate">{title}</span>
        {count !== undefined && <span className={cn(PATROL_MONO, 'glass-subtle rounded-full px-1.5 py-px text-[11px]')}>{count}</span>}
      </Tag>
      {meta && <span className="card-meta text-xs truncate">{meta}</span>}
      {actions && <div className="ml-auto flex items-center gap-1.5 flex-wrap">{actions}</div>}
    </div>
  );
});
export interface RoutePathLeg {
  index: number;
  label: string;
  status?: PatrolLegStatus | 'route';
  findingCount?: number;
}
export interface RoutePathProps {
  legs: readonly RoutePathLeg[];
  /** `sm` = 16-px nodes, no labels (banner, legend); `md` = 20-px nodes with labels under. */
  size?: 'sm' | 'md';
  activeIndex?: number;
  onSelect?: (index: number) => void;
  className?: string;
}

/** The route as a numbered node→node chain — the same shape on every surface. */
export const RoutePath = memo(function RoutePath({ legs, size = 'md', activeIndex, onSelect, className }: RoutePathProps) {
  const node = size === 'sm' ? 'w-4 h-4 text-[9px]' : 'w-5 h-5 text-[10px]';
  return (
    <ol className={cn('flex items-start min-w-0 overflow-x-auto scrollbar-hide', className)} aria-label="Route checkpoints">
      {legs.map((leg, i) => {
        const status = leg.status ?? 'route';
        const clickable = Boolean(onSelect);
        const done = status === 'done';
        const description = `Leg ${leg.index + 1} ${leg.label}, ${status === 'route' ? 'checkpoint' : status}${leg.findingCount ? `, ${leg.findingCount} finding${leg.findingCount === 1 ? '' : 's'}` : ''}`;
        const nodeClass = cn('flex flex-col items-center gap-1 shrink-0', size === 'md' && 'w-14');
        const inner = (
          <>
            <span
              className={cn('relative rounded-full inline-flex items-center justify-center font-semibold tabular-nums', PATROL_MOTION, node, LEG_NODE[status], activeIndex === leg.index && 'ring-2 ring-offset-2 ring-offset-transparent ring-cobalt-500/60')}
              aria-hidden="true"
            >
              {leg.index + 1}
              {leg.findingCount ? <span className="absolute -top-1 -right-1.5 min-w-3 h-3 px-0.5 rounded-full bg-amber-500 text-[8px] leading-3 text-white text-center">{leg.findingCount}</span> : null}
            </span>
            {size === 'md' && (
              <span className="text-[10px] text-theme-tertiary truncate max-w-full" aria-hidden="true">
                {leg.label}
              </span>
            )}
            <span className="sr-only">{description}</span>
          </>
        );
        return (
          <li key={`${leg.index}-${i}`} className={cn('flex items-start min-w-0', i < legs.length - 1 && 'flex-1')} aria-current={activeIndex === leg.index ? 'step' : undefined}>
            {/* Only a real control when the node does something; a static stepper must not read as a row of disabled buttons. */}
            {clickable ? (
              <button type="button" onClick={() => onSelect?.(leg.index)} className={cn(nodeClass, PATROL_FOCUS, 'cursor-pointer')}>
                {inner}
              </button>
            ) : (
              <span className={cn(nodeClass, 'cursor-default')}>{inner}</span>
            )}
            {i < legs.length - 1 && (
              <span className={cn('flex-1 h-px mt-2 min-w-2', size === 'md' && 'mt-2.5', done ? 'bg-turquoise-500/60' : 'bg-[var(--glass-border-highlight)]', status === 'pending' && 'border-t border-dashed border-glass-highlight bg-transparent')} aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
});
