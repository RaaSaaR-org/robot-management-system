/**
 * @file QuickCheckCard.tsx
 * @description The glance after every take (TASK-410): thumbnail, length,
 *              frames and rate, which body parts moved, the five joints that
 *              moved most with their range, and the robot's warnings. Keep is
 *              the default and only dismisses (D3); Discard throws the take
 *              away. A take that is short or did not move pre-focuses Discard
 *              — it never discards on its own. TASK-418 (D3): it stays until
 *              Keep, a discard or the next Start — the headset board shows the
 *              same quick check for the same time, so the two views agree.
 *              A take the robot aborted on an E-stop is already discarded
 *              (TASK-416): the card says only that, and offers only Dismiss.
 *              TASK-428: `variant="dock"` is the Record console's between-takes
 *              hero — a 104×78 thumbnail, "Take N" with when and by whom, the
 *              numbers and the moved groups, then "Top 5 joints" behind a
 *              disclosure and Keep (ghost) beside Discard (secondary). A take
 *              worth discarding turns its border red and focuses Discard; no
 *              red fill, because the E-STOP is the only one on screen.
 * @feature datacollection
 */

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Trash2 } from 'lucide-react';
import { Button, Panel } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type { QuickCheck } from '../../types/datacollection.types';
import { DISCARD_SUGGESTING_WARNINGS, describeEStopTake, groupLabel, takeLabel, warningLabel } from '../../utils/takeFormat';
import { TakeThumbnail } from './TakeThumbnail';

/**
 * The old auto-hide (TASK-410), now opt-in through `visibleMs`. TASK-418 (D3):
 * by default the card stays until the next Start, like the headset's board.
 */
export const QUICK_CHECK_VISIBLE_MS = 8000;

export interface QuickCheckCardProps {
  sessionId: string;
  quickCheck: QuickCheck;
  onKeep: () => void;
  onDiscard: (take: number) => void | Promise<unknown>;
  /** Hide after this many ms untouched; absent (the default) keeps the card until the next Start. */
  visibleMs?: number;
  /** `card` (a panel of its own) or `dock` (the take dock's hero, TASK-428). */
  variant?: 'card' | 'dock';
  /** Who started the take ("by Anna"), for the dock's "just now, by Anna". */
  by?: string | null;
}

/** The range bar's full width: a joint that swept half a turn fills it. */
const FULL_RANGE_RAD = Math.PI;

