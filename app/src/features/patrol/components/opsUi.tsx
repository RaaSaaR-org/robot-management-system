/**
 * @file opsUi.tsx
 * @description Shared visual pieces of the Operate pages (Patrol and Guide):
 *              the RoutePath node→node stepper, the LiveTag for the event
 *              socket, and small formatters (duration, elapsed clock). Built
 *              only on the kit and the design tokens.
 * @feature patrol
 */

import { memo } from 'react';
import { StatusTag, statusTone } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { PatrolLegStatus } from '../types/patrol.types';

// ---- formatters -------------------------------------------------------------

/** `45 s`, `12 min`, `1 h 05 min` — a human duration for tables and tiles. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Duration between two ISO stamps (`finishedAt` may be null → still running). */
export function runDurationMs(startedAt: string, finishedAt: string | null | undefined): number | null {
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

/** `mm:ss` (or `h:mm:ss` past an hour) since `iso`; never negative. */
export function formatElapsed(iso: string, now: number): string {
  const started = Date.parse(iso);
  const total = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Relative time for tables: "just now", "5 min ago", "3 h ago", else a date. */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = Math.round((now - t) / 1000);
  if (diff >= 0 && diff < 60) return 'just now';
  if (diff >= 0 && diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff >= 0 && diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Date and time for a run's start ("16 Aug, 22:00"). */
export function formatStarted(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---- LiveTag ------------------------------------------------------------------

/** Header meta for the event socket: pulsing "Live", or a calm "Offline". */
export const LiveTag = memo(function LiveTag({ connected, 'data-testid': testId }: { connected: boolean; 'data-testid'?: string }) {
  return (
    <span data-testid={testId} className="inline-flex">
      <StatusTag tone={connected ? 'live' : 'neutral'} dot pulse={connected}>
        {connected ? 'Live' : 'Offline'}
      </StatusTag>
    </span>
  );
});

// ---- run status ---------------------------------------------------------------

// Tones come from the kit's statusTone(): running/done success, aborted/abandoned
// amber, failed red, skipped/declined (unknown to the map) neutral.
const RUN_LABEL: Record<string, string> = {
  running: 'Running',
  done: 'Done',
  aborted: 'Aborted',
  abandoned: 'Abandoned',
  failed: 'Failed',
  skipped: 'Skipped',
  declined: 'Declined',
};

/** Sentence-case label for a patrol run or guide visit status. */
export function runStatusLabel(status: string): string {
  return RUN_LABEL[status] ?? status;
}

/**
 * A run's reason as an operator reads it. The server records a start against an
 * offline robot as "unreachable: <transport error and URL>"; that is one calm
 * fact, "Robot not reachable". Every other reason is already a sentence.
 */
export function describeRunReason(reason: string | null | undefined): string {
  if (!reason) return '';
  return /^unreachable\b|connection refused|econnrefused/i.test(reason) ? 'Robot not reachable' : reason;
}

/** Status tag for a patrol run or a guide visit. */
export const RunStatusTag = memo(function RunStatusTag({ status }: { status: string }) {
  return (
    <StatusTag tone={statusTone(status)} dot pulse={status === 'running'}>
      {RUN_LABEL[status] ?? status}
    </StatusTag>
  );
});

/** Armed / Off tag for a route or tour. */
export const ArmedTag = memo(function ArmedTag({ enabled }: { enabled: boolean }) {
  return (
    <StatusTag status={enabled ? 'active' : 'idle'} dot>
      {enabled ? 'Armed' : 'Off'}
    </StatusTag>
  );
});

// ---- RoutePath ------------------------------------------------------------------

export type RoutePathStatus = PatrolLegStatus | 'route';
export interface RoutePathLeg {
  index: number;
  label: string;
  status?: RoutePathStatus;
  findingCount?: number;
}
export interface RoutePathProps {
  legs: readonly RoutePathLeg[];
  /** `sm` = 20-px nodes, no labels; `md` = 24-px nodes with wrapping labels under. */
  size?: 'sm' | 'md';
  activeIndex?: number;
  className?: string;
}

const NODE: Record<RoutePathStatus, string> = {
  route: 'bg-primary/10 text-primary border border-primary/30',
  pending: 'bg-inset text-ink-tertiary border border-line',
  running: 'bg-primary text-on-primary outline outline-2 outline-offset-2 outline-primary/40',
  done: 'bg-signal-measured/15 text-signal-measured border border-signal-measured/40',
  failed: 'bg-stop text-on-stop',
  skipped: 'bg-inset text-ink-muted border border-dashed border-line-strong',
};

/** The route as a numbered node→node chain — the same shape on every surface. */
export const RoutePath = memo(function RoutePath({ legs, size = 'md', activeIndex, className }: RoutePathProps) {
  const node = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-xs';
  return (
    <ol className={cn('flex min-w-0 items-start', className)} aria-label="Route checkpoints">
      {legs.map((leg, i) => {
        const status = leg.status ?? 'route';
        const last = i === legs.length - 1;
        const description = `Leg ${leg.index + 1} ${leg.label}, ${status === 'route' ? 'checkpoint' : status}${
          leg.findingCount ? `, ${leg.findingCount} finding${leg.findingCount === 1 ? '' : 's'}` : ''
        }`;
        return (
          <li
            key={`${leg.index}-${i}`}
            className={cn('flex min-w-0 items-start', !last && 'flex-1')}
            aria-current={activeIndex === leg.index ? 'step' : undefined}
          >
            <span className={cn('flex shrink-0 flex-col items-center gap-1', size === 'md' && 'w-16')}>
              <span
                className={cn('relative inline-flex items-center justify-center rounded-full font-semibold tabular-nums', node, NODE[status])}
                aria-hidden="true"
              >
                {leg.index + 1}
                {leg.findingCount ? (
                  <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-signal-unknown px-1 text-center text-[10px] leading-4 text-canvas">
                    {leg.findingCount}
                  </span>
                ) : null}
              </span>
              {size === 'md' && (
                <span className="line-clamp-2 max-w-full break-words text-center text-xs leading-tight text-ink-tertiary" aria-hidden="true">
                  {leg.label}
                </span>
              )}
              <span className="sr-only">{description}</span>
            </span>
            {!last && (
              <span
                className={cn(
                  'mt-2.5 h-px min-w-2 flex-1',
                  size === 'sm' && 'mt-2',
                  status === 'done' ? 'bg-signal-measured/50' : 'bg-line-strong',
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
});
