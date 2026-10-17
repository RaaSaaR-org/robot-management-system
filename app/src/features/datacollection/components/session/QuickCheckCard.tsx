/**
 * @file QuickCheckCard.tsx
 * @description The glance after every take (TASK-410): thumbnail, length,
 *              frames and rate, which body parts moved, the five joints that
 *              moved most with their range, and the robot's warnings. Keep is
 *              the default and only dismisses (D3); Discard throws the take
 *              away. A take that is short or did not move pre-focuses Discard
 *              — it never discards on its own. Hides after 8 s unless the
 *              pointer or focus is on it.
 * @feature datacollection
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { Button, Panel } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type { QuickCheck } from '../../types/datacollection.types';
import { DISCARD_SUGGESTING_WARNINGS, groupLabel, takeLabel, warningLabel } from '../../utils/takeFormat';
import { TakeThumbnail } from './TakeThumbnail';

/** How long the card stays without being touched. */
export const QUICK_CHECK_VISIBLE_MS = 8000;

export interface QuickCheckCardProps {
  sessionId: string;
  quickCheck: QuickCheck;
  onKeep: () => void;
  onDiscard: (take: number) => void | Promise<unknown>;
  /** Override for tests */
  visibleMs?: number;
}

/** The range bar's full width: a joint that swept half a turn fills it. */
const FULL_RANGE_RAD = Math.PI;

export function QuickCheckCard({ sessionId, quickCheck, onKeep, onDiscard, visibleMs = QUICK_CHECK_VISIBLE_MS }: QuickCheckCardProps) {
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const discardRef = useRef<HTMLButtonElement>(null);
  const suggestDiscard = quickCheck.warnings.some((w) => DISCARD_SUGGESTING_WARNINGS.includes(w));

  // Pre-focus Discard on a take that is probably not worth keeping.
  useEffect(() => {
    if (suggestDiscard) discardRef.current?.focus();
  }, [suggestDiscard, quickCheck.take]);

  // Gone after 8 s, unless someone is reading or pointing at it.
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onKeep, visibleMs);
    return () => clearTimeout(timer);
  }, [held, onKeep, visibleMs, quickCheck.take]);

  const topJoints = [...quickCheck.jointsMoved].sort((a, b) => b.rangeRad - a.rangeRad).slice(0, 5);
  const fps = Number.isFinite(quickCheck.fpsActual) ? Math.round(quickCheck.fpsActual) : null;

  const discard = async () => {
    setBusy(true);
    try { await onDiscard(quickCheck.take); } finally { setBusy(false); }
  };

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
        <TakeThumbnail
          sessionId={sessionId}
          take={quickCheck.take}
          available={quickCheck.thumbnailUrl !== null}
          className="h-28 w-full sm:h-28 sm:w-40"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-display text-lg font-semibold text-ink-primary" data-testid="quick-check-title">
              {takeLabel(quickCheck.take)}
            </span>
            <span className="text-[13px] text-ink-secondary tabular-nums" data-testid="quick-check-stats">
              {quickCheck.durationS.toFixed(1)} s · {quickCheck.frames.toLocaleString(UI_DATE_LOCALE)} frames
              {fps !== null ? ` · ${fps} fps` : ''}
            </span>
          </div>

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

          <div className="flex flex-wrap justify-end gap-2">
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
            <Button
              size="sm"
              variant={suggestDiscard ? 'secondary' : 'primary'}
              onClick={onKeep}
              data-testid="quick-check-keep"
              leftIcon={<Check className="h-4 w-4" strokeWidth={1.75} />}
            >
              Keep
            </Button>
          </div>
        </div>
      </Panel.Body>
    </Panel>
  );
}