export function QuickCheckCard({ sessionId, quickCheck, onKeep, onDiscard, visibleMs, variant = 'card', by = null }: QuickCheckCardProps) {
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [jointsOpen, setJointsOpen] = useState(false);
  const discardRef = useRef<HTMLButtonElement>(null);
  const alreadyDiscarded = quickCheck.discarded === true;
  const suggestDiscard = !alreadyDiscarded && quickCheck.warnings.some((w) => DISCARD_SUGGESTING_WARNINGS.includes(w));

  // Pre-focus Discard on a take that is probably not worth keeping.
  useEffect(() => {
    if (suggestDiscard) discardRef.current?.focus();
  }, [suggestDiscard, quickCheck.take]);

  // Opt-in auto-hide, unless someone is reading or pointing at it.
  useEffect(() => {
    if (held || visibleMs === undefined) return;
    const timer = setTimeout(onKeep, visibleMs);
    return () => clearTimeout(timer);
  }, [held, onKeep, visibleMs, quickCheck.take]);

  const topJoints = [...quickCheck.jointsMoved].sort((a, b) => b.rangeRad - a.rangeRad).slice(0, 5);
  const fps = Number.isFinite(quickCheck.fpsActual) ? Math.round(quickCheck.fpsActual) : null;

  const discard = async () => {
    setBusy(true);
    try { await onDiscard(quickCheck.take); } finally { setBusy(false); }
  };

  const hover = {
    onMouseEnter: () => setHeld(true),
    onMouseLeave: () => setHeld(false),
    onFocusCapture: () => { if (!suggestDiscard) setHeld(true); },
  };

  const jointsList = topJoints.length > 0 && (
    <ul className="flex flex-col gap-1" data-testid="quick-check-joints">
      {topJoints.map((j) => (
        <li key={j.name} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-2 text-[11px]">
          <span className="truncate text-ink-secondary" title={j.name}>{j.name.replace(/_joint$/, '').replace(/_/g, ' ')}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-panel">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(4, (j.rangeRad / FULL_RANGE_RAD) * 100))}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-ink-tertiary">{j.rangeRad.toFixed(2)} rad</span>
        </li>
      ))}
    </ul>
  );

  if (variant === 'dock') {
    return (
      <section
        data-testid="quick-check"
        data-take={quickCheck.take}
        data-variant="dock"
        role="region"
        aria-label={`${takeLabel(quickCheck.take)} quick check`}
        className={cn(
          'flex flex-col gap-2.5 rounded-control border bg-inset p-3',
          suggestDiscard || alreadyDiscarded ? 'border-signal-stopped/40' : 'border-line',
        )}
        {...hover}
      >
        <div className="flex min-w-0 gap-3">
          {!alreadyDiscarded && (
            <TakeThumbnail
              sessionId={sessionId}
              take={quickCheck.take}
              available={quickCheck.thumbnailUrl !== null}
              className="h-[78px] w-[104px] rounded-[6px] max-[1439px]:h-[66px] max-[1439px]:w-[88px]"
            />
          )}
          <div className="min-w-0 flex-1">
            <h4 className="m-0 flex flex-wrap items-baseline gap-x-2 font-display text-base font-semibold leading-tight [font-variation-settings:'wdth'_106]">
              <span data-testid="quick-check-title">{takeLabel(quickCheck.take)}</span>
              <small className="font-sans text-xs font-normal text-ink-muted">just now{by ? `, ${by}` : ''}</small>
            </h4>
            {alreadyDiscarded ? (
              <p className="mt-1.5 text-[13px] font-medium text-signal-stopped" role="status" data-testid="quick-check-verdict">
                {quickCheck.stopReason === 'estop' ? describeEStopTake(quickCheck.take) : `${takeLabel(quickCheck.take)} was discarded`}
              </p>
            ) : (
              <>
                <div className="mt-[3px] flex flex-wrap gap-x-2.5 text-[12.5px] tabular-nums text-ink-secondary" data-testid="quick-check-stats">
                  <span>{quickCheck.durationS.toFixed(1)} s</span>
                  <span>{quickCheck.frames.toLocaleString(UI_DATE_LOCALE)} frames</span>
                  {fps !== null && <span>{fps} fps</span>}
                </div>
                <div className="mt-[7px] flex flex-wrap items-center gap-1" data-testid="quick-check-groups">
                  {quickCheck.groupsMoved.length > 0 ? (
                    quickCheck.groupsMoved.map((g) => (
                      <span key={g} className="rounded-tag border border-line bg-panel px-1.5 py-px text-[11px] font-medium text-ink-secondary">
                        {groupLabel(g)}
                      </span>
                    ))
                  ) : (
                    <span className="text-[12.5px] text-ink-tertiary">Nothing moved</span>
                  )}
                  {quickCheck.warnings.map((w) => (
                    <span
                      key={w}
                      data-testid={`quick-check-warning-${w}`}
                      className="rounded-tag border border-signal-unknown/30 bg-signal-unknown/10 px-1.5 py-px text-[11px] font-medium text-signal-unknown"
                    >
                      {warningLabel(w)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {jointsOpen && jointsList}
        <div className="flex items-center gap-2">
          {!alreadyDiscarded && topJoints.length > 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-secondary hover:text-ink-primary"
              aria-expanded={jointsOpen}
              onClick={() => setJointsOpen((v) => !v)}
              data-testid="quick-check-joints-toggle"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', jointsOpen && 'rotate-180')} strokeWidth={1.75} aria-hidden />
              Top 5 joints
            </button>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onKeep} data-testid="quick-check-keep">
            {alreadyDiscarded ? 'Dismiss' : 'Keep'}
          </Button>
          {!alreadyDiscarded && (
            <Button
              ref={discardRef}
              variant="secondary"
              size="sm"
              isLoading={busy}
              onClick={() => void discard()}
              data-testid="quick-check-discard"
              className={suggestDiscard ? 'border-signal-stopped/50 text-signal-stopped' : undefined}
              leftIcon={<Trash2 className="h-4 w-4" strokeWidth={1.75} />}
            >
              Discard
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <Panel
      data-testid="quick-check"
      data-take={quickCheck.take}
      role="region"
      aria-label={`${takeLabel(quickCheck.take)} quick check`}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => { if (!suggestDiscard) setHeld(true); }}
    >
      <Panel.Body className="flex flex-col gap-4 sm:flex-row">
        {!alreadyDiscarded && (
          <TakeThumbnail
            sessionId={sessionId}
            take={quickCheck.take}
            available={quickCheck.thumbnailUrl !== null}
            className="h-28 w-full sm:h-28 sm:w-40"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-lg font-semibold text-ink-primary" data-testid="quick-check-title">
              {takeLabel(quickCheck.take)}
            </span>
            {!alreadyDiscarded && (
              <span className="text-[13px] text-ink-secondary tabular-nums" data-testid="quick-check-stats">
                {quickCheck.durationS.toFixed(1)} s · {quickCheck.frames.toLocaleString(UI_DATE_LOCALE)} frames
                {fps !== null ? ` · ${fps} fps` : ''}
              </span>
            )}
          </div>

          {alreadyDiscarded && (
            <p className="text-[13px] font-medium text-signal-stopped" role="status" data-testid="quick-check-verdict">
              {quickCheck.stopReason === 'estop' ? describeEStopTake(quickCheck.take) : `${takeLabel(quickCheck.take)} was discarded`}
            </p>
          )}

          {/* An aborted take's numbers describe frames that were thrown away: only the verdict. */}
          {!alreadyDiscarded && (
            <>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="quick-check-groups">
                {quickCheck.groupsMoved.length > 0 ? (
                  quickCheck.groupsMoved.map((g) => (
                    <span key={g} className="rounded-tag border border-line bg-inset px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                      {groupLabel(g)}
                    </span>
                  ))
                ) : (
                  <span className="text-[13px] text-ink-tertiary">Nothing moved</span>
                )}
                {quickCheck.warnings.map((w) => (
                  <span
                    key={w}
                    data-testid={`quick-check-warning-${w}`}
                    className="rounded-tag border border-signal-estimated/30 bg-signal-estimated/10 px-2 py-0.5 text-[11px] font-medium text-signal-estimated"
                  >
                    {warningLabel(w)}
                  </span>
                ))}
              </div>

              {topJoints.length > 0 && (
                <ul className="flex flex-col gap-1" data-testid="quick-check-joints">
                  {topJoints.map((j) => (
                    <li key={j.name} className="grid grid-cols-[minmax(0,10rem)_1fr_3.5rem] items-center gap-2 text-[11px]">
                      <span className="truncate text-ink-secondary" title={j.name}>{j.name.replace(/_joint$/, '').replace(/_/g, ' ')}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-inset">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(100, Math.max(4, (j.rangeRad / FULL_RANGE_RAD) * 100))}%` }}
                        />
                      </span>
                      <span className="text-right tabular-nums text-ink-tertiary">{j.rangeRad.toFixed(2)} rad</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {!alreadyDiscarded && (
              <Button
                ref={discardRef}
                variant={suggestDiscard ? 'danger' : 'secondary'}
                size="sm"
                isLoading={busy}
                onClick={() => void discard()}
                data-testid="quick-check-discard"
                leftIcon={<Trash2 className="h-4 w-4" strokeWidth={1.75} />}
              >
                Discard
              </Button>
            )}
            <Button
              size="sm"
              variant={suggestDiscard ? 'secondary' : 'primary'}
              onClick={onKeep}
              data-testid="quick-check-keep"
              leftIcon={<Check className="h-4 w-4" strokeWidth={1.75} />}
            >
              {alreadyDiscarded ? 'Dismiss' : 'Keep'}
            </Button>
          </div>
        </div>
      </Panel.Body>
    </Panel>
  );
}
