/**
 * @file WindowBar.tsx
 * @description 24-hour bar with one band per patrol time window and a "now"
 *              marker. Day, night and custom windows are tonal steps of the
 *              primary, so they never borrow the status colours.
 * @feature patrol
 */

import { memo, useEffect, useState } from 'react';
import { cn } from '@/shared/utils/cn';
import type { PatrolTimeWindow } from '../types/patrol.types';
import { formatWindow } from '../utils/patrolFormat';

function clampHour(h: number): number {
  return Math.max(0, Math.min(24, Math.round(Number.isFinite(h) ? h : 0)));
}

/** Pure: the [start,end) hour segments a window covers; wraps midnight into two. */
export function windowSegments(w: PatrolTimeWindow): Array<[number, number]> {
  const s = clampHour(w.startHour);
  const e = clampHour(w.endHour);
  if (e > s) return [[s, e]];
  if (s === e && s === 0) return [[0, 24]];
  return [[s, 24], [0, e]].filter(([a, b]) => b > a) as Array<[number, number]>;
}

/** Band colour of a window: light primary by day, full primary at night, a neutral step otherwise. */
export function windowBand(w: PatrolTimeWindow): string {
  const id = (w.id || w.name).trim().toLowerCase();
  if (id === 'day') return 'bg-primary/35';
  if (id === 'night') return 'bg-primary/80';
  return 'bg-line-strong';
}

export interface WindowBarProps {
  windows: readonly PatrolTimeWindow[];
  size?: 'sm' | 'md';
  className?: string;
}

export const WindowBar = memo(function WindowBar({ windows, size = 'md', className }: WindowBarProps) {
  const [nowFrac, setNowFrac] = useState<number>(() => {
    const d = new Date();
    return (d.getHours() + d.getMinutes() / 60) / 24;
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNowFrac((d.getHours() + d.getMinutes() / 60) / 24);
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn('relative grid grid-cols-24 overflow-hidden rounded-full bg-inset', size === 'sm' ? 'h-1.5' : 'h-2.5')}
        role="img"
        aria-label={windows.length ? `Time windows: ${windows.map((w) => `${w.name || w.id} ${formatWindow(w)}`).join(', ')}` : 'No time windows'}
      >
        {windows.map((w) =>
          windowSegments(w).map(([a, b], i) => (
            <span key={`${w.id}-${i}`} className={cn('h-full', windowBand(w))} style={{ gridColumn: `${a + 1} / ${b + 1}` }} aria-hidden="true" />
          )),
        )}
        <span className="absolute inset-y-0 w-px bg-ink-primary" style={{ left: `${(nowFrac * 100).toFixed(2)}%` }} aria-hidden="true" title="now" />
      </div>
      {size === 'md' && (
        <div className="mt-1 flex justify-between text-xs tabular-nums text-ink-tertiary" aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      )}
    </div>
  );
});
