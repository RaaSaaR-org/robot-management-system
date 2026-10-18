/**
 * @file ReadinessRow.tsx
 * @description One checklist row of the robot readiness panel (TASK-411): an
 *              icon for its verdict, the label, a short value, and the detail
 *              on hover or expand. A step held by a process the supervisor did
 *              not start ("foreign") shows that process with Adopt and Leave —
 *              never Kill (D4). A running step shows a spinner with its detail.
 * @feature robots
 */

import { useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Circle, Copy, HelpCircle, XCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { cn } from '@/shared/utils/cn';
import { staleCodeOf, type BringupStepId } from '../../api/readinessApi';
import { shortDateTime, type ReadinessRowModel, type RowStatus } from './readinessRows';

const ICON: Record<Exclude<RowStatus, 'pending'>, { icon: typeof Circle; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: 'text-signal-measured', label: 'ok' },
  warn: { icon: AlertTriangle, className: 'text-signal-unknown', label: 'warning' },
  fail: { icon: XCircle, className: 'text-signal-stopped', label: 'failing' },
  idle: { icon: Circle, className: 'text-ink-tertiary', label: 'idle' },
  unknown: { icon: HelpCircle, className: 'text-ink-tertiary', label: 'unknown' },
};

/** "3 min ago" from an ISO time; the age of a foreign process. */
export function ageText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'unknown age';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown age';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

/** The last two segments of a working directory, e.g. `robot-management-system/robot-agent/`. */
export function shortCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const parts = cwd.split('/').filter(Boolean);
  return parts.length ? `${parts.slice(-2).join('/')}/` : '/';
}

/** The one terminal step left (TASK-419): stop a process NeoDEM did not start. SIGTERM, never -9. */
export function stopCommand(pid: number | null | undefined): string | null {
  return pid && pid > 0 ? `kill -TERM ${pid}` : null;
}

export interface ReadinessRowProps {
  row: ReadinessRowModel;
  /** The reason line is about this row. */
  highlighted?: boolean;
  onAdopt?: (step: BringupStepId) => void;
  onLeave?: (step: BringupStepId) => void;
  /** An adopt/leave of this row's step is in flight. */
  busy?: boolean;
  /** Extra controls at the row's end (e.g. Bring up LAN). */
  action?: ReactNode;
}

export function ReadinessRow({ row, highlighted = false, onAdopt, onLeave, busy = false, action }: ReadinessRowProps) {
  const [open, setOpen] = useState(false);
  const step = row.step;
  const foreign = step?.state === 'foreign' ? step : null;
  const pending = row.status === 'pending';
  const icon = row.status === 'pending' ? null : ICON[row.status];
  const Icon = icon?.icon;
  const detail = row.detail;
  const stale = foreign ? staleCodeOf(foreign) : null;
  // A process that runs older code is never adopted, whatever the supervisor offers.
  const actions = (foreign ? foreign.actions ?? ['adopt', 'leave'] : []).filter((a) => !(stale && a === 'adopt'));
  const startedAt = foreign ? foreign.foreign?.since ?? foreign.startedAt : null;
  const cwd = foreign ? shortCwd(foreign.foreign?.cwd) : null;
  const stop = foreign && stale ? stopCommand(foreign.foreign?.pid ?? foreign.pid) : null;
  const [copied, setCopied] = useState(false);

  return (
    <li
      data-testid={`readiness-row-${row.id}`}
      data-status={row.status}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'rounded-control border px-3 py-2',
        highlighted ? 'border-primary bg-primary/[0.06]' : 'border-line-subtle bg-inset',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {pending ? (
            <Spinner size="xs" label={`${row.label} in progress`} />
          ) : (
            Icon && <Icon className={cn('h-4 w-4', icon.className)} strokeWidth={2} aria-label={icon.label} />
          )}
        </span>
        <span className="w-28 shrink-0 text-[13px] font-medium text-ink-primary">{row.label}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary" title={detail ?? undefined}>
          {pending && detail ? detail : row.value}
        </span>
        {action}
        {detail && !pending && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-ink-tertiary hover:text-ink-primary"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${row.label} detail`}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} strokeWidth={1.75} />
          </button>
        )}
      </div>
      {open && detail && <p className="mt-1.5 pl-7 text-[12px] text-ink-secondary">{detail}</p>}
      {foreign && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-7" data-testid={`readiness-foreign-${foreign.id}`}>
          <p className="min-w-0 flex-1 text-[12px] text-ink-secondary">
            Not started by NeoDEM: pid <span className="font-mono">{foreign.foreign?.pid ?? foreign.pid ?? '?'}</span>
            {foreign.foreign?.cmdline && foreign.foreign.cmdline.length > 0 && (
              <>
                {' · '}
                <span className="break-all font-mono">{foreign.foreign.cmdline.join(' ')}</span>
              </>
            )}
            {' · started '}
            <span data-testid={`readiness-foreign-started-${foreign.id}`}>{shortDateTime(startedAt)}</span>
            {` (${ageText(startedAt)} ago)`}
            {cwd && (
              <>
                {' · '}
                <span className="font-mono" title={foreign.foreign?.cwd ?? undefined}>
                  {cwd}
                </span>
              </>
            )}
            {foreign.foreign?.robotId ? ` · robot ${foreign.foreign.robotId}` : ''}
          </p>
          {stale && (
            <div className="flex w-full flex-wrap items-center gap-2" data-testid={`readiness-stale-${foreign.id}`}>
              <p className="text-[12px] font-medium text-signal-stopped">
                Runs code from before {shortDateTime(stale.codeAt)}. Stop it, then press Start.
              </p>
              {stop && (
                <span className="flex items-center gap-1">
                  <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-ink-primary">{stop}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    onClick={() => {
                      void navigator.clipboard?.writeText(stop).then(() => setCopied(true), () => setCopied(false));
                    }}
                    data-testid={`readiness-stale-copy-${foreign.id}`}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </span>
              )}
            </div>
          )}
          {actions.includes('adopt') && onAdopt && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAdopt(foreign.id)} data-testid={`readiness-adopt-${foreign.id}`}>
              Adopt
            </Button>
          )}
          {actions.includes('leave') && onLeave && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onLeave(foreign.id)}>
              Leave
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
