/**
 * @file PresenceBar.tsx
 * @description Who is in the session right now (TASK-414), as the command
 *              bar's avatar stack (TASK-426): one 30 px initials avatar per
 *              (user, role) — a user with two desktop tabs is one avatar. The
 *              headset wearer is ringed in the measured signal and carries a
 *              small Glasses badge. Each avatar names the person and where
 *              they are ("Anna Keller, in the headset"). Nothing when nobody
 *              watches.
 * @feature datacollection
 */

import { Glasses } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { PresenceViewer } from '../types/datacollection.types';
import { viewerInitials, viewerLabel } from '../utils/presenceFormat';

export interface PresenceBarProps {
  viewers: readonly PresenceViewer[];
  className?: string;
}

/** One entry per (user, role), first seen first — two tabs of one desktop are one person. */
export function dedupeViewers(viewers: readonly PresenceViewer[]): PresenceViewer[] {
  const seen = new Set<string>();
  const out: PresenceViewer[] = [];
  for (const viewer of viewers) {
    const key = `${viewer.userId}\u0000${viewer.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(viewer);
  }
  return out;
}

/** "Anna Keller, in the headset" / "Ben Hoffmann, at a desktop". */
export function viewerTooltip(viewer: PresenceViewer): string {
  return `${viewer.displayName}, ${viewer.role === 'operator' ? 'in the headset' : 'at a desktop'}`;
}

export function PresenceBar({ viewers, className }: PresenceBarProps) {
  const people = dedupeViewers(viewers);
  if (people.length === 0) return null;
  return (
    <ul className={cn('flex items-center pr-0.5', className)} data-testid="presence-bar" aria-label="In this session">
      {people.map((viewer, i) => {
        const operator = viewer.role === 'operator';
        return (
          <li
            key={`${viewer.userId}-${viewer.role}`}
            className={cn(
              'relative inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-2 border-panel text-[11px] font-semibold',
              i > 0 && '-ml-1.5',
              operator
                ? 'bg-signal-measured/15 text-signal-measured ring-[1.5px] ring-signal-measured'
                : 'bg-raised text-ink-secondary ring-1 ring-line-strong',
            )}
            data-testid="presence-viewer"
            data-role={viewer.role}
            title={viewerTooltip(viewer)}
          >
            <span aria-hidden>{viewerInitials(viewer.displayName)}</span>
            <span className="sr-only">{viewerLabel(viewer)}</span>
            {operator && (
              <span
                aria-hidden
                className="absolute -bottom-1 -right-[5px] grid h-[15px] w-[15px] place-items-center rounded-full bg-panel text-signal-measured"
              >
                <Glasses className="h-[11px] w-[11px]" strokeWidth={1.75} />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
